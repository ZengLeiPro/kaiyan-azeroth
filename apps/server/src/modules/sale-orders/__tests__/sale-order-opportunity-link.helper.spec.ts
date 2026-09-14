import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  assertOpportunityAvailableForSaleOrder,
  assertOpportunityHasNoActiveSaleOrder,
  lockOpportunityRelationshipGraph,
  lockSaleOrderOpportunities,
  lockSaleOrderOpportunity,
  lockSaleOrderRelationshipsBeforeCustomerTouch,
} from '../sale-order-opportunity-link.helper';

function buildTx(linkedOrder: { serialNumber: string; orderTitle: string | null } | null) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    saleOrder: {
      findFirst: vi.fn().mockResolvedValue(linkedOrder),
    },
  };
}

function rawSqlText(call: unknown[]): string {
  const query = call[0];
  if (Array.isArray(query)) return query.join('?');
  if (query && typeof query === 'object' && 'sql' in query) {
    return String((query as { sql?: unknown }).sql ?? '');
  }
  return String(query ?? '');
}

describe('sale-order-opportunity-link helper', () => {
  it('advisory lock 使用与数据库 trigger 完全相同的稳定参数化 key', async () => {
    const tx = buildTx(null);

    await lockSaleOrderOpportunity(tx as never, 'opp-1');

    expect(rawSqlText(tx.$executeRaw.mock.calls[0] ?? [])).toContain(
      'pg_advisory_xact_lock(hashtextextended('
    );
    expect(tx.$executeRaw.mock.calls[0]?.[1]).toBe('sale_order_opportunity:opp-1');
  });

  it('同一商机尚无有效订单时按 lock → check 顺序允许关联', async () => {
    const tx = buildTx(null);

    await expect(
      assertOpportunityAvailableForSaleOrder(tx as never, 'opp-1')
    ).resolves.toBeUndefined();

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.saleOrder.findFirst).toHaveBeenCalledWith({
      where: { opportunityId: 'opp-1', deletedAt: null },
      select: { serialNumber: true, orderTitle: true },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.saleOrder.findFirst.mock.invocationCallOrder[0]!
    );
  });

  it('同一商机已有有效订单时拒绝新订单', async () => {
    const tx = buildTx({
      serialNumber: 'DD0001',
      orderTitle: '客户A-合同订单',
    });

    await expect(assertOpportunityAvailableForSaleOrder(tx as never, 'opp-1')).rejects.toThrow(
      new ConflictException('该商机已关联合同订单「客户A-合同订单」，一条商机只能对应一份合同订单')
    );
  });

  it('订单编辑时排除自身', async () => {
    const tx = buildTx(null);

    await assertOpportunityAvailableForSaleOrder(tx as never, 'opp-1', 'so-1');

    expect(tx.saleOrder.findFirst).toHaveBeenCalledWith({
      where: {
        opportunityId: 'opp-1',
        deletedAt: null,
        id: { not: 'so-1' },
      },
      select: { serialNumber: true, orderTitle: true },
    });
  });

  it('多商机锁去重并按 id 排序，避免改绑 A→B / B→A 反向等待', async () => {
    const tx = buildTx(null);

    await lockSaleOrderOpportunities(tx as never, ['opp-z', 'opp-a', 'opp-z', null]);

    expect(tx.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      'sale_order_opportunity:opp-a',
      'sale_order_opportunity:opp-z',
    ]);
  });

  it('void/remove 固定执行全部 advisory → SaleOrder → children → Opportunity → Customer', async () => {
    const tx = buildTx(null);

    await lockSaleOrderRelationshipsBeforeCustomerTouch(tx as never, [
      {
        saleOrderId: 'so-z',
        opportunityId: 'opp-z',
        customerId: 'cust-z',
      },
      {
        saleOrderId: 'so-a',
        opportunityId: 'opp-a',
        customerId: 'cust-a',
      },
    ]);

    expect(tx.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      'sale_order_financial:so-a',
      'sale_order_financial:so-z',
      'sale_order_opportunity:opp-a',
      'sale_order_opportunity:opp-z',
    ]);
    expect(tx.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]!
    );

    const lockTables = tx.$queryRaw.mock.calls.map((call) => {
      const sql = rawSqlText(call);
      return [
        'payment_items',
        'project_sale_orders',
        'sale_orders',
        'payments',
        'invoices',
        'order_products',
        'projects',
        'finance_ledgers',
        'opportunities',
        'customers',
      ].find((table) => sql.includes(`"public"."${table}"`));
    });
    expect(lockTables).toEqual([
      'sale_orders',
      'sale_orders',
      'payments',
      'payments',
      'invoices',
      'invoices',
      'payment_items',
      'payment_items',
      'order_products',
      'order_products',
      'projects',
      'projects',
      'project_sale_orders',
      'project_sale_orders',
      'finance_ledgers',
      'finance_ledgers',
      'opportunities',
      'opportunities',
      'customers',
      'customers',
    ]);
    expect(tx.$queryRaw.mock.calls.map((call) => call[1])).toEqual([
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'so-a',
      'so-z',
      'opp-a',
      'opp-z',
      'cust-a',
      'cust-z',
    ]);
  });

  it('Opportunity 图在 relationship advisory 后发现订单，再按完整行锁序收口', async () => {
    const tx = buildTx(null);
    tx.$queryRaw.mockImplementation(async (...call: unknown[]) => {
      const sql = rawSqlText(call);
      const value = call[1];
      if (sql.includes('FROM "public"."sale_orders"') && !sql.includes('FOR UPDATE')) {
        return value === 'opp-1' ? [{ id: 'so-1' }] : [];
      }
      if (sql.includes('FROM "public"."sale_orders"') && value === 'so-1') {
        return [
          {
            id: 'so-1',
            customerId: 'cust-old',
            opportunityId: 'opp-1',
            chargerId: 'emp-1',
            flowStatus: 'approved',
            deletedAt: null,
            version: 3,
          },
        ];
      }
      return [];
    });

    await lockOpportunityRelationshipGraph(tx as never, ['opp-1'], ['cust-new']);

    expect(tx.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
      'sale_order_opportunity:opp-1',
    ]);
    const values = tx.$queryRaw.mock.calls.map((call) => call[1]);
    expect(values[0]).toBe('opp-1'); // 无锁发现
    expect(values).toContain('so-1');
    expect(values.slice(-3)).toEqual(['opp-1', 'cust-new', 'cust-old']);
  });

  it('拆分后的 assert 不重复获取锁，供 Opportunity 在同一临界区内复用', async () => {
    const tx = buildTx(null);

    await assertOpportunityHasNoActiveSaleOrder(tx as never, 'opp-1');

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.saleOrder.findFirst).toHaveBeenCalledTimes(1);
  });
});
