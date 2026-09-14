import {
  APPROVAL_INSTANCE_STATUS,
  INVOICE_STATUS,
  PAYMENT_DIRECTION,
} from '@ky-azeroth/shared/constants';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { applyCustomerCollabViaCustomerWriteScope } from '../../common/services/data-scope.service';
import {
  type LockedSaleOrderRow,
  lockSaleOrderAdvisoryKeys,
  lockSaleOrderGraph,
} from './sale-order-lock-protocol.helper';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const CENT_TOLERANCE = 0.005;

export function assertBadDebtAmountWithinOutstanding(params: {
  badDebtAmount: unknown;
  receivablesBase: unknown;
  approvedGross?: unknown;
}): void {
  const badDebtAmount = new Decimal(String(params.badDebtAmount ?? 0));
  const receivablesBase = new Decimal(String(params.receivablesBase ?? 0));
  const approvedGross = new Decimal(String(params.approvedGross ?? 0));
  const upperLimit = Decimal.max(receivablesBase.sub(approvedGross), new Decimal(0));

  if (badDebtAmount.greaterThan(upperLimit)) {
    throw new BadRequestException(
      `坏账金额超出当前可核销未收余额：坏账 ${badDebtAmount.toFixed(2)}，可核销上限 ${upperLimit.toFixed(2)}`
    );
  }
}

/**
 * 按订单串行化所有会收紧/消耗财务额度的写入。
 *
 * 多订单更新按 ID 排序后依次取事务级 advisory lock，避免 A→B / B→A 并发改绑死锁。
 * 调用方必须在同一事务中完成「加锁 → 聚合校验 → 业务写入」。
 */
export async function lockSaleOrderFinancialMutations(
  tx: Prisma.TransactionClient,
  saleOrderIds: string | string[]
): Promise<void> {
  const ids = Array.isArray(saleOrderIds) ? saleOrderIds : [saleOrderIds];
  await lockSaleOrderAdvisoryKeys(
    tx,
    ids.map((id) => ({ kind: 'financial' as const, id }))
  );
}

/**
 * 财务入口使用的完整锁图；禁止只取 advisory 后直接写 Payment/Invoice。
 * 返回的订单行包含软删行，调用方必须继续执行 validateFinancialSaleOrderAfterLock。
 */
export async function lockSaleOrderFinancialGraph(
  tx: Prisma.TransactionClient,
  saleOrderIds: string | readonly string[]
): Promise<LockedSaleOrderRow[]> {
  const ids = Array.isArray(saleOrderIds) ? saleOrderIds : [saleOrderIds];
  return lockSaleOrderGraph(tx, {
    financialSaleOrderIds: ids,
    saleOrderIds: ids,
  });
}

export interface FinancialSaleOrderValidationInput {
  saleOrderId: string;
  expectedCustomerId?: string | null;
  chargerScope?: string[] | null;
  currentEmployeeId?: string | null;
  label?: string;
}

export interface ValidatedFinancialSaleOrder {
  id: string;
  customerId: string;
  opportunityId: string | null;
  chargerId: string | null;
  flowStatus: string | null;
  version: number;
}

/**
 * 在完整锁图之后重读订单的实时 deletedAt/customer/scope/flowStatus。
 * 新财务事实只允许绑定 approved 或迁移前 legacy NULL 的有效订单。
 */
export async function validateFinancialSaleOrderAfterLock(
  tx: Prisma.TransactionClient,
  input: FinancialSaleOrderValidationInput
): Promise<ValidatedFinancialSaleOrder> {
  const where: Prisma.SaleOrderWhereInput = {
    id: input.saleOrderId,
    deletedAt: null,
    legacyAdjustment: false,
    AND: [
      {
        OR: [{ flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED }, { flowStatus: null }],
      },
    ],
  };
  applyCustomerCollabViaCustomerWriteScope(where, input.chargerScope, input.currentEmployeeId);
  const order = await tx.saleOrder.findFirst({
    where,
    select: {
      id: true,
      customerId: true,
      opportunityId: true,
      chargerId: true,
      flowStatus: true,
      version: true,
    },
  });
  if (!order) {
    throw new ForbiddenException(
      `${input.label ?? '销售订单'}不存在、已删除、未生效或已超出当前可写数据范围`
    );
  }
  if (input.expectedCustomerId && input.expectedCustomerId !== order.customerId) {
    throw new BadRequestException('财务记录客户必须与关联合同订单客户一致');
  }
  return order;
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

async function getOrderReceivablesLimit(
  prisma: PrismaLike,
  saleOrderId: string
): Promise<number | null> {
  const order = await prisma.saleOrder.findFirst({
    where: { id: saleOrderId, deletedAt: null },
    select: { orderAmount: true, totalReceivables: true },
  });
  if (!order) return null;
  return toNumber(order.totalReceivables) ?? toNumber(order.orderAmount);
}

async function getOrderAmountLimit(
  prisma: PrismaLike,
  saleOrderId: string
): Promise<number | null> {
  const order = await prisma.saleOrder.findFirst({
    where: { id: saleOrderId, deletedAt: null },
    select: { orderAmount: true },
  });
  if (!order) return null;
  return toNumber(order.orderAmount);
}

/**
 * 校验"新增/调整回款（IN）金额"不超过订单应收总额。
 *
 * 注意：只统计 direction='IN' 的 approved 回款。退款（OUT）不参与正向校验，
 * 否则会出现"退过款后又能多收一笔与退款等额的回款"这种意外口径。
 */
export async function assertPaymentWithinReceivables(
  prisma: PrismaLike,
  params: {
    saleOrderId: string;
    paymentAmount: unknown;
    excludePaymentId?: string;
  }
): Promise<void> {
  const receivablesLimit = await getOrderReceivablesLimit(prisma, params.saleOrderId);
  if (receivablesLimit == null) return;

  const agg = await prisma.payment.aggregate({
    where: {
      saleOrderId: params.saleOrderId,
      flowStatus: 'approved',
      deletedAt: null,
      direction: PAYMENT_DIRECTION.IN,
      ...(params.excludePaymentId ? { id: { not: params.excludePaymentId } } : {}),
    },
    _sum: { paymentAmount: true },
  });

  const approvedAmount = toNumber(agg._sum.paymentAmount) ?? 0;
  const nextAmount = toNumber(params.paymentAmount) ?? 0;
  const nextTotal = approvedAmount + nextAmount;
  if (nextTotal - receivablesLimit > CENT_TOLERANCE) {
    throw new BadRequestException(
      `回款金额超出订单应收总额：已确认 ${formatAmount(approvedAmount)}，本次 ${formatAmount(nextAmount)}，应收 ${formatAmount(receivablesLimit)}`
    );
  }
}

/**
 * 校验"新增/调整退款（OUT）金额"不超过：
 *   1) 订单已收（IN approved 总额）的余额（避免净收变负）
 *   2) 关联原回款（relatedPaymentId）的剩余可退金额（避免单笔回款被多次重复退款）
 *
 * - relatedPaymentId 是必填字段，必须指向同订单同客户的已 approved IN 回款；
 *   跨订单 / 已撤回 / 不存在的关联，直接拒绝。
 * - excludeRefundId 用于 update 场景，自身金额从已确认 OUT 总额中扣除。
 */
export async function assertRefundWithinReceived(
  prisma: PrismaLike,
  params: {
    saleOrderId: string;
    refundAmount: unknown;
    relatedPaymentId: string;
    excludeRefundId?: string;
  }
): Promise<void> {
  // 1) 关联原回款必须存在且为同订单、direction=IN、flowStatus=approved
  const relatedPayment = await prisma.payment.findFirst({
    where: {
      id: params.relatedPaymentId,
      deletedAt: null,
    },
    select: {
      id: true,
      saleOrderId: true,
      customerId: true,
      direction: true,
      flowStatus: true,
      paymentAmount: true,
    },
  });
  if (!relatedPayment) {
    throw new NotFoundException(`关联原回款 ${params.relatedPaymentId} 不存在或已删除`);
  }
  if (relatedPayment.saleOrderId !== params.saleOrderId) {
    throw new BadRequestException(
      `关联原回款 ${params.relatedPaymentId} 属于其他订单（${relatedPayment.saleOrderId}），不允许跨订单退款`
    );
  }
  if (relatedPayment.direction !== PAYMENT_DIRECTION.IN) {
    throw new BadRequestException('关联原回款必须是 IN（回款）方向，不能关联另一笔退款');
  }
  if (relatedPayment.flowStatus !== 'approved') {
    throw new BadRequestException(
      `关联原回款 ${params.relatedPaymentId} 尚未审批通过（当前 ${relatedPayment.flowStatus ?? 'null'}），无法退款`
    );
  }

  // 2) 关联原回款的单笔剩余可退余额校验
  const relatedAmount = toNumber(relatedPayment.paymentAmount) ?? 0;
  const relatedRefundsAgg = await prisma.payment.aggregate({
    where: {
      relatedPaymentId: params.relatedPaymentId,
      flowStatus: 'approved',
      deletedAt: null,
      direction: PAYMENT_DIRECTION.OUT,
      legacyAdjustment: false,
      ...(params.excludeRefundId ? { id: { not: params.excludeRefundId } } : {}),
    },
    _sum: { paymentAmount: true },
  });
  const relatedAlreadyRefunded = toNumber(relatedRefundsAgg._sum.paymentAmount) ?? 0;
  const nextAmount = toNumber(params.refundAmount) ?? 0;
  if (relatedAlreadyRefunded + nextAmount - relatedAmount > CENT_TOLERANCE) {
    throw new BadRequestException(
      `退款金额超出原回款剩余可退余额：原回款 ${formatAmount(relatedAmount)}，已退 ${formatAmount(relatedAlreadyRefunded)}，本次 ${formatAmount(nextAmount)}`
    );
  }

  // 3) 订单维度：OUT 总额 ≤ IN 总额
  const [aggIn, aggOut] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        saleOrderId: params.saleOrderId,
        flowStatus: 'approved',
        deletedAt: null,
        direction: PAYMENT_DIRECTION.IN,
      },
      _sum: { paymentAmount: true },
    }),
    prisma.payment.aggregate({
      where: {
        saleOrderId: params.saleOrderId,
        flowStatus: 'approved',
        deletedAt: null,
        direction: PAYMENT_DIRECTION.OUT,
        legacyAdjustment: false,
        ...(params.excludeRefundId ? { id: { not: params.excludeRefundId } } : {}),
      },
      _sum: { paymentAmount: true },
    }),
  ]);
  const totalIn = toNumber(aggIn._sum.paymentAmount) ?? 0;
  const totalOut = toNumber(aggOut._sum.paymentAmount) ?? 0;
  if (totalOut + nextAmount - totalIn > CENT_TOLERANCE) {
    throw new BadRequestException(
      `退款总额超过订单已收：已收 ${formatAmount(totalIn)}，已退 ${formatAmount(totalOut)}，本次 ${formatAmount(nextAmount)}`
    );
  }
}

export async function assertInvoiceWithinOrderAmount(
  prisma: PrismaLike,
  params: {
    saleOrderId: string;
    invoiceAmount: unknown;
    invoiceStatus?: string | null;
    excludeInvoiceId?: string;
  }
): Promise<void> {
  if (params.invoiceStatus === INVOICE_STATUS.VOID) return;
  if (params.invoiceStatus === INVOICE_STATUS.RED_VOIDED) return;

  const orderAmountLimit = await getOrderAmountLimit(prisma, params.saleOrderId);
  if (orderAmountLimit == null) return;

  const agg = await prisma.invoice.aggregate({
    where: {
      saleOrderId: params.saleOrderId,
      flowStatus: 'approved',
      status: 'active',
      invoiceStatus: { notIn: [INVOICE_STATUS.VOID, INVOICE_STATUS.RED_VOIDED] },
      deletedAt: null,
      ...(params.excludeInvoiceId ? { id: { not: params.excludeInvoiceId } } : {}),
    },
    _sum: { invoiceAmount: true },
  });

  const approvedAmount = toNumber(agg._sum.invoiceAmount) ?? 0;
  const nextAmount = toNumber(params.invoiceAmount) ?? 0;
  const nextTotal = approvedAmount + nextAmount;
  if (nextTotal - orderAmountLimit > CENT_TOLERANCE) {
    throw new BadRequestException(
      `开票金额超出订单合同金额：已开票 ${formatAmount(approvedAmount)}，本次 ${formatAmount(nextAmount)}，合同金额 ${formatAmount(orderAmountLimit)}`
    );
  }
}
