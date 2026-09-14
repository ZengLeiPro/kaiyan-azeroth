import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { ApprovalDingtalkCardBuilder } from '../approval-dingtalk-card.builder';

function makeBuilder(): { builder: ApprovalDingtalkCardBuilder; prisma: MockPrismaService } {
  const prisma = createMockPrismaService();
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'APP_WEB_BASE_URL') return 'http://localhost:5173';
      return undefined;
    }),
  } as unknown as ConfigService;
  const builder = new ApprovalDingtalkCardBuilder(asPrismaService(prisma), config);
  return { builder, prisma };
}

const baseInstance = {
  id: 'inst-1',
  code: 'SP0001',
  eventType: 'sale_order_activate',
  formId: 'so-1',
  formCode: 'SO00568',
  title: '合同订单激活：SO00568',
  initiatorName: '周销售',
  createdAt: new Date('2026-05-26T05:20:00.000Z'), // UTC，渲染为 Asia/Shanghai 13:20
};

describe('ApprovalDingtalkCardBuilder', () => {
  it('实例不存在时返回 null', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue(null);
    const card = await builder.buildPendingCard({ instanceId: 'inst-missing' });
    expect(card).toBeNull();
  });

  it('客户详情跳转使用钉钉协议并保留 highlight 参数', () => {
    const { builder } = makeBuilder();

    expect(builder.buildCustomerWebUrl('customer-1')).toBe(
      'dingtalk://dingtalkclient/page/link?url=' +
        encodeURIComponent('http://localhost:5173/crm/customers?highlight=customer-1')
    );
  });

  it('合同订单审批：提取客户/订单号/金额，跳转 URL 含 instanceId', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue(baseInstance);
    prisma.saleOrder.findUnique.mockResolvedValue({
      serialNumber: 'SO00568',
      orderTitle: 'Q2 合同',
      orderAmount: '128000.00',
      customer: { customerName: '嗨玩购科技' },
    });

    const card = await builder.buildPendingCard({ instanceId: 'inst-1' });
    expect(card).not.toBeNull();
    expect(card!.title).toBe('【待审批】合同订单审批');
    expect(card!.markdown).toContain('### **订单审批**');
    expect(card!.markdown).toContain('周销售');
    expect(card!.markdown).toContain('嗨玩购科技');
    expect(card!.markdown).toContain('SO00568');
    expect(card!.markdown).toContain('¥128,000.00');
    expect(card!.singleTitle).toBe('查看审批详情');
    // 用钉钉统一跳转协议包裹业务 URL，避免 query string 的 & 被钉钉外层吃掉
    expect(card!.singleUrl).toBe(
      'dingtalk://dingtalkclient/page/link?url=' +
        encodeURIComponent('http://localhost:5173/approval/list?tab=pending&instanceId=inst-1')
    );
  });

  it('退款审批：客户/退款金额/退款事由，含转义敏感字符', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue({
      ...baseInstance,
      eventType: 'payment_refund_approve',
      formId: 'pay-refund-1',
    });
    prisma.payment.findUnique.mockResolvedValue({
      paymentAmount: '5000.50',
      refundReason: '客户 [取消] 订单*请退',
      customer: { customerName: '客户(带括号)' },
    });

    const card = await builder.buildPendingCard({ instanceId: 'inst-1' });
    expect(card!.markdown).toContain('### **退款审批**');
    expect(card!.markdown).toContain('¥5,000.50');
    // markdown 转义：[]() * 都被反斜杠转义
    expect(card!.markdown).toContain('\\[取消\\]');
    expect(card!.markdown).toContain('\\*');
    expect(card!.markdown).toContain('客户\\(带括号\\)');
  });

  it('作废审批：展示并转义作废原因', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue({
      ...baseInstance,
      eventType: 'sale_order_change',
      formId: 'change-1',
    });
    prisma.approvalChangeRequest.findFirst.mockResolvedValue({
      targetType: 'sale_order',
      targetCode: 'SO00568',
      title: '作废合同订单 SO00568',
      patch: {
        __operation: 'void',
        __reason: '  客户 [重复] 录入*需作废  ',
      },
    });

    const card = await builder.buildPendingCard({ instanceId: 'inst-1' });

    expect(card!.markdown).toContain('### **订单变更审批**');
    expect(card!.markdown).toContain('**变更对象**:合同订单');
    expect(card!.markdown).toContain('**作废原因**:客户 \\[重复\\] 录入\\*需作废');
  });

  it('拜访审批：客户/拜访时间/事由', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue({
      ...baseInstance,
      eventType: 'visit_approve',
      formId: 'visit-1',
    });
    prisma.visitRecord.findUnique.mockResolvedValue({
      signInTime: new Date('2026-05-26T01:00:00.000Z'), // UTC 1:00 = +08:00 09:00
      content: '商务谈判',
      customer: { customerName: '示例石业' },
    });

    const card = await builder.buildPendingCard({ instanceId: 'inst-1' });
    expect(card!.markdown).toContain('### **拜访审批**');
    expect(card!.markdown).toContain('示例石业');
    expect(card!.markdown).toContain('商务谈判');
    expect(card!.markdown).toContain('09:00');
  });

  it('未注册业务模型的 event（project_launch）回退为通用模板', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue({
      ...baseInstance,
      eventType: 'project_launch',
      formId: 'project-1',
    });
    // 不 mock 任何业务表

    const card = await builder.buildPendingCard({ instanceId: 'inst-1' });
    expect(card).not.toBeNull();
    expect(card!.title).toBe('【待审批】项目立项审批');
    expect(card!.markdown).toContain('### **项目审批**');
    expect(card!.markdown).toContain('周销售');
    expect(card!.markdown).toContain('提交时间');
  });

  it('业务表查询抛错时降级为通用卡片，不抛异常', async () => {
    const { builder, prisma } = makeBuilder();
    prisma.approvalInstance.findUnique.mockResolvedValue(baseInstance);
    prisma.saleOrder.findUnique.mockRejectedValue(new Error('DB connection lost'));

    const card = await builder.buildPendingCard({ instanceId: 'inst-1' });
    expect(card).not.toBeNull();
    expect(card!.markdown).toContain('周销售');
    expect(card!.markdown).toContain('提交时间');
    // 业务字段缺失但不抛
    expect(card!.markdown).not.toContain('嗨玩购');
  });
});
