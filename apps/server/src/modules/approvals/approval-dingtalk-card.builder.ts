import { APPROVAL_EVENT_TYPE, getApprovalEventLabels } from '@ky-azeroth/shared/constants';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

const DEFAULT_WEB_BASE_URL = 'http://localhost:5173';

export interface ApprovalCardPayload {
  /** 卡片标题（钉钉客户端消息列表与卡片顶部均使用） */
  title: string;
  /** 卡片正文 markdown */
  markdown: string;
  /** 底部按钮文案 */
  singleTitle: string;
  /** 整张卡片点击跳转的绝对 URL */
  singleUrl: string;
}

interface BuildInput {
  instanceId: string;
  /** 'pending' = 待我审批 / 'approval' = 通用待办（保留扩展） */
  scenario?: 'pending';
}

/**
 * 审批钉钉 OA 卡片字段构建器
 *
 * 职责：
 * - 按 ApprovalInstance.eventType 查询对应业务记录（saleOrder/payment/invoice/visitRecord/project）
 * - 提取关键字段（客户/金额/单号/时间等）拼成钉钉 markdown
 * - 失败时降级返回最小可用卡片（仅 instance.title + 初始人 + 单号），不抛异常
 *
 * 设计原则：
 * - 与发送通道解耦：本类只产出 ApprovalCardPayload，由 DingtalkMessengerService 实际下发
 * - 字段口径与前端审批详情页保持一致：金额保留两位小数 + 货币符号、时间精确到分钟
 * - markdown 大小受钉钉客户端实际渲染限制约束，单卡片 ≤ 1000 字
 */
@Injectable()
export class ApprovalDingtalkCardBuilder {
  private readonly logger = new Logger(ApprovalDingtalkCardBuilder.name);
  private readonly webBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {
    this.webBaseUrl = (this.config.get<string>('APP_WEB_BASE_URL') ?? DEFAULT_WEB_BASE_URL).replace(
      /\/+$/,
      ''
    );
  }

  buildPendingWebUrl(instanceId: string): string {
    return `${this.webBaseUrl}/approval/list?tab=pending&instanceId=${instanceId}`;
  }

  buildCustomerWebUrl(customerId: string): string {
    const innerUrl = `${this.webBaseUrl}/crm/customers?highlight=${encodeURIComponent(customerId)}`;
    return `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(innerUrl)}`;
  }

  /**
   * 为某个审批实例构建「待审批」OA 卡片内容。
   * 返回 null 表示无法构建（实例不存在等异常），调用方应跳过推送。
   */
  async buildPendingCard(input: BuildInput): Promise<ApprovalCardPayload | null> {
    const instance = await this.prisma.approvalInstance.findUnique({
      where: { id: input.instanceId },
      select: {
        id: true,
        code: true,
        eventType: true,
        formId: true,
        formCode: true,
        title: true,
        initiatorName: true,
        createdAt: true,
      },
    });
    if (!instance) {
      this.logger.warn(`buildPendingCard: instance not found id=${input.instanceId}`);
      return null;
    }

    const eventLabels = getApprovalEventLabels();
    const eventLabel = eventLabels[instance.eventType] ?? '审批';
    const cardTitle = `【待审批】${eventLabel}`;
    const contentHeading = getContentHeading(instance.eventType, eventLabel);

    const businessLines = await this.buildBusinessLines(instance.eventType, instance.formId).catch(
      (err) => {
        this.logger.warn(
          `buildBusinessLines 失败 eventType=${instance.eventType} formId=${instance.formId}: ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
        return [] as Array<{ label: string; value: string }>;
      }
    );

    const baseLines: Array<{ label: string; value: string }> = [
      { label: '发起人', value: instance.initiatorName },
      ...businessLines,
      { label: '提交时间', value: formatDateTime(instance.createdAt) },
    ];

    // 所有 value 走 markdown 转义（防止客户名/事由含 [](*) 等字符破坏卡片渲染或伪造链接）
    const markdownLines = baseLines.map(
      (line) => `**${escapeDingtalkMarkdown(line.label)}**:${escapeDingtalkMarkdown(line.value)}`
    );
    // 钉钉 markdown 同段落内换行需双空格 + \n
    const markdown = `### **${escapeDingtalkMarkdown(contentHeading)}**  \n${markdownLines.join('  \n')}`;

    // 跳转 URL 用钉钉统一跳转协议包裹：
    // 直接传 https://...?tab=pending&instanceId=xxx 会被钉钉客户端把外层 query 的 `&`
    // 当成自身参数分隔符吃掉，导致 instanceId 丢失，前端只能打开列表页而无法定位实例。
    // 修法：用 dingtalk://dingtalkclient/page/link?url=<encoded> 协议，整个业务 URL 编码后塞进 url 参数。
    // 钉钉客户端拿到后会解码并打开（PC 抽屉 / 移动端 webview），query 完整透传到前端 SPA。
    const innerUrl = this.buildPendingWebUrl(instance.id);
    const jumpUrl = `dingtalk://dingtalkclient/page/link?url=${encodeURIComponent(innerUrl)}`;

    return {
      title: cardTitle,
      markdown,
      singleTitle: '查看审批详情',
      singleUrl: jumpUrl,
    };
  }

  /**
   * 按 eventType 提取关键业务字段。
   * 每种事件类型独立查询逻辑；未注册业务模型的事件（如 project_launch）回退为空数组，
   * 卡片只显示通用字段。
   */
  private async buildBusinessLines(
    eventType: string,
    formId: string
  ): Promise<Array<{ label: string; value: string }>> {
    const change = await this.prisma.approvalChangeRequest.findFirst({
      where: { id: formId, eventType, deletedAt: null },
      select: { targetType: true, targetCode: true, title: true, patch: true },
    });
    if (change) {
      const lines = [
        { label: '变更对象', value: getChangeTargetLabel(change.targetType) },
        { label: '单据号', value: change.targetCode ?? '-' },
        { label: '变更标题', value: truncate(change.title, 50) },
      ];
      if (isVoidChangePatch(change.patch)) {
        lines.push({ label: '作废原因', value: truncate(readVoidReason(change.patch), 80) });
      }
      return lines;
    }

    switch (eventType) {
      case APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE: {
        const so = await this.prisma.saleOrder.findUnique({
          where: { id: formId },
          select: {
            serialNumber: true,
            orderTitle: true,
            orderAmount: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!so) return [];
        return [
          { label: '客户', value: so.customer?.customerName ?? '-' },
          { label: '订单号', value: so.serialNumber },
          { label: '金额', value: formatAmount(so.orderAmount) },
        ];
      }

      case APPROVAL_EVENT_TYPE.INVOICE_APPROVE: {
        const inv = await this.prisma.invoice.findUnique({
          where: { id: formId },
          select: {
            invoiceAmount: true,
            title: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!inv) return [];
        return [
          { label: '客户', value: inv.customer?.customerName ?? '-' },
          { label: '开票金额', value: formatAmount(inv.invoiceAmount) },
          { label: '抬头', value: inv.title ?? '-' },
        ];
      }

      case APPROVAL_EVENT_TYPE.PAYMENT_APPROVE: {
        const pay = await this.prisma.payment.findUnique({
          where: { id: formId },
          select: {
            paymentAmount: true,
            customer: { select: { customerName: true } },
            saleOrder: { select: { serialNumber: true } },
          },
        });
        if (!pay) return [];
        return [
          { label: '客户', value: pay.customer?.customerName ?? '-' },
          { label: '回款金额', value: formatAmount(pay.paymentAmount) },
          { label: '关联订单', value: pay.saleOrder?.serialNumber ?? '-' },
        ];
      }

      case APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE: {
        const ref = await this.prisma.payment.findUnique({
          where: { id: formId },
          select: {
            paymentAmount: true,
            refundReason: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!ref) return [];
        return [
          { label: '客户', value: ref.customer?.customerName ?? '-' },
          { label: '退款金额', value: formatAmount(ref.paymentAmount) },
          { label: '退款事由', value: truncate(ref.refundReason ?? '-', 50) },
        ];
      }

      case APPROVAL_EVENT_TYPE.VISIT_APPROVE: {
        const visit = await this.prisma.visitRecord.findUnique({
          where: { id: formId },
          select: {
            signInTime: true,
            content: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!visit) return [];
        return [
          { label: '拜访客户', value: visit.customer?.customerName ?? '-' },
          {
            label: '拜访时间',
            value: visit.signInTime ? formatDateTime(visit.signInTime) : '-',
          },
          { label: '事由', value: truncate(visit.content ?? '-', 50) },
        ];
      }

      // project_launch 未在 APPROVAL_BUSINESS_REGISTRY 注册，业务表读取暂跳过。
      // 卡片回退为通用模板（仅基础字段）。
      default:
        return [];
    }
  }
}

function getContentHeading(eventType: string, fallbackLabel: string): string {
  switch (eventType) {
    case APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE:
      return '订单审批';
    case APPROVAL_EVENT_TYPE.INVOICE_APPROVE:
      return '开票审批';
    case APPROVAL_EVENT_TYPE.PAYMENT_APPROVE:
      return '回款审批';
    case APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE:
      return '退款审批';
    case APPROVAL_EVENT_TYPE.VISIT_APPROVE:
      return '拜访审批';
    case APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE:
      return '订单变更审批';
    case APPROVAL_EVENT_TYPE.SALE_ORDER_VOID:
      return '订单纠错作废审批';
    case APPROVAL_EVENT_TYPE.INVOICE_CHANGE:
      return '开票变更审批';
    case APPROVAL_EVENT_TYPE.PAYMENT_CHANGE:
      return '回款变更审批';
    case APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE:
      return '退款变更审批';
    case APPROVAL_EVENT_TYPE.VISIT_CHANGE:
      return '拜访变更审批';
    case APPROVAL_EVENT_TYPE.PROJECT_LAUNCH:
      return '项目审批';
    default:
      return fallbackLabel;
  }
}

function getChangeTargetLabel(targetType: string): string {
  switch (targetType) {
    case 'sale_order':
      return '合同订单';
    case 'invoice':
      return '开票记录';
    case 'payment':
      return '回款记录';
    case 'payment_refund':
      return '退款记录';
    case 'visit_record':
      return '拜访记录';
    default:
      return targetType;
  }
}

function isVoidChangePatch(value: Prisma.JsonValue): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value.__operation === 'void' || value.__operation === 'void_bundle')
  );
}

function readVoidReason(value: Prisma.JsonValue): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '-';
  return typeof value.__reason === 'string' && value.__reason.trim() ? value.__reason.trim() : '-';
}

function formatAmount(value: Prisma.Decimal | number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  const num = typeof value === 'number' ? value : Number(value.toString());
  if (!Number.isFinite(num)) return '-';
  return `¥${num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(d: Date | null | undefined): string {
  if (!d) return '-';
  // 中国时区显示 yyyy-MM-dd HH:mm
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

/**
 * 钉钉 markdown 转义：
 * - `[` `]` `(` `)` 用反斜杠转义防止形成链接 `[text](url)` 注入
 * - `*` `_` 用反斜杠转义防止形成 bold/italic
 * - `` ` `` 用反斜杠转义防止形成 inline code
 * - `\` 自身也要转义放在最前
 *
 * 不处理 `#` `>` 等行首符号——本卡片所有 value 都不在行首（前面有"**label**:"），不会触发。
 */
function escapeDingtalkMarkdown(value: string): string {
  return value.replace(/[\\[\]()*_`]/g, (m) => `\\${m}`);
}
