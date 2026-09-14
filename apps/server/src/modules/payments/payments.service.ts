import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_STATUS,
  PAYMENT_DIRECTION,
  PROJECT_STATUS,
  resolveFinanceAccountCodeByBankName,
} from '@ky-azeroth/shared/constants';
import type {
  BatchApproveInput,
  VoidApprovalRequestInput,
} from '@ky-azeroth/shared/schemas/approval';
import type { InvoiceResponseOutput } from '@ky-azeroth/shared/schemas/invoice';
import {
  type BatchRemovePaymentInput,
  type BatchTransferPaymentInput,
  type BatchUpdatePaymentInput,
  type MergeInvoiceInput,
  type PaymentResponseOutput,
} from '@ky-azeroth/shared/schemas/payment';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  applyCustomerCollabViaCustomerScope,
  applyCustomerCollabViaCustomerWriteScope,
} from '../../common/services/data-scope.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { APPROVAL_CHANGE_TARGET_TYPE } from '../approvals/approval-change-requests.service';
import { ApprovalGuardService } from '../approvals/approval-guard.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { OrderProductReceivableService } from '../finance/receivables/order-product-receivable.service';
import { FinanceLedgerSyncService } from '../finance/sync/finance-ledger-sync.service';
import { InvoicesService } from '../invoices/invoices.service';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import { advanceCustomDevelopmentProjectFromSaleOrder } from '../projects/project-lifecycle.helper';
import {
  assertInvoiceWithinOrderAmount,
  assertPaymentWithinReceivables,
  assertRefundWithinReceived,
  lockSaleOrderFinancialGraph,
  validateFinancialSaleOrderAfterLock,
} from '../sale-orders/financial-limits.helper';
import { recalcSaleOrderPaymentSummary } from '../sale-orders/payment-summary.helper';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreatePaymentRefundDto } from './dto/create-payment-refund.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import {
  replacePaymentItemsInTransaction,
  softDeletePaymentItemsInTransaction,
  validatePaymentItemSplit,
} from './payment-item-replacement.helper';
import { PAYMENT_FILTER_REGISTRY } from './payments.filter-registry';

/**
 * 回款列表允许的排序字段白名单。
 * 业务日期、回款金额、创建/更新时间——其他字段一律兜底为 createdAt desc。
 * 白名单同时承担「防注入」（__proto__ 等）与「防非索引列全表扫描」两层职责。
 */
const PAYMENT_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'serialNumber',
  'paymentAmount',
  'businessDate',
  'createdAt',
  'updatedAt',
]);

const PAYMENT_ITEM_RESPONSE_SELECT = {
  id: true,
  paymentId: true,
  saleOrderProductId: true,
  itemSeq: true,
  productName: true,
  amount: true,
  financeSubjectId: true,
  paymentMode: true,
  remark: true,
  createdAt: true,
  creatorEmployeeId: true,
  updatedAt: true,
  updaterEmployeeId: true,
  deletedAt: true,
  version: true,
} as const;

const PAYMENT_INCLUDE = {
  charger: { select: { id: true, name: true } },
  customer: { select: { id: true, customerName: true, shortName: true } },
  saleOrder: { select: { id: true, orderTitle: true, serialNumber: true } },
  relatedPayment: {
    select: { id: true, serialNumber: true, paymentAmount: true, businessDate: true },
  },
  relatedInvoice: {
    select: { id: true, serialNumber: true, invoiceAmount: true, invoiceStatus: true },
  },
  paymentItems: {
    where: { deletedAt: null },
    orderBy: [{ itemSeq: 'asc' }, { id: 'asc' }],
    select: PAYMENT_ITEM_RESPONSE_SELECT,
  },
} satisfies Prisma.PaymentInclude;

type PaymentWithIncludes = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

/**
 * IN 行附带的可退余额计算字段。OUT 行不计算（值为 null）。
 *
 * refundedAmount: 该 IN 已被 approved OUT 退掉的总额（SUM(OUT WHERE relatedPaymentId=in.id)）
 * refundableAmount: paymentAmount - refundedAmount
 *
 * 前端 PaymentSelect 通过这两个字段过滤"余额>0"的可退回款，避免提交时才被后端
 * assertRefundWithinReceived 拒绝。
 */
type PaymentRefundability = { refundedAmount: number; refundableAmount: number };

function serializePayment(
  item: PaymentWithIncludes,
  refundability?: PaymentRefundability
): PaymentResponseOutput {
  const { payer: _payer, relatedPayment, relatedInvoice, paymentItems, ...rest } = item;
  void _payer;
  return serializeEntity<PaymentResponseOutput>({
    ...rest,
    chargerName: item.charger?.name ?? item.chargerName,
    businessDate: toDateOnlyString(item.businessDate),
    paymentAmount: toDecimalNumber(item.paymentAmount),
    items: (paymentItems ?? []).map((paymentItem) => ({
      ...paymentItem,
      amount: toDecimalNumber(paymentItem.amount),
    })),
    relatedPayment: relatedPayment
      ? {
          id: relatedPayment.id,
          serialNumber: relatedPayment.serialNumber,
          paymentAmount: toDecimalNumber(relatedPayment.paymentAmount),
          businessDate: toDateOnlyString(relatedPayment.businessDate),
        }
      : undefined,
    relatedInvoice: relatedInvoice
      ? {
          id: relatedInvoice.id,
          serialNumber: relatedInvoice.serialNumber,
          invoiceAmount: toDecimalNumber(relatedInvoice.invoiceAmount),
          invoiceStatus: relatedInvoice.invoiceStatus,
        }
      : undefined,
    refundedAmount: refundability?.refundedAmount ?? null,
    refundableAmount: refundability?.refundableAmount ?? null,
  });
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serialNumberService: SerialNumberService,
    private readonly approvalGuardService: ApprovalGuardService,
    private readonly approvalsService: ApprovalsService,
    private readonly businessApprovalService: BusinessApprovalService,
    private readonly filterApplier: FilterApplierService,
    private readonly invoicesService: InvoicesService,
    private readonly financeLedgerSync: FinanceLedgerSyncService,
    private readonly receivableService: OrderProductReceivableService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  async findAll(
    query: QueryPaymentDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<PaymentResponseOutput>> {
    const { page = 1, pageSize = 10, sortBy, sortOrder } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    // RBAC：三路径 OR（自身 chargerId / customer.chargerId / customer.collaboratorIds 含我）。
    // 与 sale_orders / opportunities / keep_records / visit_records 维度统一。
    // applier 不处理 scope（传 null），避免它默认对 chargerId 注入覆盖掉 OR。
    const baseWhere: Prisma.PaymentWhereInput = { deletedAt: null };
    applyCustomerCollabViaCustomerScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.PaymentWhereInput>({
      registry: PAYMENT_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.PaymentOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: PAYMENT_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take,
        orderBy,
        include: PAYMENT_INCLUDE,
      }),
      this.prisma.payment.count({ where }),
    ]);

    // 给本页 IN 行计算可退余额：一次 groupBy(SUM OUT) by relatedPaymentId
    // 仅扫 approved + 非软删 OUT，与 assertRefundWithinReceived 口径一致。
    const refundabilityMap = await this.computeRefundabilityForInRows(items);
    const data = items.map((p) => serializePayment(p, refundabilityMap.get(p.id)));

    return {
      items: data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 给一组 Payment 中的 IN 行批量计算 refundedAmount/refundableAmount。
   * 返回 Map<paymentId, { refundedAmount, refundableAmount }>，OUT 行不在 Map 中。
   */
  private async computeRefundabilityForInRows(
    items: PaymentWithIncludes[]
  ): Promise<Map<string, PaymentRefundability>> {
    const inRowIds = items.filter((p) => p.direction === PAYMENT_DIRECTION.IN).map((p) => p.id);
    const result = new Map<string, PaymentRefundability>();
    if (inRowIds.length === 0) return result;

    const grouped = await this.prisma.payment.groupBy({
      by: ['relatedPaymentId'],
      where: {
        relatedPaymentId: { in: inRowIds },
        direction: PAYMENT_DIRECTION.OUT,
        legacyAdjustment: false,
        flowStatus: 'approved',
        deletedAt: null,
      },
      _sum: { paymentAmount: true },
    });
    const refundedByInId = new Map<string, number>();
    // 防御性：单元测试用 mock prisma 时 groupBy 可能返回 undefined；real Prisma 永远返回数组。
    const rows = Array.isArray(grouped) ? grouped : [];
    for (const row of rows) {
      if (!row.relatedPaymentId) continue;
      refundedByInId.set(row.relatedPaymentId, Number(row._sum.paymentAmount ?? 0));
    }
    for (const p of items) {
      if (p.direction !== PAYMENT_DIRECTION.IN) continue;
      const refunded = refundedByInId.get(p.id) ?? 0;
      const refundable = Math.max(Number(p.paymentAmount) - refunded, 0);
      result.set(p.id, {
        refundedAmount: Number(refunded.toFixed(2)),
        refundableAmount: Number(refundable.toFixed(2)),
      });
    }
    return result;
  }

  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<PaymentResponseOutput> {
    // 之前 findOne 走单一 chargerId，与 findAll 双路径不一致——B 接手客户后
    // 单条 GET A 时代的回款会 NotFound，而列表里却能看到。本次统一对齐。
    const where: Prisma.PaymentWhereInput = { id, deletedAt: null };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const payment = await this.prisma.payment.findFirst({
      where,
      include: PAYMENT_INCLUDE,
    });

    if (!payment) {
      throw new NotFoundException(`回款 ${id} 不存在`);
    }

    const refundabilityMap = await this.computeRefundabilityForInRows([payment]);
    return serializePayment(payment, refundabilityMap.get(payment.id));
  }

  async create(
    dto: CreatePaymentDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<PaymentResponseOutput> {
    if (!Number.isFinite(dto.paymentAmount) || dto.paymentAmount <= 0) {
      throw new BadRequestException('回款金额必须大于 0');
    }
    // 此入口语义只承载 IN（回款）；前端 OUT 请走 createRefund 入口。
    // 若调用方误传 direction='OUT' 这里直接拒绝，避免审批分支错配。
    if (dto.direction != null && dto.direction !== PAYMENT_DIRECTION.IN) {
      throw new BadRequestException('回款入口不支持 OUT 方向，退款请走 POST /payments/refund');
    }
    const paymentItems = dto.items;
    if (!paymentItems || paymentItems.length === 0) {
      throw new BadRequestException('回款必须至少拆分为一条 PaymentItem');
    }
    const resolvedCustomerId = await this.resolveSaleOrderCustomerId(
      dto.saleOrderId,
      dto.customerId,
      chargerScope,
      currentEmployeeId
    );
    this.assertChargerInScope(dto.chargerId, chargerScope);
    // v2.2 PR-C：按 bankName 反查 financeAccountId（前端 UX 上 bankName 即「收款账户」选择器）
    const financeAccountId = await this.resolveFinanceAccountIdByBankName(dto.bankName);
    const serialNumber = await this.serialNumberService.generate(SerialNumberType.PAYMENT);
    const approvalRequired = await this.approvalGuardService.isRequired(
      APPROVAL_EVENT_TYPE.PAYMENT_APPROVE
    );
    const flowStatus = approvalRequired ? 'pending' : 'approved';

    let approvalInstanceId: string | undefined;
    // 业务行 + 审批实例 + 订单聚合重算必须在同一事务，避免「Payment 已落库但 SaleOrder
    // 聚合 CAS 失败」的半提交状态。recalc 失败 → 整笔回滚 → API 返回错误且无脏数据。
    const payment = await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(tx, dto.saleOrderId);
      const lockedOrder = await validateFinancialSaleOrderAfterLock(tx, {
        saleOrderId: dto.saleOrderId,
        expectedCustomerId: dto.customerId ?? resolvedCustomerId,
        chargerScope,
        currentEmployeeId,
      });
      if (flowStatus === 'approved') {
        await assertPaymentWithinReceivables(tx, {
          saleOrderId: dto.saleOrderId,
          paymentAmount: dto.paymentAmount,
        });
      }

      const created = await tx.payment.create({
        data: {
          serialNumber,
          flowStatus,
          saleOrderId: dto.saleOrderId,
          customerId: lockedOrder.customerId,
          subject: dto.subject?.trim() || '回款',
          paymentAmount: String(dto.paymentAmount),
          paymentType: dto.paymentType ?? undefined,
          businessDate: dto.businessDate ? new Date(dto.businessDate) : undefined,
          bankName: dto.bankName ?? undefined,
          financeAccountId: financeAccountId ?? undefined,
          tradeSerialNumber: dto.tradeSerialNumber ?? undefined,
          chargerId: dto.chargerId ?? undefined,
          remark: dto.remark ?? undefined,
          direction: PAYMENT_DIRECTION.IN,
          ...auditCreate(currentUser),
        },
        include: PAYMENT_INCLUDE,
      });

      if (approvalRequired) {
        approvalInstanceId = await this.businessApprovalService.createApprovalForNewRecord(
          tx,
          APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
          created,
          currentUser
        );
      }

      // 同步刷新订单的已收款/未收款聚合（仅当 flowStatus='approved' 时金额会被算入；
      // 走审批流时由 approvals.service 的 payment_approve case 在通过节点触发）。
      await recalcSaleOrderPaymentSummary(tx, created.saleOrderId);

      // Payment 头表、必填拆分行与反向缓存必须在同一事务提交。
      await this.createPaymentItemsForPayment(
        tx,
        created.id,
        dto.saleOrderId,
        dto.paymentAmount,
        paymentItems,
        currentUser
      );

      if (flowStatus === 'approved') {
        await this.financeLedgerSync.syncFromPayment(tx, created.id);
      }

      if (flowStatus === 'approved') {
        await advanceCustomDevelopmentProjectFromSaleOrder(
          tx,
          created.saleOrderId,
          PROJECT_STATUS.NOT_STARTED,
          currentUser,
          { createIfMissing: false }
        );
      }

      return this.refreshPaymentItemsForResponse(tx, created);
    });

    if (approvalInstanceId) {
      this.approvalsService.notifyOnSubmit(approvalInstanceId).catch(() => {
        // 通知失败不影响主流程，notifyOnSubmit 内已记录日志
      });
    }

    const refundabilityMap = await this.computeRefundabilityForInRows([payment]);
    const response = serializePayment(payment, refundabilityMap.get(payment.id));
    await this.changeLog?.logChange({
      module: 'payments',
      action: 'create',
      target: response.id,
      targetName: response.serialNumber,
      currentUser,
      after: response,
    });
    return response;
  }

  /**
   * 创建退款（direction='OUT' 专用入口）
   *
   * 约束：
   * - relatedPaymentId 必填，必须指向同订单同客户的已 approved IN 回款
   * - refundType 必填，refundReason 可选
   * - relatedInvoiceId 可选（已开票退款联动选择红字发票）
   * - 编号走独立 REF- 前缀
   * - 审批走 payment_refund_approve 事件
   */
  async createRefund(
    dto: CreatePaymentRefundDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<PaymentResponseOutput> {
    if (!Number.isFinite(dto.paymentAmount) || dto.paymentAmount <= 0) {
      throw new BadRequestException('退款金额必须大于 0');
    }
    const resolvedCustomerId = await this.resolveSaleOrderCustomerId(
      dto.saleOrderId,
      dto.customerId,
      chargerScope,
      currentEmployeeId
    );
    this.assertChargerInScope(dto.chargerId, chargerScope);

    const serialNumber = await this.serialNumberService.generate(SerialNumberType.PAYMENT_REFUND);
    // v2.2 PR-C：按 bankName 反查 financeAccountId（OUT 行走 ledger 退款入账时同样需要）
    const financeAccountId = await this.resolveFinanceAccountIdByBankName(dto.bankName);
    const approvalRequired = await this.approvalGuardService.isRequired(
      APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE
    );
    const flowStatus = approvalRequired ? 'pending' : 'approved';

    let approvalInstanceId: string | undefined;
    // 业务行 + 审批 + 聚合重算必须同事务，理由同 create()。
    // 注意：assertRefundWithinReceived 已移入事务内（仅 direct-approved 分支需要），
    // 并在校验前对关联 IN 做 version CAS 抢占，串行化同一 IN 上的并发退款。
    const refund = await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(tx, dto.saleOrderId);
      const lockedOrder = await validateFinancialSaleOrderAfterLock(tx, {
        saleOrderId: dto.saleOrderId,
        expectedCustomerId: dto.customerId ?? resolvedCustomerId,
        chargerScope,
        currentEmployeeId,
      });
      const relatedIn = await tx.payment.findFirst({
        where: {
          id: dto.relatedPaymentId,
          saleOrderId: dto.saleOrderId,
          customerId: lockedOrder.customerId,
          direction: PAYMENT_DIRECTION.IN,
          flowStatus: 'approved',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!relatedIn) {
        throw new BadRequestException('关联原回款不存在、已删除、未审批或不属于同一订单客户');
      }
      if (dto.relatedInvoiceId) {
        const relatedInvoice = await tx.invoice.findFirst({
          where: {
            id: dto.relatedInvoiceId,
            saleOrderId: dto.saleOrderId,
            customerId: lockedOrder.customerId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!relatedInvoice) {
          throw new BadRequestException('关联红字发票不存在、已删除或不属于同一订单客户');
        }
      }
      if (flowStatus === 'approved') {
        await assertRefundWithinReceived(tx, {
          saleOrderId: dto.saleOrderId,
          refundAmount: dto.paymentAmount,
          relatedPaymentId: dto.relatedPaymentId,
        });
      }
      const created = await tx.payment.create({
        data: {
          serialNumber,
          flowStatus,
          saleOrderId: dto.saleOrderId,
          customerId: lockedOrder.customerId,
          subject: dto.subject?.trim() || dto.refundType,
          paymentAmount: String(dto.paymentAmount),
          paymentType: dto.paymentType ?? undefined,
          businessDate: dto.businessDate ? new Date(dto.businessDate) : undefined,
          bankName: dto.bankName ?? undefined,
          financeAccountId: financeAccountId ?? undefined,
          tradeSerialNumber: dto.tradeSerialNumber ?? undefined,
          chargerId: dto.chargerId ?? undefined,
          remark: dto.remark ?? undefined,
          direction: PAYMENT_DIRECTION.OUT,
          refundType: dto.refundType,
          refundReason: dto.refundReason ?? undefined,
          relatedPaymentId: dto.relatedPaymentId,
          relatedInvoiceId: dto.relatedInvoiceId ?? undefined,
          ...auditCreate(currentUser),
        },
        include: PAYMENT_INCLUDE,
      });

      if (approvalRequired) {
        approvalInstanceId = await this.businessApprovalService.createApprovalForNewRecord(
          tx,
          APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE,
          created,
          currentUser
        );
      }

      // 同步刷新订单聚合（pending 状态本身不影响金额，但 orderStatus 总归要写一遍以幂等）
      await recalcSaleOrderPaymentSummary(tx, created.saleOrderId);

      return created;
    });

    if (approvalInstanceId) {
      this.approvalsService.notifyOnSubmit(approvalInstanceId).catch(() => {
        // 通知失败不影响主流程
      });
    }

    // OUT 行 refundability 永远为 null（OUT 不能再被退）
    const response = serializePayment(refund);
    await this.changeLog?.logChange({
      module: 'payments',
      action: 'create',
      target: response.id,
      targetName: response.serialNumber,
      currentUser,
      after: response,
    });
    return response;
  }

  async update(
    id: string,
    dto: UpdatePaymentDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<PaymentResponseOutput> {
    const requestVersion = requireRequestVersion(dto.version, '更新回款');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.legacyAdjustment) {
      throw new BadRequestException('历史负向调整为只读治理记录，禁止通过业务接口修改');
    }
    const recordLabel = existing.direction === PAYMENT_DIRECTION.OUT ? '退款记录' : '回款记录';
    const approvalEventType =
      existing.direction === PAYMENT_DIRECTION.OUT
        ? APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE
        : APPROVAL_EVENT_TYPE.PAYMENT_APPROVE;
    this.businessApprovalService.assertCanDirectEdit(existing.flowStatus, recordLabel, currentUser);

    // direction 一旦审批通过即冻结（亦不允许通过 update 改方向）。
    // 这里即使 dto.direction === existing.direction 也拒绝——避免误传引发歧义。
    if (dto.direction !== undefined && dto.direction !== existing.direction) {
      throw new BadRequestException('direction 字段不可修改（IN/OUT 入口语义不同）');
    }

    const finalSaleOrderId = dto.saleOrderId ?? existing.saleOrderId;
    const finalPaymentAmount =
      dto.paymentAmount !== undefined ? dto.paymentAmount : existing.paymentAmount;
    if (!Number.isFinite(Number(finalPaymentAmount)) || Number(finalPaymentAmount) <= 0) {
      throw new BadRequestException('回款金额必须大于 0');
    }
    // items 一旦出现即表示完整替换；空数组会制造无拆分头表，Service 层同样 fail-closed。
    if (dto.items !== undefined && dto.items.length === 0) {
      throw new BadRequestException('回款必须至少拆分为一条 PaymentItem');
    }
    const replacementItems = dto.items;
    if (replacementItems && existing.direction !== PAYMENT_DIRECTION.IN) {
      throw new BadRequestException('退款记录不支持 PaymentItem 产品拆分');
    }
    const shouldTouchOrderCustomer = dto.saleOrderId !== undefined || dto.customerId !== undefined;
    const resolvedCustomerId = shouldTouchOrderCustomer
      ? await this.resolveSaleOrderCustomerId(
          finalSaleOrderId,
          dto.customerId,
          chargerScope,
          currentEmployeeId
        )
      : undefined;
    this.assertChargerInScope(dto.chargerId, chargerScope);
    // 事务外仅保留纯结构校验（不读 SUM）；需要读 SUM 的余额校验移入事务内，
    // 并在 OUT 行自身 update 前对关联 IN 做 version CAS 抢占（与 createRefund 同款）。
    if (
      existing.flowStatus === 'approved' &&
      existing.direction === PAYMENT_DIRECTION.OUT &&
      !existing.relatedPaymentId
    ) {
      throw new BadRequestException('已通过的退款缺少 relatedPaymentId，数据异常');
    }
    // 与 charger/saleOrder/customer 等 relation 字段共存时，audit 必须走 relation 写法（updater.connect），
    // 避免 PaymentUpdateInput（Checked）与 UncheckedUpdateInput 分支被混用导致 Prisma 报 500。
    const audit = auditUpdate(currentUser);
    const data: Prisma.PaymentUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };

    if (dto.saleOrderId !== undefined) data.saleOrder = { connect: { id: dto.saleOrderId } };
    if (resolvedCustomerId !== undefined) data.customer = { connect: { id: resolvedCustomerId } };
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.paymentAmount !== undefined) {
      data.paymentAmount = String(dto.paymentAmount);
    }
    if (dto.paymentType !== undefined) data.paymentType = dto.paymentType;
    if (dto.businessDate !== undefined) {
      data.businessDate = dto.businessDate ? new Date(dto.businessDate) : null;
    }
    if (dto.bankName !== undefined) {
      data.bankName = dto.bankName;
      // v2.2 PR-C：bankName 改了同步刷新 financeAccountId（前端 UX 上 bankName 即「收款账户」）
      const newAccountId = await this.resolveFinanceAccountIdByBankName(dto.bankName);
      if (newAccountId) {
        data.financeAccount = { connect: { id: newAccountId } };
      } else {
        data.financeAccount = { disconnect: true };
      }
    }
    if (dto.tradeSerialNumber !== undefined) data.tradeSerialNumber = dto.tradeSerialNumber;
    if (dto.chargerId !== undefined) {
      if (!dto.chargerId) throw new BadRequestException('请选择负责人');
      data.charger = { connect: { id: dto.chargerId } };
    }
    if (dto.remark !== undefined) data.remark = dto.remark;

    try {
      // update + 旧/新订单聚合重算包同事务，避免「金额变了但聚合没刷新」的中间态
      const payment = await this.prisma.$transaction(async (tx) => {
        const pendingApproval = await this.businessApprovalService.lockPendingFormEdit(
          tx,
          approvalEventType,
          id,
          existing.flowStatus,
          currentUser
        );
        await lockSaleOrderFinancialGraph(tx, [existing.saleOrderId, finalSaleOrderId]);
        const targetWhere: Prisma.PaymentWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerWriteScope(targetWhere, chargerScope, currentEmployeeId);
        const lockedPayment = await tx.payment.findFirst({
          where: targetWhere,
          select: {
            id: true,
            saleOrderId: true,
            customerId: true,
            paymentAmount: true,
            direction: true,
            flowStatus: true,
            relatedPaymentId: true,
            relatedInvoiceId: true,
            invoicedByInvoiceId: true,
          },
        });
        if (
          !lockedPayment ||
          lockedPayment.saleOrderId !== existing.saleOrderId ||
          lockedPayment.customerId !== existing.customerId ||
          lockedPayment.direction !== existing.direction ||
          lockedPayment.flowStatus !== existing.flowStatus ||
          lockedPayment.relatedPaymentId !== existing.relatedPaymentId ||
          lockedPayment.relatedInvoiceId !== existing.relatedInvoiceId ||
          lockedPayment.invoicedByInvoiceId !== existing.invoicedByInvoiceId
        ) {
          throw new ConflictException('回款/退款版本、关系、状态或访问范围已变化，请刷新后重试');
        }
        this.businessApprovalService.assertCanDirectEdit(
          lockedPayment.flowStatus,
          recordLabel,
          currentUser
        );

        const paymentRelationChanged = finalSaleOrderId !== lockedPayment.saleOrderId;
        const paymentAmountChanged =
          Number(finalPaymentAmount) !== Number(lockedPayment.paymentAmount);
        if (
          lockedPayment.direction === PAYMENT_DIRECTION.IN &&
          !replacementItems &&
          (paymentRelationChanged || paymentAmountChanged)
        ) {
          throw new ConflictException('改绑回款订单或金额时必须同时提交完整 items 替换');
        }
        if (paymentRelationChanged && lockedPayment.invoicedByInvoiceId) {
          throw new ConflictException('已合并开票的回款不能改绑合同订单');
        }
        if (paymentRelationChanged && lockedPayment.direction === PAYMENT_DIRECTION.IN) {
          const referencingRefunds = await tx.payment.count({
            where: {
              relatedPaymentId: id,
              direction: PAYMENT_DIRECTION.OUT,
              deletedAt: null,
            },
          });
          if (referencingRefunds > 0) {
            throw new ConflictException('已被退款引用的原回款不能改绑合同订单');
          }
        }
        await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: existing.saleOrderId,
          expectedCustomerId: existing.customerId,
          chargerScope,
          currentEmployeeId,
        });
        const finalOrder = await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: finalSaleOrderId,
          expectedCustomerId: resolvedCustomerId ?? existing.customerId,
          chargerScope,
          currentEmployeeId,
        });
        if (lockedPayment.relatedInvoiceId) {
          const relatedInvoice = await tx.invoice.findFirst({
            where: {
              id: lockedPayment.relatedInvoiceId,
              saleOrderId: finalSaleOrderId,
              customerId: finalOrder.customerId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!relatedInvoice) {
            throw new ConflictException('关联红字发票与最终订单/客户关系不一致，请刷新后重试');
          }
        }
        if (existing.flowStatus === 'approved') {
          if (existing.direction === PAYMENT_DIRECTION.OUT) {
            await assertRefundWithinReceived(tx, {
              saleOrderId: finalSaleOrderId,
              refundAmount: finalPaymentAmount,
              relatedPaymentId: existing.relatedPaymentId!,
              excludeRefundId: id,
            });
          } else {
            await assertPaymentWithinReceivables(tx, {
              saleOrderId: finalSaleOrderId,
              paymentAmount: finalPaymentAmount,
              excludePaymentId: id,
            });
          }
        }
        if (resolvedCustomerId !== undefined && resolvedCustomerId !== finalOrder.customerId) {
          throw new ConflictException('订单客户关系已变化，请刷新后重试');
        }
        const updated = await tx.payment.update({
          where: { id, version: requestVersion },
          data,
          include: PAYMENT_INCLUDE,
        });
        await this.businessApprovalService.syncPendingFormEdit(
          tx,
          pendingApproval,
          approvalEventType,
          updated,
          currentUser
        );
        if (replacementItems) {
          await replacePaymentItemsInTransaction(tx, this.receivableService, {
            paymentId: updated.id,
            saleOrderId: updated.saleOrderId,
            paymentAmount: Number(updated.paymentAmount),
            items: replacementItems,
            currentUser,
          });
        }
        // 若 saleOrderId 改了，旧/新订单都要刷新；金额/flowStatus 变更也需重算。
        const touchedSaleOrderIds = new Set<string>([updated.saleOrderId]);
        if (existing.saleOrderId && existing.saleOrderId !== updated.saleOrderId) {
          touchedSaleOrderIds.add(existing.saleOrderId);
        }
        for (const sid of touchedSaleOrderIds) {
          await recalcSaleOrderPaymentSummary(tx, sid);
        }
        if (
          updated.flowStatus === 'approved' &&
          (replacementItems !== undefined ||
            dto.saleOrderId !== undefined ||
            dto.paymentAmount !== undefined ||
            dto.businessDate !== undefined ||
            dto.bankName !== undefined)
        ) {
          await this.financeLedgerSync.syncFromPayment(tx, updated.id);
        }
        return this.refreshPaymentItemsForResponse(tx, updated);
      });

      const refundabilityMap = await this.computeRefundabilityForInRows([payment]);
      const response = serializePayment(payment, refundabilityMap.get(payment.id));
      await this.changeLog?.logChange({
        module: 'payments',
        action: 'update',
        target: id,
        targetName: response.serialNumber,
        currentUser,
        before: existing,
        after: response,
      });
      return response;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  async submitChangeRequest(
    id: string,
    dto: UpdatePaymentDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const requestVersion = requireRequestVersion(dto.version, '提交回款变更审批');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.legacyAdjustment) {
      throw new BadRequestException('历史负向调整为只读治理记录，禁止发起变更审批');
    }
    const isRefund = existing.direction === PAYMENT_DIRECTION.OUT;
    const recordLabel = isRefund ? '退款记录' : '回款记录';
    if (existing.flowStatus === 'pending') {
      throw new BadRequestException(`${recordLabel}审批中，不允许发起变更，请先撤回审批`);
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException(`只有已审批通过的${recordLabel}需要发起变更审批`);
    }
    if (requestVersion !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }
    if (dto.direction !== undefined && dto.direction !== existing.direction) {
      throw new BadRequestException('direction 字段不可通过变更审批修改');
    }

    const patch = stripUndefinedField(dto, ['version', 'direction']);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有可提交审批的变更内容');
    }
    const baseVersion = requireVersion(existing.version);

    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: isRefund
          ? APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE
          : APPROVAL_EVENT_TYPE.PAYMENT_CHANGE,
        targetType: isRefund
          ? APPROVAL_CHANGE_TARGET_TYPE.PAYMENT_REFUND
          : APPROVAL_CHANGE_TARGET_TYPE.PAYMENT,
        targetId: id,
        targetCode: existing.serialNumber,
        title: `${isRefund ? '退款' : '回款'}变更｜${existing.serialNumber}`,
        baseVersion,
        patch,
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: { ...(existing as unknown as Record<string, unknown>), ...patch },
      },
      currentUser
    );
  }

  async submitVoidRequest(
    id: string,
    dto: VoidApprovalRequestInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.legacyAdjustment) {
      throw new BadRequestException('历史负向调整为只读治理记录，禁止申请作废');
    }
    const isRefund = existing.direction === PAYMENT_DIRECTION.OUT;
    const recordLabel = isRefund ? '退款记录' : '回款记录';
    if (existing.flowStatus === 'pending') {
      throw new BadRequestException(`${recordLabel}审批中，不能申请作废，请先撤回审批`);
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException(`只有已审批通过的${recordLabel}需要申请作废`);
    }
    if (dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    if (!isRefund) {
      const referencingRefunds = await this.prisma.payment.count({
        where: {
          relatedPaymentId: id,
          deletedAt: null,
          direction: PAYMENT_DIRECTION.OUT,
        },
      });
      if (referencingRefunds > 0) {
        throw new BadRequestException(
          `该回款已被 ${referencingRefunds} 笔退款引用，请先作废关联退款`
        );
      }
    }

    const reason = dto.reason.trim();
    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: isRefund
          ? APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE
          : APPROVAL_EVENT_TYPE.PAYMENT_CHANGE,
        targetType: isRefund
          ? APPROVAL_CHANGE_TARGET_TYPE.PAYMENT_REFUND
          : APPROVAL_CHANGE_TARGET_TYPE.PAYMENT,
        targetId: id,
        targetCode: existing.serialNumber,
        title: `${isRefund ? '退款' : '回款'}作废｜${existing.serialNumber}`,
        baseVersion: existing.version,
        patch: { __operation: 'void', __reason: reason },
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: {
          ...(existing as unknown as Record<string, unknown>),
          voidReason: reason,
          deletedAt: '审批通过后作废',
        },
      },
      currentUser
    );
  }

  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    requestVersion: number
  ): Promise<void> {
    requireRequestVersion(requestVersion, '删除回款');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.legacyAdjustment) {
      throw new BadRequestException('历史负向调整为只读治理记录，禁止删除');
    }
    const recordLabel = existing.direction === PAYMENT_DIRECTION.OUT ? '退款记录' : '回款记录';
    this.businessApprovalService.assertCanDelete(existing.flowStatus, recordLabel);

    // 软删除本质是 update，必须按 id + version 做 CAS 并自增版本。
    // soft delete + 订单聚合重算同事务，避免 Payment 软删但 SaleOrder 数字没刷新。
    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        await lockSaleOrderFinancialGraph(tx, existing.saleOrderId);
        const targetWhere: Prisma.PaymentWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerWriteScope(targetWhere, chargerScope, currentEmployeeId);
        const lockedPayment = await tx.payment.findFirst({
          where: targetWhere,
          select: {
            id: true,
            saleOrderId: true,
            customerId: true,
            direction: true,
            flowStatus: true,
          },
        });
        if (
          !lockedPayment ||
          lockedPayment.saleOrderId !== existing.saleOrderId ||
          lockedPayment.customerId !== existing.customerId ||
          lockedPayment.direction !== existing.direction ||
          lockedPayment.flowStatus !== existing.flowStatus
        ) {
          throw new ConflictException('回款/退款版本、关系、状态或访问范围已变化，请刷新后重试');
        }
        this.businessApprovalService.assertCanDelete(lockedPayment.flowStatus, recordLabel);
        await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: lockedPayment.saleOrderId,
          expectedCustomerId: lockedPayment.customerId,
          chargerScope,
          currentEmployeeId,
        });
        if (lockedPayment.direction === PAYMENT_DIRECTION.IN) {
          const referencingRefunds = await tx.payment.count({
            where: {
              relatedPaymentId: id,
              deletedAt: null,
              direction: PAYMENT_DIRECTION.OUT,
            },
          });
          if (referencingRefunds > 0) {
            throw new BadRequestException(
              `该回款已被 ${referencingRefunds} 笔退款引用，请先撤销/删除关联退款后再删除原回款`
            );
          }
        }
        const deletedAt = new Date();
        const row = await tx.payment.update({
          where: { id, version: requestVersion },
          data: {
            deletedAt,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        await softDeletePaymentItemsInTransaction(tx, this.receivableService, {
          paymentIds: [id],
          deletedAt,
          currentUser,
        });
        if (existing.saleOrderId) {
          await recalcSaleOrderPaymentSummary(tx, existing.saleOrderId);
        }
        // CRM 回款 ↔ 财务流水绑定（v2.1）：已 approved 回款被删除时同事务软删派生 ledger
        if (existing.flowStatus === 'approved') {
          await this.financeLedgerSync.revokeFromPayment(tx, id, '回款记录被删除');
        }
        return row;
      });

      await this.changeLog?.logChange({
        module: 'payments',
        action: 'delete',
        target: id,
        targetName: existing.serialNumber,
        currentUser,
        before: existing,
        after: deleted,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  private buildLegacyFilters(query: QueryPaymentDto): Record<string, unknown> {
    return {
      saleOrderId: query.saleOrderId,
      customerId: query.customerId,
      paymentType: query.paymentType,
      direction: query.direction,
      refundType: query.refundType,
      relatedPaymentId: query.relatedPaymentId,
      flowStatus: query.flowStatus,
    };
  }

  private async resolveSaleOrderCustomerId(
    saleOrderId: string,
    inputCustomerId?: string | null,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<string> {
    const where: Prisma.SaleOrderWhereInput = { id: saleOrderId, deletedAt: null };
    applyCustomerCollabViaCustomerWriteScope(where, chargerScope, currentEmployeeId);
    const saleOrder = await this.prisma.saleOrder.findFirst({
      where,
      select: { customerId: true },
    });

    if (!saleOrder) {
      throw new ForbiddenException('无权在该销售订单下登记回款，或订单不存在');
    }

    if (inputCustomerId && inputCustomerId !== saleOrder.customerId) {
      throw new BadRequestException('回款客户必须与关联合同订单客户一致');
    }

    return saleOrder.customerId;
  }

  private assertChargerInScope(
    chargerId: string | null | undefined,
    chargerScope?: string[] | null
  ): void {
    if (!chargerId || chargerScope == null) return;
    if (!chargerScope.includes(chargerId)) {
      throw new ForbiddenException('无权把回款负责人指定到当前数据范围之外');
    }
  }

  /**
   * v2.2 PR-C：按 bankName 反查 finance_account.id
   *
   * v2.2 设计上 payment.financeAccountId 是 syncFromPayment 派生 ledger 的强校验字段，
   * 但前端 payment 表单的「收款账户」字段语义对应的是 bankName（自由文本枚举），
   * financeAccountId 在 createPaymentSchema / web 表单都未暴露。
   *
   * 本方法在 payment create / createRefund / update / batchUpdate 入口前调用，
   * 按 bankName 反查 finance_account.code，再 DB lookup 拿到 id；
   * 不命中映射表（如自定义 bankName 文本）返回 null，由调用方决定降级行为。
   *
   * 不在事务里调（finance_accounts 6 条记录极小、变化频次几乎为 0），
   * 失败也不抛错（让上游决定）。
   */
  private async resolveFinanceAccountIdByBankName(
    bankName: string | null | undefined
  ): Promise<string | null> {
    const code = resolveFinanceAccountCodeByBankName(bankName);
    if (!code) return null;
    const acc = await this.prisma.financeAccount.findFirst({
      where: { code, deletedAt: null },
      select: { id: true },
    });
    return acc?.id ?? null;
  }

  /**
   * Payment 头写入后重读当前活动明细，避免 create/update 返回 mutation 前的旧子集合。
   * 调用点仍在原事务内，因此响应、头表与 PaymentItem 要么一起提交，要么一起回滚。
   */
  private async refreshPaymentItemsForResponse(
    tx: Prisma.TransactionClient,
    payment: PaymentWithIncludes
  ): Promise<PaymentWithIncludes> {
    const paymentItems = await tx.paymentItem.findMany({
      where: { paymentId: payment.id, deletedAt: null },
      select: PAYMENT_ITEM_RESPONSE_SELECT,
      orderBy: [{ itemSeq: 'asc' }, { id: 'asc' }],
    });
    return { ...payment, paymentItems };
  }

  /**
   * v2.2 销售下单：随 payment 一起创建 PaymentItem 子项
   *
   * 校验：
   *  - Σ items.amount 与 paymentAmount 误差 < 0.01
   *  - 每条 item 的 saleOrderProductId 必须属于本 saleOrder（防跨订单挂账）
   *  - OrderProduct 不能软删
   *
   * 行为：
   *  - itemSeq 按数组顺序 1, 2, 3...
   *  - productName 未传时用 OrderProduct.productName 快照
   *  - financeSubjectId 未传时用 OrderProduct.financeSubjectId 继承（仍可能 null）
   *  - 创建后同事务调 receivableService.recalculateForPayment 刷反向缓存
   */
  private async createPaymentItemsForPayment(
    tx: Prisma.TransactionClient,
    paymentId: string,
    saleOrderId: string,
    paymentAmount: number,
    items: NonNullable<CreatePaymentDto['items']>,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<void> {
    const opMap = await validatePaymentItemSplit(tx, saleOrderId, paymentAmount, items);

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      const orderProduct = opMap.get(item.saleOrderProductId)!;
      await tx.paymentItem.create({
        data: {
          paymentId,
          saleOrderProductId: item.saleOrderProductId,
          itemSeq: i + 1,
          productName: item.productName ?? orderProduct.productName,
          amount: item.amount.toFixed(2),
          financeSubjectId: item.financeSubjectId ?? orderProduct.financeSubjectId ?? undefined,
          paymentMode: item.paymentMode,
          remark: item.remark ?? undefined,
          ...auditCreate(currentUser),
        },
      });
    }

    // Payment 头表、PaymentItem 与反向缓存均由调用方同一事务提交或回滚。
    await this.receivableService.recalculateForPayment(tx, paymentId);
  }

  // ========== 批量操作 ==========

  private async filterByPaymentAccessScope(
    ids: string[],
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    select: Prisma.PaymentSelect
  ): Promise<{ accessible: Array<Record<string, unknown>>; skipped: string[] }> {
    const where: Prisma.PaymentWhereInput = {
      id: { in: ids },
      deletedAt: null,
      legacyAdjustment: false,
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const accessible = await this.prisma.payment.findMany({ where, select });
    const accessibleIds = new Set(accessible.map((row: { id: string }) => row.id));
    const skipped = ids.filter((id) => !accessibleIds.has(id));
    return { accessible, skipped };
  }

  private buildPaymentBatchCasWhere(
    rows: Array<{ id: string; flowStatus: string | null }>,
    versions: Record<string, number>,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined
  ): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = {
      deletedAt: null,
      legacyAdjustment: false,
      AND: [
        {
          OR: rows.map((row) => ({
            id: row.id,
            version: versions[row.id],
            flowStatus: row.flowStatus,
          })),
        },
      ],
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    return where;
  }

  private async validateLockedPaymentBatchOrders(
    tx: Prisma.TransactionClient,
    rows: Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      direction: string;
      flowStatus: string | null;
    }>,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    allowPending = false
  ): Promise<void> {
    for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
      if (
        row.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED ||
        (!allowPending && row.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING)
      ) {
        throw new ConflictException('批量回款包含审批中或已审批记录，请刷新后重试');
      }
      await validateFinancialSaleOrderAfterLock(tx, {
        saleOrderId: row.saleOrderId,
        expectedCustomerId: row.customerId,
        chargerScope,
        currentEmployeeId,
      });
    }
  }

  private assertPaymentBatchCasCount(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new ConflictException('批量回款已被其他用户或审批流程修改，请刷新后重试');
    }
  }

  private async loadPaymentLogRows(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.payment.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serialNumber: true,
        paymentType: true,
        businessDate: true,
        payer: true,
        bankName: true,
        tradeSerialNumber: true,
        remark: true,
        chargerId: true,
        chargerName: true,
        flowStatus: true,
        status: true,
        direction: true,
        invoicedByInvoiceId: true,
      },
    });
  }

  async batchTransfer(
    dto: BatchTransferPaymentInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope: string[] | null,
    currentEmployeeId: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, chargerId } = dto;

    const newCharger = await this.prisma.employee.findUnique({
      where: { id: chargerId },
      select: { id: true },
    });
    if (!newCharger) {
      throw new NotFoundException(`员工 ${chargerId} 不存在`);
    }

    const { accessible, skipped } = await this.filterByPaymentAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        saleOrderId: true,
        customerId: true,
        direction: true,
        flowStatus: true,
      }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      direction: string;
      flowStatus: string | null;
    }>;
    const targetRows = accessibleRows.filter(
      (row) =>
        row.flowStatus !== APPROVAL_INSTANCE_STATUS.PENDING &&
        row.flowStatus !== APPROVAL_INSTANCE_STATUS.APPROVED
    );
    skipped.push(
      ...accessibleRows
        .filter((row) => row.flowStatus === 'pending' || row.flowStatus === 'approved')
        .map((row) => row.id)
    );
    if (targetRows.length === 0) return { success: 0, skipped };
    const targetIds = targetRows.map((row) => row.id);
    const beforeRows = await this.loadPaymentLogRows(targetIds);

    await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(
        tx,
        targetRows.map((row) => row.saleOrderId)
      );
      const lockedRows = await tx.payment.findMany({
        where: this.buildPaymentBatchCasWhere(targetRows, versions, null, null),
        select: {
          id: true,
          saleOrderId: true,
          customerId: true,
          direction: true,
          flowStatus: true,
        },
      });
      this.assertPaymentBatchCasCount(lockedRows.length, targetRows.length);
      await this.validateLockedPaymentBatchOrders(tx, lockedRows, null, null);
      const result = await tx.payment.updateMany({
        where: this.buildPaymentBatchCasWhere(targetRows, versions, null, null),
        data: {
          chargerId,
          chargerName: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertPaymentBatchCasCount(result.count, targetRows.length);
    });

    const afterRows = await this.loadPaymentLogRows(targetIds);
    await this.writeBatchChangeLogs('batch-transfer', currentUser, beforeRows, afterRows);

    return { success: targetRows.length, skipped };
  }

  async batchUpdate(
    dto: BatchUpdatePaymentInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, patch } = dto;

    // v2.2 PR-C：用 Unchecked 类型以便直接写 FK scalar `financeAccountId`
    //（PaymentUpdateManyMutationInput Checked 模式不暴露 FK；updateMany 不支持 relation connect）
    const data: Prisma.PaymentUncheckedUpdateManyInput = {};
    if (patch.paymentType !== undefined) data.paymentType = patch.paymentType;
    if (patch.businessDate !== undefined)
      data.businessDate = patch.businessDate ? new Date(patch.businessDate) : null;
    if (patch.payer !== undefined) data.payer = patch.payer;
    if (patch.bankName !== undefined) {
      data.bankName = patch.bankName;
      // 批量改 bankName 同步刷新 financeAccountId（updateMany 直接 scalar 赋值）
      data.financeAccountId = await this.resolveFinanceAccountIdByBankName(patch.bankName);
    }
    if (patch.tradeSerialNumber !== undefined) data.tradeSerialNumber = patch.tradeSerialNumber;
    if (patch.remark !== undefined) data.remark = patch.remark;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('至少需要修改一个字段');
    }

    const { accessible, skipped } = await this.filterByPaymentAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        saleOrderId: true,
        customerId: true,
        direction: true,
        flowStatus: true,
      }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      direction: string;
      flowStatus: string | null;
    }>;
    const editableRows = accessibleRows.filter(
      (row) => row.flowStatus !== APPROVAL_INSTANCE_STATUS.APPROVED
    );
    const lockedIds = accessibleRows
      .filter((row) => row.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED)
      .map((row) => row.id);
    skipped.push(...lockedIds);
    if (editableRows.length === 0) {
      return { success: 0, skipped };
    }

    const editableIds = editableRows.map((row) => row.id);
    const beforeRows = await this.loadPaymentLogRows(editableIds);
    await this.prisma.$transaction(async (tx) => {
      const pendingApprovalLocks = new Map<
        string,
        Awaited<ReturnType<typeof this.businessApprovalService.lockPendingFormEdit>>
      >();
      for (const row of editableRows
        .filter((item) => item.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING)
        .sort((left, right) => left.id.localeCompare(right.id))) {
        const eventType =
          row.direction === PAYMENT_DIRECTION.OUT
            ? APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE
            : APPROVAL_EVENT_TYPE.PAYMENT_APPROVE;
        pendingApprovalLocks.set(
          row.id,
          await this.businessApprovalService.lockPendingFormEdit(
            tx,
            eventType,
            row.id,
            row.flowStatus,
            currentUser
          )
        );
      }
      await lockSaleOrderFinancialGraph(
        tx,
        editableRows.map((row) => row.saleOrderId)
      );
      const lockedRows = await tx.payment.findMany({
        where: this.buildPaymentBatchCasWhere(
          editableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        select: {
          id: true,
          saleOrderId: true,
          customerId: true,
          direction: true,
          flowStatus: true,
        },
      });
      this.assertPaymentBatchCasCount(lockedRows.length, editableRows.length);
      await this.validateLockedPaymentBatchOrders(
        tx,
        lockedRows,
        chargerScope,
        currentEmployeeId,
        true
      );
      const result = await tx.payment.updateMany({
        where: this.buildPaymentBatchCasWhere(
          editableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        data: {
          ...data,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertPaymentBatchCasCount(result.count, editableRows.length);
      if (pendingApprovalLocks.size > 0) {
        const updatedPendingRows = await tx.payment.findMany({
          where: { id: { in: [...pendingApprovalLocks.keys()] }, deletedAt: null },
          select: {
            id: true,
            version: true,
            serialNumber: true,
            paymentAmount: true,
            direction: true,
            refundType: true,
            customer: { select: { id: true, customerName: true, shortName: true } },
            saleOrder: { select: { id: true, serialNumber: true } },
          },
        });
        if (updatedPendingRows.length !== pendingApprovalLocks.size) {
          throw new ConflictException('审批目标已变化，请刷新后重试');
        }
        for (const record of updatedPendingRows.sort((left, right) =>
          left.id.localeCompare(right.id)
        )) {
          const eventType =
            record.direction === PAYMENT_DIRECTION.OUT
              ? APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE
              : APPROVAL_EVENT_TYPE.PAYMENT_APPROVE;
          await this.businessApprovalService.syncPendingFormEdit(
            tx,
            pendingApprovalLocks.get(record.id)!,
            eventType,
            record,
            currentUser
          );
        }
      }
    });

    const afterRows = await this.loadPaymentLogRows(editableIds);
    await this.writeBatchChangeLogs('batch-update', currentUser, beforeRows, afterRows);

    return { success: editableRows.length, skipped };
  }

  async batchApprove(
    dto: BatchApproveInput,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<{ success: number; skipped: Array<{ id: string; reason: string }> }> {
    const allowedEventTypes = new Set<string>([
      APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
      APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE,
      APPROVAL_EVENT_TYPE.PAYMENT_CHANGE,
      APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE,
    ]);

    const skipped: Array<{ id: string; reason: string }> = [];
    let success = 0;

    for (const instanceId of dto.instanceIds) {
      try {
        const instance = await this.prisma.approvalInstance.findUnique({
          where: { id: instanceId },
          select: { eventType: true },
        });
        if (!instance) {
          skipped.push({ id: instanceId, reason: '审批实例不存在' });
          continue;
        }
        if (!allowedEventTypes.has(instance.eventType)) {
          skipped.push({ id: instanceId, reason: '非回款审批，已跳过' });
          continue;
        }
        await this.approvalsService.doApproval(
          instanceId,
          { action: dto.action, comment: dto.comment },
          currentUser
        );
        success += 1;
      } catch (error) {
        const reason =
          error instanceof HttpException
            ? error.message
            : error instanceof Error
              ? error.message
              : '未知错误';
        skipped.push({ id: instanceId, reason });
      }
    }

    return { success, skipped };
  }

  async batchRemove(
    dto: BatchRemovePaymentInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{
    success: number;
    skipped: string[];
    errors: Array<{ id: string; error: string }>;
  }> {
    const { ids, versions } = dto;
    const { accessible, skipped } = await this.filterByPaymentAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        saleOrderId: true,
        customerId: true,
        direction: true,
        flowStatus: true,
      }
    );
    const errors = skipped.map((id) => ({ id, error: '记录不存在、已删除或无权访问' }));
    if (accessible.length === 0) {
      return { success: 0, skipped, errors };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      direction: string;
      flowStatus: string | null;
    }>;
    const deletableRows = accessibleRows.filter(
      (row) => row.flowStatus !== 'pending' && row.flowStatus !== 'approved'
    );
    const lockedRows = accessibleRows.filter(
      (row) => row.flowStatus === 'pending' || row.flowStatus === 'approved'
    );
    const lockedIds = lockedRows.map((row) => row.id);
    skipped.push(...lockedIds);
    errors.push(
      ...lockedRows.map((row) => ({
        id: row.id,
        error:
          row.flowStatus === 'pending'
            ? '回款记录审批中，请先撤回审批'
            : '回款记录已审批通过，请发起作废审批',
      }))
    );
    if (deletableRows.length === 0) {
      return { success: 0, skipped, errors };
    }

    const deletableIds = deletableRows.map((row) => row.id);
    const beforeRows = await this.loadPaymentLogRows(deletableIds);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(
        tx,
        deletableRows.map((row) => row.saleOrderId)
      );
      const lockedRows = await tx.payment.findMany({
        where: this.buildPaymentBatchCasWhere(
          deletableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        select: {
          id: true,
          saleOrderId: true,
          customerId: true,
          direction: true,
          flowStatus: true,
        },
      });
      this.assertPaymentBatchCasCount(lockedRows.length, deletableRows.length);
      await this.validateLockedPaymentBatchOrders(tx, lockedRows, chargerScope, currentEmployeeId);
      const deletingIds = new Set(deletableIds);
      for (const row of lockedRows) {
        if (row.direction !== PAYMENT_DIRECTION.IN) continue;
        const referencingRefunds = await tx.payment.count({
          where: {
            relatedPaymentId: row.id,
            direction: PAYMENT_DIRECTION.OUT,
            deletedAt: null,
            id: { notIn: [...deletingIds] },
          },
        });
        if (referencingRefunds > 0) {
          throw new BadRequestException(`回款 ${row.id} 仍被 ${referencingRefunds} 笔退款引用`);
        }
      }
      const result = await tx.payment.updateMany({
        where: this.buildPaymentBatchCasWhere(
          deletableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        data: {
          deletedAt: now,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertPaymentBatchCasCount(result.count, deletableRows.length);

      await softDeletePaymentItemsInTransaction(tx, this.receivableService, {
        paymentIds: deletableIds,
        deletedAt: now,
        currentUser,
      });

      // 软删后该回款不再参与订单回款聚合，重算每个相关订单
      const orderIds = Array.from(new Set(deletableRows.map((row) => row.saleOrderId)));
      for (const oid of orderIds) {
        await recalcSaleOrderPaymentSummary(tx, oid);
      }
    });

    const afterRows = await this.loadPaymentLogRows(deletableIds);
    await this.writeBatchChangeLogs('batch-delete', currentUser, beforeRows, afterRows);

    return { success: deletableRows.length, skipped, errors };
  }

  /**
   * 合并开票（v1）：选 N 条回款合并开一张发票。
   *
   * 严校验：
   * - 所有 payment 同 customerId
   * - 所有 payment 同 saleOrderId
   * - 所有 payment direction='IN'（OUT 退款不允许合并开票）
   * - 所有 payment flowStatus='approved'（草稿/驳回的不入合并）
   * - 所有 payment invoicedByInvoiceId 为空（未合并过）
   * - 所有 payment 在调用方 chargerScope 可见（越权抛错）
   *
   * 任一不满足整笔拒绝（不静默 skip），让前端清晰提示哪几条不符。
   */
  async mergeInvoice(
    dto: MergeInvoiceInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<InvoiceResponseOutput> {
    const { paymentIds, invoice: invoiceFields } = dto;

    // 1. RBAC 预过滤
    const { accessible, skipped } = await this.filterByPaymentAccessScope(
      paymentIds,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        customerId: true,
        saleOrderId: true,
        direction: true,
        flowStatus: true,
        invoicedByInvoiceId: true,
        paymentAmount: true,
      }
    );
    if (skipped.length > 0) {
      throw new BadRequestException(
        `${skipped.length} 条回款不可见或不存在，无法合并开票（涉及 ID: ${skipped.join(', ')}）`
      );
    }
    if (accessible.length !== paymentIds.length) {
      throw new BadRequestException('部分回款不存在，无法合并开票');
    }

    const rows = accessible as Array<{
      id: string;
      customerId: string;
      saleOrderId: string;
      direction: string;
      flowStatus: string | null;
      invoicedByInvoiceId: string | null;
      paymentAmount: Prisma.Decimal;
    }>;

    // 2. 严校验
    const customerIds = new Set(rows.map((r) => r.customerId));
    if (customerIds.size > 1) {
      throw new BadRequestException('合并开票要求所有回款属于同一客户');
    }
    const saleOrderIds = new Set(rows.map((r) => r.saleOrderId));
    if (saleOrderIds.size > 1) {
      throw new BadRequestException('合并开票要求所有回款属于同一订单（v1 限制）');
    }
    const wrongDirection = rows.filter((r) => r.direction !== PAYMENT_DIRECTION.IN);
    if (wrongDirection.length > 0) {
      throw new BadRequestException(
        `${wrongDirection.length} 条为退款（OUT）记录，不能用于合并开票`
      );
    }
    const notApproved = rows.filter((r) => r.flowStatus !== 'approved');
    if (notApproved.length > 0) {
      throw new BadRequestException(`${notApproved.length} 条回款尚未审批通过，不能用于合并开票`);
    }
    const alreadyMerged = rows.filter((r) => r.invoicedByInvoiceId !== null);
    if (alreadyMerged.length > 0) {
      throw new BadRequestException(
        `${alreadyMerged.length} 条回款已被合并到其他发票，不能重复合并`
      );
    }

    const customerId = rows[0]?.customerId ?? '';
    const saleOrderId = rows[0]?.saleOrderId ?? '';

    // 3. 事务内按固定图加锁后重新读取全部来源；事务外 rows 仅用于快速失败与确定候选订单。
    let approvalInstanceId: string | undefined;
    const accessibleIds = rows.map((r) => r.id);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(tx, saleOrderId);
      const lockedWhere: Prisma.PaymentWhereInput = {
        id: { in: accessibleIds },
        deletedAt: null,
      };
      applyCustomerCollabViaCustomerWriteScope(lockedWhere, chargerScope, currentEmployeeId);
      const lockedPayments = await tx.payment.findMany({
        where: lockedWhere,
        select: {
          id: true,
          customerId: true,
          saleOrderId: true,
          direction: true,
          flowStatus: true,
          invoicedByInvoiceId: true,
          paymentAmount: true,
        },
        orderBy: { id: 'asc' },
      });
      if (lockedPayments.length !== accessibleIds.length) {
        throw new ConflictException('部分回款已变化、删除或超出当前写入范围，请刷新后重试');
      }
      if (
        lockedPayments.some(
          (row) =>
            row.saleOrderId !== saleOrderId ||
            row.customerId !== customerId ||
            row.direction !== PAYMENT_DIRECTION.IN ||
            row.flowStatus !== 'approved' ||
            row.invoicedByInvoiceId !== null
        )
      ) {
        throw new ConflictException(
          '合并来源的订单、客户、方向、审批或占用状态已变化，请刷新后重试'
        );
      }
      const lockedOrder = await validateFinancialSaleOrderAfterLock(tx, {
        saleOrderId,
        expectedCustomerId: customerId,
        chargerScope,
        currentEmployeeId,
      });
      const lockedInvoiceAmount = lockedPayments.reduce(
        (sum, row) => sum + Number(row.paymentAmount),
        0
      );
      await assertInvoiceWithinOrderAmount(tx, {
        saleOrderId,
        invoiceAmount: lockedInvoiceAmount,
        invoiceStatus: invoiceFields.invoiceStatus,
      });

      const merged = await this.invoicesService.createForMerge(tx, {
        saleOrderId,
        customerId: lockedOrder.customerId,
        invoiceAmount: lockedInvoiceAmount,
        sourcePaymentIds: accessibleIds,
        invoiceFields,
        currentUser,
        chargerId: lockedOrder.chargerId,
      });
      approvalInstanceId = merged.approvalInstanceId;

      const claimed = await tx.payment.updateMany({
        where: {
          id: { in: accessibleIds },
          customerId,
          saleOrderId,
          direction: PAYMENT_DIRECTION.IN,
          flowStatus: 'approved',
          deletedAt: null,
          invoicedByInvoiceId: null,
        },
        data: {
          invoicedByInvoiceId: merged.invoice.id,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      if (claimed.count !== accessibleIds.length) {
        throw new ConflictException('部分回款已被其他开票操作占用，请刷新后重试');
      }
      return merged.invoice;
    });

    // 6. 事务外通知 + 审计
    if (approvalInstanceId) {
      this.approvalsService.notifyOnSubmit(approvalInstanceId).catch(() => {});
    }
    // 仅写 invoice 维度的 merge-invoice 日志；回款维度的反向引用变更不单独记
    await this.changeLog?.logChange({
      module: 'invoices',
      action: 'merge-invoice',
      target: result.id,
      targetName: result.invoiceNumber ?? result.serialNumber,
      currentUser,
      after: { ...result, sourcePaymentIds: accessibleIds },
    });

    return result;
  }

  private async writeBatchChangeLogs(
    action: 'batch-transfer' | 'batch-update' | 'batch-delete',
    currentUser: { id: string; employeeId?: string | null },
    beforeRows: Array<Record<string, unknown>>,
    afterRows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (!this.changeLog) return;
    const afterById = new Map(afterRows.map((row) => [String(row.id), row]));
    for (const before of beforeRows) {
      const id = String(before.id);
      const after = afterById.get(id);
      if (!after) continue;
      await this.changeLog.logChange({
        module: 'payments',
        action,
        target: id,
        targetName: before.serialNumber as string,
        currentUser,
        before,
        after,
      });
    }
  }
}

function stripUndefinedField<T extends object>(
  input: T,
  omit: string[] = []
): Record<string, unknown> {
  const omitted = new Set(omit);
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => !omitted.has(key) && value !== undefined)
  );
}

function requireRequestVersion(version: unknown, operation: string): number {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException(`${operation}必须携带有效的 version`);
  }
  return version;
}

function requireVersion(version: number | undefined): number {
  if (version === undefined) {
    throw new BadRequestException('单据缺少版本号，无法发起变更审批');
  }
  return version;
}
