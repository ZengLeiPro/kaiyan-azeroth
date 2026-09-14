import { ORDER_STATUS, PAYMENT_DIRECTION } from '@ky-azeroth/shared/constants';
import { ConflictException, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { recomputeCustomerAccountsReceivable } from '../customers/customer-accounts-receivable.helper';
import { assertBadDebtAmountWithinOutstanding } from './financial-limits.helper';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const MAX_RETRIES = 3;
const logger = new Logger('recalcSaleOrderPaymentSummary');

/**
 * 根据回款/退款聚合派生 5 态订单状态。
 *
 * 派生规则（与 ORDER_STATUS 常量定义一致）：
 *   gross     = SUM(IN  approved paymentAmount)
 *   refunded  = SUM(OUT approved paymentAmount)
 *   net       = gross - refunded
 *
 *   - gross = 0 且 refunded = 0                       → 未回款
 *   - gross = 0 且 refunded > 0                       → 异常（IN 已被删但 OUT 还在），抛错
 *   - refunded > 0 且 refunded < gross                → 部分退款
 *   - refunded > 0 且 refunded >= gross > 0           → 全额退款
 *   - refunded = 0 且 net < receivablesBase           → 部分回款
 *   - refunded = 0 且 net >= receivablesBase > 0      → 全额回款
 *
 * receivablesBase 取 totalReceivables ?? orderAmount。
 * 若两者皆空（极少数本系统订单），无法判定"全额"，按 net>0 一律记为"部分回款"。
 *
 * 关于异常分支：正常业务流程中 SUM(OUT) 永远不会大于 SUM(IN)（assertRefundWithinReceived
 * 在审批通过前就会拒绝）。若聚合出现 gross=0 && refunded>0，说明 IN 被异常软删（已通过
 * payments.service.remove 的引用校验阻止）或 SQL 层数据被绕过修改——此时不应静默
 * 派生为"未回款"掩盖数据异常，应当让重算流程显式失败，由日志/告警暴露问题。
 */
export function deriveOrderStatus(
  gross: Decimal,
  refunded: Decimal,
  receivablesBase: Decimal | null
): string {
  const ZERO = new Decimal(0);
  if (gross.lte(ZERO)) {
    if (refunded.gt(ZERO)) {
      throw new ConflictException(
        `订单状态派生异常：SUM(IN)=${gross.toFixed(2)} 但 SUM(OUT)=${refunded.toFixed(2)}。` +
          '通常意味着原回款已被异常删除但退款仍存活，请人工核查。'
      );
    }
    return ORDER_STATUS.NOT_RECEIVED;
  }
  if (refunded.gt(ZERO)) {
    if (refunded.gte(gross)) {
      return ORDER_STATUS.FULLY_REFUNDED;
    }
    return ORDER_STATUS.PARTIALLY_REFUNDED;
  }
  // refunded == 0
  const net = gross.sub(refunded);
  if (receivablesBase != null && receivablesBase.gt(ZERO) && net.gte(receivablesBase)) {
    return ORDER_STATUS.FULLY_RECEIVED;
  }
  return ORDER_STATUS.PARTIALLY_RECEIVED;
}

/**
 * 重算订单的"已收款金额 + 已退款总额 + 未收款余额 + orderStatus"并物化到 SaleOrder。
 *
 * 触发点：
 * - 本地 PaymentsService.create/update/remove（IN 与 OUT 都触发）
 * - approvals.service.ts 在 payment_approve / payment_refund_approve 通过/驳回/撤回后
 * - InvoicesService 冲红 / red-void 不直接影响（但可能间接通过 OUT 退款触发）
 *
 * 口径（基于 Payment.flowStatus='approved' AND deletedAt IS NULL）：
 *   gross           = SUM(IN paymentAmount)
 *   refunded        = SUM(OUT paymentAmount WHERE legacyAdjustment=false)
 *   adjustment      = SUM(OUT paymentAmount WHERE legacyAdjustment=true)
 *   net             = gross - refunded - adjustment
 *   totalReceived   = net                                （净收，已扣退款）
 *   totalRefunded   = refunded                           （已退总额）
 *   totalUncollected= max(receivablesBase - gross - badDebtAmount, 0) （未收=应收减毛收再扣坏账）
 *   orderStatus     = legacyAdjustment=true ? 历史冲正 : deriveOrderStatus(...)
 *
 * ⚠ totalUncollected 用 gross 而非 net 是有意为之：
 *   未收余额表达的是"客户应付但还没付的钱"。退款已经发生过"收到"事实，
 *   不应把它折回到"未收"——否则会让 status=部分退款的订单同时显示
 *   "未收 800/已退 800"，导致催收报表（accountsReceivable / 账龄分析 /
 *   缺口侦探）误把已退款"重复计入"客户欠款。已退维度由 totalRefunded
 *   单独承载，两个口径互不污染。坏账金额则是确认无法收回的应收核销，
 *   会从未收余额中扣除，但不会伪造成实际回款。
 *
 * 字段维护策略：
 * - totalReceived：本 helper 维护（净收 = gross - refunded - adjustment）
 * - totalRefunded：本 helper 维护（已退总额）
 * - lastPaymentDate：本 helper 维护（MAX(IN approved businessDate)，与 gross 同口径）
 * - totalUncollected：本 helper 维护（毛口径 = max(receivablesBase - gross, 0)）
 * - totalReceivables：本 helper 不动（其语义="应收"，由订单业务决定）
 * - orderStatus：本 helper 维护，前端表单不应提交此字段
 *
 * 并发安全：
 * - 使用 version 做乐观锁 CAS，避免并发 IN/OUT 互相覆盖
 * - 聚合是幂等的，单订单冲突时内部最多重试 MAX_RETRIES 次后必定收敛
 * - 已软删订单（deletedAt != null）直接 early return
 */
export async function recalcSaleOrderPaymentSummary(
  prisma: PrismaLike,
  saleOrderId: string
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const order = await prisma.saleOrder.findFirst({
      where: { id: saleOrderId, deletedAt: null },
      select: {
        orderAmount: true,
        totalReceivables: true,
        badDebtAmount: true,
        legacyAdjustment: true,
        version: true,
        customerId: true,
      },
    });
    if (!order) return;

    const [aggIn, aggRefund, aggLegacyAdjustment] = await Promise.all([
      prisma.payment.aggregate({
        where: {
          saleOrderId,
          flowStatus: 'approved',
          deletedAt: null,
          direction: PAYMENT_DIRECTION.IN,
        },
        _sum: { paymentAmount: true },
        _max: { businessDate: true },
      }),
      prisma.payment.aggregate({
        where: {
          saleOrderId,
          flowStatus: 'approved',
          deletedAt: null,
          direction: PAYMENT_DIRECTION.OUT,
          legacyAdjustment: false,
        },
        _sum: { paymentAmount: true },
      }),
      prisma.payment.aggregate({
        where: {
          saleOrderId,
          flowStatus: 'approved',
          deletedAt: null,
          direction: PAYMENT_DIRECTION.OUT,
          legacyAdjustment: true,
        },
        _sum: { paymentAmount: true },
      }),
    ]);

    const gross =
      aggIn._sum.paymentAmount != null ? new Decimal(aggIn._sum.paymentAmount) : new Decimal(0);
    const refunded =
      aggRefund._sum.paymentAmount != null
        ? new Decimal(aggRefund._sum.paymentAmount)
        : new Decimal(0);
    const legacyAdjustment =
      aggLegacyAdjustment._sum.paymentAmount != null
        ? new Decimal(aggLegacyAdjustment._sum.paymentAmount)
        : new Decimal(0);
    const net = gross.sub(refunded).sub(legacyAdjustment);

    const receivablesBaseRaw = order.totalReceivables ?? order.orderAmount;
    const receivablesBase = receivablesBaseRaw != null ? new Decimal(receivablesBaseRaw) : null;
    const badDebtAmount = new Decimal(order.badDebtAmount ?? 0);
    if (receivablesBase != null) {
      assertBadDebtAmountWithinOutstanding({
        badDebtAmount,
        receivablesBase,
        approvedGross: gross,
      });
    }
    const orderStatus = order.legacyAdjustment
      ? ORDER_STATUS.LEGACY_ADJUSTMENT
      : deriveOrderStatus(gross, refunded, receivablesBase);

    const data: Prisma.SaleOrderUpdateInput = {
      totalReceived: net.toFixed(2),
      totalRefunded: refunded.toFixed(2),
      // 最近回款日期 = MAX(IN approved businessDate)，与 gross 同口径；
      // 全部回款被删/驳回时聚合为 null，随之清空
      lastPaymentDate: aggIn._max.businessDate ?? null,
      orderStatus,
      version: { increment: 1 },
    };

    if (receivablesBase != null) {
      // 用 gross（毛收）而非 net（净收）——见函数 doc 顶部的 ⚠ 段，避免退款被
      // 重复折回"未收"导致客户应收/账龄/缺口侦探类报表误计；再扣除已确认坏账。
      const uncollected = Decimal.max(
        receivablesBase.sub(gross).sub(badDebtAmount),
        new Decimal(0)
      );
      data.totalUncollected = uncollected.toFixed(2);
    }

    try {
      await prisma.saleOrder.update({
        where: { id: saleOrderId, version: order.version },
        data,
      });
      // 派生口径：本订单 totalUncollected 已写回，顺带把客户级 accountsReceivable 重算
      // dingtalk-sync 废弃后这是 accountsReceivable 唯一可靠的写入路径
      await recomputeCustomerAccountsReceivable(prisma, order.customerId);
      return;
    } catch (error) {
      const isVersionConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
      if (!isVersionConflict) throw error;
      if (attempt === MAX_RETRIES) {
        throw new ConflictException(
          `订单 ${saleOrderId} 应收聚合更新冲突，已重试 ${MAX_RETRIES} 次后仍失败`
        );
      }
      logger.warn(`订单 ${saleOrderId} 应收聚合 CAS 冲突，重试 ${attempt}/${MAX_RETRIES}`);
    }
  }
}
