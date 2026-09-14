import { APPROVAL_INSTANCE_STATUS, OPPORTUNITY_STAGE } from '@ky-azeroth/shared/constants';
import type { Prisma } from '@prisma/client';

import { auditUpdate } from '../../common/utils/audit-helper';
import { recomputeCustomerLifecycle } from '../customers/customer-lifecycle';

type LifecycleActor = { id: string; employeeId?: string | null };

export const OPPORTUNITY_WON_SOURCE = {
  MANUAL: 'manual',
  SALE_ORDER: 'sale_order',
} as const;

export interface SaleOrderActivationLifecycleRefs {
  opportunityIds?: readonly (string | null | undefined)[];
  customerIds?: readonly (string | null | undefined)[];
  /**
   * 本次事务确实移除了一条 approved / legacy NULL 有效订单事实的商机。
   * 只有这些商机在已无其他有效订单时才允许回退订单派生 WON；pending→rejected/draft
   * 并未移除有效事实，必须保留审批期间人工设置的 WON。
   */
  retractedOpportunityIds?: readonly (string | null | undefined)[];
}

/** approved 与迁移前的 legacy NULL 才是已经生效的合同订单。 */
export function isEffectiveSaleOrderFlowStatus(flowStatus: string | null | undefined): boolean {
  return flowStatus === null || flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED;
}

/**
 * 依据有效合同订单事实统一校准商机与客户生命周期。
 *
 * 前置条件：调用方已通过 sale-order-lock-protocol 持有完整
 * SaleOrder → Payment/Invoice/PaymentItem → Opportunity → Customer 图锁。helper 自身禁止从
 * Opportunity 反向补锁 SaleOrder，以免审批/财务入口形成逆序死锁。
 *
 * 首次由有效订单把非 WON 商机推进为 WON 时记录 sale_order provenance，并保存此前阶段、
 * 成交日和赢单率。最后一份有效订单失效时，只有明确 sale_order 来源且调用方声明本次确实
 * 撤销了有效事实才恢复快照；manual 与历史 NULL 来源永不覆盖。
 */
export async function reconcileSaleOrderActivationLifecycle(
  tx: Prisma.TransactionClient,
  refs: SaleOrderActivationLifecycleRefs,
  currentUser: LifecycleActor
): Promise<void> {
  const retractedOpportunityIds = new Set(uniqueIds(refs.retractedOpportunityIds));
  const opportunityIds = uniqueIds([...(refs.opportunityIds ?? []), ...retractedOpportunityIds]);
  const customerIds = new Set(uniqueIds(refs.customerIds));

  for (const opportunityId of opportunityIds) {
    // 统一图锁后重读实时主行；version 会继续用于本 helper 内的最终 CAS。
    const opportunity = await tx.opportunity.findUnique({
      where: { id: opportunityId },
      select: {
        id: true,
        customerId: true,
        opportunityStage: true,
        realDealDate: true,
        winRate: true,
        wonSourceType: true,
        wonSourceSaleOrderId: true,
        wonSourcePreviousStage: true,
        wonSourcePreviousDealDate: true,
        wonSourcePreviousWinRate: true,
        deletedAt: true,
        version: true,
      },
    });
    if (!opportunity || opportunity.deletedAt) continue;

    customerIds.add(opportunity.customerId);
    const effectiveOrders = await tx.saleOrder.findMany({
      where: {
        opportunityId,
        deletedAt: null,
        OR: [{ flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED }, { flowStatus: null }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    if (effectiveOrders.length > 0) {
      const effectiveOrderIds = effectiveOrders.map((order) => order.id);
      const sourceSaleOrderId =
        opportunity.wonSourceType === OPPORTUNITY_WON_SOURCE.SALE_ORDER &&
        opportunity.wonSourceSaleOrderId &&
        effectiveOrderIds.includes(opportunity.wonSourceSaleOrderId)
          ? opportunity.wonSourceSaleOrderId
          : effectiveOrderIds[0]!;
      const currentWinRate = opportunity.winRate == null ? null : Number(opportunity.winRate);

      if (opportunity.opportunityStage !== OPPORTUNITY_STAGE.WON) {
        await tx.opportunity.update({
          where: { id: opportunityId, version: opportunity.version, deletedAt: null },
          data: {
            opportunityStage: OPPORTUNITY_STAGE.WON,
            ...(opportunity.realDealDate ? {} : { realDealDate: new Date() }),
            winRate: '100',
            wonSourceType: OPPORTUNITY_WON_SOURCE.SALE_ORDER,
            wonSourceSaleOrderId: sourceSaleOrderId,
            wonSourcePreviousStage: opportunity.opportunityStage,
            wonSourcePreviousDealDate: opportunity.realDealDate,
            wonSourcePreviousWinRate: opportunity.winRate,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        continue;
      }

      // 人工 WON 与 legacy NULL provenance 的阶段、成交日、赢单率和来源全部保守保留。
      // 只有明确的 sale_order 派生行才允许校准赢单率或切换仍有效的来源订单。
      if (opportunity.wonSourceType !== OPPORTUNITY_WON_SOURCE.SALE_ORDER) continue;

      const shouldRefreshDerivedSource = opportunity.wonSourceSaleOrderId !== sourceSaleOrderId;
      if (currentWinRate == null || currentWinRate < 100 || shouldRefreshDerivedSource) {
        await tx.opportunity.update({
          where: { id: opportunityId, version: opportunity.version, deletedAt: null },
          data: {
            ...(currentWinRate == null || currentWinRate < 100 ? { winRate: '100' } : {}),
            ...(shouldRefreshDerivedSource ? { wonSourceSaleOrderId: sourceSaleOrderId } : {}),
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
      }
      continue;
    }

    if (
      opportunity.wonSourceType === OPPORTUNITY_WON_SOURCE.SALE_ORDER &&
      retractedOpportunityIds.has(opportunityId)
    ) {
      const shouldRestoreWonSnapshot = opportunity.opportunityStage === OPPORTUNITY_STAGE.WON;
      const restoredStage =
        opportunity.wonSourcePreviousStage &&
        opportunity.wonSourcePreviousStage !== OPPORTUNITY_STAGE.WON
          ? opportunity.wonSourcePreviousStage
          : OPPORTUNITY_STAGE.CONTRACT;
      await tx.opportunity.update({
        where: { id: opportunityId, version: opportunity.version, deletedAt: null },
        data: {
          ...(shouldRestoreWonSnapshot
            ? {
                opportunityStage: restoredStage,
                realDealDate: opportunity.wonSourcePreviousDealDate,
                winRate: opportunity.wonSourcePreviousWinRate,
              }
            : {}),
          wonSourceType: null,
          wonSourceSaleOrderId: null,
          wonSourcePreviousStage: null,
          wonSourcePreviousDealDate: null,
          wonSourcePreviousWinRate: null,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
    }
  }

  await recomputeCustomerLifecycle(tx, [...customerIds].sort(), {
    syncLeadProgress: true,
    actor: currentUser,
  });
}

function uniqueIds(values: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))].sort();
}
