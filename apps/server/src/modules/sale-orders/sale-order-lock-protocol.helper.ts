import type { Prisma } from '@prisma/client';

export interface LockedSaleOrderRow {
  id: string;
  customerId: string;
  opportunityId: string | null;
  chargerId: string | null;
  flowStatus: string | null;
  deletedAt: Date | null;
  version: number;
}

export interface SaleOrderLockGraphInput {
  /** 需要参与额度/子记录互斥的订单。 */
  financialSaleOrderIds?: readonly (string | null | undefined)[];
  /** 需要参与商机占用关系互斥的商机。 */
  relationshipOpportunityIds?: readonly (string | null | undefined)[];
  /** 已知需要锁定的订单；会自动并入 financial advisory 集合。 */
  saleOrderIds?: readonly (string | null | undefined)[];
  /** Opportunity 写路径在 relationship advisory 后据此发现并锁定既有订单。 */
  discoverSaleOrdersForOpportunityIds?: readonly (string | null | undefined)[];
  /** 新关系尚未出现在订单行中时需要额外锁定的客户。 */
  customerIds?: readonly (string | null | undefined)[];
  /** 默认 true；锁定订单下所有会参与订单关系/财务一致性的子记录。 */
  lockChildren?: boolean;
}

export type SaleOrderAdvisoryLockRef =
  | { kind: 'financial'; id: string | null | undefined }
  | { kind: 'opportunity'; id: string | null | undefined };

/**
 * 唯一 advisory key 工厂。数据库 trigger、审批域与业务域都沿用这两个既有命名空间；
 * 禁止调用方自行拼接 key，避免同一业务事实被多把互不相认的锁保护。
 */
export function saleOrderAdvisoryLockKey(
  kind: SaleOrderAdvisoryLockRef['kind'],
  id: string
): string {
  return kind === 'financial' ? `sale_order_financial:${id}` : `sale_order_opportunity:${id}`;
}

/** 完整 key 去重排序后再取锁，保证多订单/多商机入口没有 A→B / B→A 反向等待。 */
export async function lockSaleOrderAdvisoryKeys(
  tx: Prisma.TransactionClient,
  refs: readonly SaleOrderAdvisoryLockRef[]
): Promise<void> {
  const keys = [
    ...new Set(refs.flatMap((ref) => (ref.id ? [saleOrderAdvisoryLockKey(ref.kind, ref.id)] : []))),
  ].sort();

  for (const key of keys) {
    // @prisma-raw-sql: 关系与财务 advisory key 先全量排序；模板参数保持 key 参数化。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

/**
 * SaleOrder 关系与财务写入的唯一全局锁序：
 *
 * 1. 所有已知 relationship/financial advisory（完整 key 排序）
 * 2. SaleOrder 行（id 排序，FOR UPDATE）
 * 3. Payment → Invoice → PaymentItem → OrderProduct → Project → ProjectSaleOrder →
 *    FinanceLedger（固定表序、各表 id 排序）
 * 4. Opportunity 行（id 排序，FOR UPDATE）
 * 5. Customer 行（id 排序，FOR UPDATE）
 *
 * `discoverSaleOrdersForOpportunityIds` 只在 relationship advisory 已持有后做无锁发现；
 * 关联写均受同一 relationship advisory/数据库 trigger 约束，因此发现结果在随后 SaleOrder
 * 行锁前不会漂移。发现出的订单不能再倒序补取 financial advisory，否则会与“financial →
 * relationship”入口形成环；其财务竞争由 SaleOrder 行锁串行。
 *
 * 任何调用方都必须在本 helper 返回后才重读并校验业务快照，禁止先锁 child 再补 advisory。
 */
export async function lockSaleOrderGraph(
  tx: Prisma.TransactionClient,
  input: SaleOrderLockGraphInput
): Promise<LockedSaleOrderRow[]> {
  const requestedSaleOrderIds = uniqueIds(input.saleOrderIds);
  const financialSaleOrderIds = uniqueIds([
    ...(input.financialSaleOrderIds ?? []),
    ...requestedSaleOrderIds,
  ]);
  const relationshipOpportunityIds = uniqueIds(input.relationshipOpportunityIds);

  await lockSaleOrderAdvisoryKeys(tx, [
    ...financialSaleOrderIds.map((id) => ({ kind: 'financial' as const, id })),
    ...relationshipOpportunityIds.map((id) => ({ kind: 'opportunity' as const, id })),
  ]);

  const discoveredSaleOrderIds = await discoverLinkedSaleOrderIds(
    tx,
    uniqueIds(input.discoverSaleOrdersForOpportunityIds)
  );
  const saleOrderIds = uniqueIds([
    ...requestedSaleOrderIds,
    ...financialSaleOrderIds,
    ...discoveredSaleOrderIds,
  ]);
  const lockedSaleOrders = await lockSaleOrderRows(tx, saleOrderIds);

  const childCustomerIds =
    input.lockChildren === false ? [] : await lockSaleOrderChildRows(tx, saleOrderIds);

  const opportunityIds = uniqueIds([
    ...relationshipOpportunityIds,
    ...lockedSaleOrders.map((row) => row.opportunityId),
  ]);
  const opportunityCustomerIds = await lockOpportunityRows(tx, opportunityIds);

  const customerIds = uniqueIds([
    ...(input.customerIds ?? []),
    ...lockedSaleOrders.map((row) => row.customerId),
    ...childCustomerIds,
    ...opportunityCustomerIds,
  ]);
  await lockCustomerRows(tx, customerIds);

  return lockedSaleOrders;
}

async function discoverLinkedSaleOrderIds(
  tx: Prisma.TransactionClient,
  opportunityIds: string[]
): Promise<string[]> {
  const discovered: string[] = [];
  for (const opportunityId of opportunityIds) {
    // @prisma-raw-sql: relationship advisory 已持有；只发现当前有效关联，随后统一按 id 锁订单。
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."sale_orders"
      WHERE "opportunityId" = ${opportunityId}
        AND "deletedAt" IS NULL
      ORDER BY "id"
    `;
    if (Array.isArray(rows)) discovered.push(...rows.map((row) => row.id));
  }
  return uniqueIds(discovered);
}

async function lockSaleOrderRows(
  tx: Prisma.TransactionClient,
  saleOrderIds: string[]
): Promise<LockedSaleOrderRow[]> {
  const lockedRows: LockedSaleOrderRow[] = [];
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: Prisma ORM 无法表达 SELECT ... FOR UPDATE；包含软删行供锁后 fail-closed。
    const rows = await tx.$queryRaw<LockedSaleOrderRow[]>`
      SELECT "id", "customerId", "opportunityId", "chargerId", "flowStatus", "deletedAt", "version"
      FROM "public"."sale_orders"
      WHERE "id" = ${saleOrderId}
      FOR UPDATE
    `;
    if (Array.isArray(rows)) lockedRows.push(...rows);
  }
  return lockedRows;
}

async function lockSaleOrderChildRows(
  tx: Prisma.TransactionClient,
  saleOrderIds: string[]
): Promise<string[]> {
  const customerIds: string[] = [];
  // 固定 child 表序与各表 id 顺序。退款与回款共用 payments 表，天然在同一序列内。
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: SaleOrder 删除/改客户与财务写竞争时先锁全部 Payment/Refund 行。
    const rows = await tx.$queryRaw<Array<{ id: string; customerId: string }>>`
      SELECT "id", "customerId"
      FROM "public"."payments"
      WHERE "saleOrderId" = ${saleOrderId}
      ORDER BY "id"
      FOR UPDATE
    `;
    if (Array.isArray(rows)) customerIds.push(...rows.map((row) => row.customerId));
  }
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: Invoice 与 Payment 反向引用统一按 Payment → Invoice 表序。
    const rows = await tx.$queryRaw<Array<{ id: string; customerId: string }>>`
      SELECT "id", "customerId"
      FROM "public"."invoices"
      WHERE "saleOrderId" = ${saleOrderId}
      ORDER BY "id"
      FOR UPDATE
    `;
    if (Array.isArray(rows)) customerIds.push(...rows.map((row) => row.customerId));
  }
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: PaymentItem 通过 Payment 反查订单；FOR UPDATE OF item 只锁子表行。
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT item."id"
      FROM "public"."payment_items" AS item
      INNER JOIN "public"."payments" AS payment ON payment."id" = item."paymentId"
      WHERE payment."saleOrderId" = ${saleOrderId}
      ORDER BY item."id"
      FOR UPDATE OF item
    `;
  }
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: 收款反向缓存会更新 OrderProduct，须在 Opportunity/Customer 前统一预锁。
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."order_products"
      WHERE "saleOrderId" = ${saleOrderId}
      ORDER BY "id"
      FOR UPDATE
    `;
  }
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: 主关联 Project 行属于 SaleOrder 关系子图，并提供最终 Customer 集合。
    const rows = await tx.$queryRaw<Array<{ id: string; customerId: string | null }>>`
      SELECT "id", "customerId"
      FROM "public"."projects"
      WHERE "saleOrderId" = ${saleOrderId}
      ORDER BY "id"
      FOR UPDATE
    `;
    if (Array.isArray(rows)) customerIds.push(...rows.map((row) => row.customerId ?? ''));
  }
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: 项目多订单关联表同样参与客户改绑/作废门禁。
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."project_sale_orders"
      WHERE "saleOrderId" = ${saleOrderId}
      ORDER BY "id"
      FOR UPDATE
    `;
  }
  for (const saleOrderId of saleOrderIds) {
    // @prisma-raw-sql: 非派生财务流水会阻断订单作废，锁后才能得到稳定依赖快照。
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."finance_ledgers"
      WHERE "saleOrderId" = ${saleOrderId}
      ORDER BY "id"
      FOR UPDATE
    `;
  }
  return uniqueIds(customerIds);
}

async function lockOpportunityRows(
  tx: Prisma.TransactionClient,
  opportunityIds: string[]
): Promise<string[]> {
  const customerIds: string[] = [];
  for (const opportunityId of opportunityIds) {
    // @prisma-raw-sql: SaleOrder/Opportunity 占用事实必须在 child 行之后、Customer 之前锁定。
    const rows = await tx.$queryRaw<Array<{ id: string; customerId: string }>>`
      SELECT "id", "customerId"
      FROM "public"."opportunities"
      WHERE "id" = ${opportunityId}
      FOR UPDATE
    `;
    if (Array.isArray(rows)) customerIds.push(...rows.map((row) => row.customerId));
  }
  return uniqueIds(customerIds);
}

async function lockCustomerRows(
  tx: Prisma.TransactionClient,
  customerIds: string[]
): Promise<void> {
  for (const customerId of customerIds) {
    // @prisma-raw-sql: Customer 永远是 SaleOrder 图的最后一类行锁，兼容 customer-touch triggers。
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."customers"
      WHERE "id" = ${customerId}
      FOR UPDATE
    `;
  }
}

function uniqueIds(values: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))].sort();
}
