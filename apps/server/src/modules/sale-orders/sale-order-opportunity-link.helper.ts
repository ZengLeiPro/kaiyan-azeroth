import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import {
  type LockedSaleOrderRow,
  lockSaleOrderAdvisoryKeys,
  lockSaleOrderGraph,
} from './sale-order-lock-protocol.helper';

/**
 * 串行化同一商机与有效合同订单之间的关联写入。
 *
 * Opportunity 改绑/软删与 SaleOrder 新建/改绑必须共用这把事务级锁；调用方应在
 * 获取锁后、持锁事务内完成关联检查和业务写入，避免并发建单穿透应用层检查。
 */
export async function lockSaleOrderOpportunity(
  tx: Prisma.TransactionClient,
  opportunityId: string
): Promise<void> {
  await lockSaleOrderAdvisoryKeys(tx, [{ kind: 'opportunity', id: opportunityId }]);
}

/** 多商机改绑统一按 id 排序取共用 advisory lock，禁止 A→B / B→A 反向等待。 */
export async function lockSaleOrderOpportunities(
  tx: Prisma.TransactionClient,
  opportunityIds: readonly (string | null | undefined)[]
): Promise<void> {
  const orderedIds = [...new Set(opportunityIds.filter((id): id is string => Boolean(id)))].sort();
  for (const opportunityId of orderedIds) {
    await lockSaleOrderOpportunity(tx, opportunityId);
  }
}

export interface SaleOrderOpportunityRelationshipRef {
  saleOrderId: string;
  opportunityId?: string | null;
  customerId?: string | null;
}

/**
 * SaleOrder 改绑/void/remove 的完整关系锁图。
 *
 * relationship + financial advisory 先统一排序，随后严格执行
 * SaleOrder → child → Opportunity → Customer。返回后调用方必须重读并验证版本、
 * deletedAt、flowStatus、客户/商机关系与 scope，不能复用锁前快照。
 */
export async function lockSaleOrderRelationshipsBeforeCustomerTouch(
  tx: Prisma.TransactionClient,
  refs: readonly SaleOrderOpportunityRelationshipRef[],
  extra?: {
    opportunityIds?: readonly (string | null | undefined)[];
    customerIds?: readonly (string | null | undefined)[];
  }
): Promise<LockedSaleOrderRow[]> {
  const saleOrderIds = refs.map((ref) => ref.saleOrderId);
  const opportunityIds = [
    ...refs.map((ref) => ref.opportunityId),
    ...(extra?.opportunityIds ?? []),
  ];
  const customerIds = [...refs.map((ref) => ref.customerId), ...(extra?.customerIds ?? [])];
  return lockSaleOrderGraph(tx, {
    financialSaleOrderIds: saleOrderIds,
    relationshipOpportunityIds: opportunityIds,
    saleOrderIds,
    customerIds,
  });
}

/**
 * Opportunity 改客户/阶段/删除与 SaleOrder 建单共用的关系图。
 * advisory 后先发现并锁定关联订单及其 child，再锁 Opportunity 和新旧 Customer。
 */
export async function lockOpportunityRelationshipGraph(
  tx: Prisma.TransactionClient,
  opportunityIds: readonly (string | null | undefined)[],
  customerIds: readonly (string | null | undefined)[] = []
): Promise<LockedSaleOrderRow[]> {
  return lockSaleOrderGraph(tx, {
    relationshipOpportunityIds: opportunityIds,
    discoverSaleOrdersForOpportunityIds: opportunityIds,
    customerIds,
  });
}

/**
 * 断言商机没有其他有效合同订单。
 *
 * 前置条件：调用方已经在当前事务持有 lockSaleOrderOpportunity 对应的锁。
 * 该函数刻意不自行取锁，便于 Opportunity 在同一临界区内按“锁 → 检查 → CAS”执行。
 */
export async function assertOpportunityHasNoActiveSaleOrder(
  tx: Prisma.TransactionClient,
  opportunityId: string,
  excludeSaleOrderId?: string
): Promise<void> {
  const linkedOrder = await tx.saleOrder.findFirst({
    where: {
      opportunityId,
      deletedAt: null,
      ...(excludeSaleOrderId ? { id: { not: excludeSaleOrderId } } : {}),
    },
    select: {
      serialNumber: true,
      orderTitle: true,
    },
  });

  if (!linkedOrder) return;

  const orderName = linkedOrder.orderTitle ?? linkedOrder.serialNumber;
  throw new ConflictException(`该商机已关联合同订单「${orderName}」，一条商机只能对应一份合同订单`);
}

/**
 * 商机与有效合同订单严格一对一。
 *
 * 生产库保留少量历史一商机多订单数据，因此不能直接给 opportunityId 加普通唯一索引。
 * 新建或改绑时先用事务级 advisory lock 串行化同一商机，再检查是否已有有效订单；
 * 数据库触发器用同一把锁兜底所有绕过应用服务的写入。
 */
export async function assertOpportunityAvailableForSaleOrder(
  tx: Prisma.TransactionClient,
  opportunityId: string,
  excludeSaleOrderId?: string
): Promise<void> {
  await lockSaleOrderOpportunity(tx, opportunityId);
  await assertOpportunityHasNoActiveSaleOrder(tx, opportunityId, excludeSaleOrderId);
}
