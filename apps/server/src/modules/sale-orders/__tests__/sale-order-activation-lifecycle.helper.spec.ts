import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../customers/customer-lifecycle', () => ({
  recomputeCustomerLifecycle: vi.fn().mockResolvedValue(undefined),
}));

import { recomputeCustomerLifecycle } from '../../customers/customer-lifecycle';
import {
  OPPORTUNITY_WON_SOURCE,
  reconcileSaleOrderActivationLifecycle,
} from '../sale-order-activation-lifecycle.helper';

function buildTx() {
  return {
    opportunity: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    saleOrder: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function buildOpportunity(
  overrides: Partial<{
    id: string;
    customerId: string;
    opportunityStage: string | null;
    realDealDate: Date | null;
    winRate: number | null;
    wonSourceType: string | null;
    wonSourceSaleOrderId: string | null;
    wonSourcePreviousStage: string | null;
    wonSourcePreviousDealDate: Date | null;
    wonSourcePreviousWinRate: number | null;
    deletedAt: Date | null;
    version: number;
  }> = {}
) {
  return {
    id: 'opp-1',
    customerId: 'cust-1',
    opportunityStage: '商务谈判',
    realDealDate: null,
    winRate: 50,
    wonSourceType: null,
    wonSourceSaleOrderId: null,
    wonSourcePreviousStage: null,
    wonSourcePreviousDealDate: null,
    wonSourcePreviousWinRate: null,
    deletedAt: null,
    version: 7,
    ...overrides,
  };
}

const actor = { id: 'user-1', employeeId: 'emp-1' };

describe('reconcileSaleOrderActivationLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有效订单把非 WON 商机推进 WON，并完整保存订单来源和原阶段快照', async () => {
    const tx = buildTx();
    const previousDealDate = new Date('2026-07-01T00:00:00.000Z');
    tx.opportunity.findUnique.mockResolvedValue(
      buildOpportunity({ realDealDate: previousDealDate, winRate: 45 })
    );
    tx.saleOrder.findMany.mockResolvedValue([{ id: 'order-1' }]);

    await reconcileSaleOrderActivationLifecycle(
      tx as never,
      { opportunityIds: ['opp-1'], customerIds: ['cust-1'] },
      actor
    );

    expect(tx.saleOrder.findMany).toHaveBeenCalledWith({
      where: {
        opportunityId: 'opp-1',
        deletedAt: null,
        OR: [{ flowStatus: 'approved' }, { flowStatus: null }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    expect(tx.opportunity.update).toHaveBeenCalledWith({
      where: { id: 'opp-1', version: 7, deletedAt: null },
      data: {
        opportunityStage: '赢单',
        winRate: '100',
        wonSourceType: OPPORTUNITY_WON_SOURCE.SALE_ORDER,
        wonSourceSaleOrderId: 'order-1',
        wonSourcePreviousStage: '商务谈判',
        wonSourcePreviousDealDate: previousDealDate,
        wonSourcePreviousWinRate: 45,
        version: { increment: 1 },
        updaterEmployeeId: 'emp-1',
      },
    });
    expect(recomputeCustomerLifecycle).toHaveBeenCalledWith(tx, ['cust-1'], {
      syncLeadProgress: true,
      actor,
    });
  });

  it('最后一份有效订单明确撤销时，只回退 sale_order 来源并恢复完整快照', async () => {
    const tx = buildTx();
    const previousDealDate = new Date('2026-06-01T00:00:00.000Z');
    tx.opportunity.findUnique.mockResolvedValue(
      buildOpportunity({
        opportunityStage: '赢单',
        realDealDate: new Date('2026-08-01T00:00:00.000Z'),
        winRate: 100,
        wonSourceType: OPPORTUNITY_WON_SOURCE.SALE_ORDER,
        wonSourceSaleOrderId: 'order-1',
        wonSourcePreviousStage: '方案确认',
        wonSourcePreviousDealDate: previousDealDate,
        wonSourcePreviousWinRate: 65,
      })
    );

    await reconcileSaleOrderActivationLifecycle(
      tx as never,
      {
        opportunityIds: ['opp-1'],
        customerIds: ['cust-1'],
        retractedOpportunityIds: ['opp-1'],
      },
      actor
    );

    expect(tx.opportunity.update).toHaveBeenCalledWith({
      where: { id: 'opp-1', version: 7, deletedAt: null },
      data: {
        opportunityStage: '方案确认',
        realDealDate: previousDealDate,
        winRate: 65,
        wonSourceType: null,
        wonSourceSaleOrderId: null,
        wonSourcePreviousStage: null,
        wonSourcePreviousDealDate: null,
        wonSourcePreviousWinRate: null,
        version: { increment: 1 },
        updaterEmployeeId: 'emp-1',
      },
    });
  });

  it.each([
    ['人工 WON', OPPORTUNITY_WON_SOURCE.MANUAL],
    ['历史未知 WON', null],
  ])('%s 即使收到 retracted 也永不被回退', async (_label, wonSourceType) => {
    const tx = buildTx();
    tx.opportunity.findUnique.mockResolvedValue(
      buildOpportunity({
        opportunityStage: '赢单',
        realDealDate: new Date('2026-08-20T00:00:00.000Z'),
        winRate: 100,
        wonSourceType,
      })
    );

    await reconcileSaleOrderActivationLifecycle(
      tx as never,
      { opportunityIds: ['opp-1'], retractedOpportunityIds: ['opp-1'] },
      actor
    );

    expect(tx.opportunity.update).not.toHaveBeenCalled();
  });

  it('pending→rejected/withdraw 未撤销有效事实时不回退订单来源 WON', async () => {
    const tx = buildTx();
    tx.opportunity.findUnique.mockResolvedValue(
      buildOpportunity({
        opportunityStage: '赢单',
        winRate: 100,
        wonSourceType: OPPORTUNITY_WON_SOURCE.SALE_ORDER,
        wonSourceSaleOrderId: 'order-1',
        wonSourcePreviousStage: '商务谈判',
        wonSourcePreviousWinRate: 50,
      })
    );

    await reconcileSaleOrderActivationLifecycle(tx as never, { opportunityIds: ['opp-1'] }, actor);

    expect(tx.opportunity.update).not.toHaveBeenCalled();
  });

  it('仍有其他有效订单时仅切换派生来源，不覆盖首次快照', async () => {
    const tx = buildTx();
    const previousDealDate = new Date('2026-05-01T00:00:00.000Z');
    tx.opportunity.findUnique.mockResolvedValue(
      buildOpportunity({
        opportunityStage: '赢单',
        winRate: 100,
        wonSourceType: OPPORTUNITY_WON_SOURCE.SALE_ORDER,
        wonSourceSaleOrderId: 'order-old',
        wonSourcePreviousStage: '商务谈判',
        wonSourcePreviousDealDate: previousDealDate,
        wonSourcePreviousWinRate: 50,
      })
    );
    tx.saleOrder.findMany.mockResolvedValue([{ id: 'order-new' }]);

    await reconcileSaleOrderActivationLifecycle(
      tx as never,
      { opportunityIds: ['opp-1'], retractedOpportunityIds: ['opp-1'] },
      actor
    );

    expect(tx.opportunity.update).toHaveBeenCalledWith({
      where: { id: 'opp-1', version: 7, deletedAt: null },
      data: {
        wonSourceSaleOrderId: 'order-new',
        version: { increment: 1 },
        updaterEmployeeId: 'emp-1',
      },
    });
  });

  it('商机与客户 id 去重排序，客户生命周期只统一重算一次', async () => {
    const tx = buildTx();
    tx.opportunity.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      buildOpportunity({
        id: where.id,
        customerId: where.id === 'opp-a' ? 'cust-a' : 'cust-b',
      })
    );

    await reconcileSaleOrderActivationLifecycle(
      tx as never,
      {
        opportunityIds: ['opp-b', 'opp-a', 'opp-b'],
        customerIds: ['cust-b', 'cust-a', 'cust-b'],
      },
      actor
    );

    expect(tx.opportunity.findUnique.mock.calls.map((call) => call[0].where.id)).toEqual([
      'opp-a',
      'opp-b',
    ]);
    expect(recomputeCustomerLifecycle).toHaveBeenCalledWith(tx, ['cust-a', 'cust-b'], {
      syncLeadProgress: true,
      actor,
    });
  });
});
