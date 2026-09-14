import { CUSTOMER_LEVEL, DEAL_STATUS, OPPORTUNITY_STAGE } from '@ky-azeroth/shared/constants';
import type { CrmRankingQueryInput, CrmTrendQueryInput } from '@ky-azeroth/shared/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CrmAnalyticsService } from './crm-analytics.service';

function buildPrisma() {
  return {
    customer: {
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    opportunity: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    saleOrder: {
      count: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    payment: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    keepRecord: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    orderProduct: {
      groupBy: vi.fn(),
    },
    employee: {
      findMany: vi.fn(),
    },
  };
}

function buildService() {
  const prisma = buildPrisma();
  return {
    service: new CrmAnalyticsService(
      prisma as unknown as ConstructorParameters<typeof CrmAnalyticsService>[0]
    ),
    prisma,
  };
}

const customRange = { preset: 'custom', startDate: '2026-06-01', endDate: '2026-06-30' } as const;

describe('CrmAnalyticsService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('getKpis 对空数据范围权限早返回零值，避免无意义查询', async () => {
    const { service, prisma } = buildService();

    const result = await service.getKpis(customRange, []);

    expect(result).toEqual({
      range: { preset: 'custom', startDate: '2026-06-01', endDate: '2026-06-30' },
      customerCount: 0,
      opportunityCount: 0,
      saleOrderCount: 0,
      paymentAmount: 0,
      accountsReceivableTotal: 0,
      sleepingSaCount: 0,
    });
    expect(prisma.customer.count).not.toHaveBeenCalled();
    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
  });

  it('getKpis 以 IN-OUT 汇总净回款，并对 Decimal-like 值保留两位', async () => {
    const { service, prisma } = buildService();
    prisma.customer.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3);
    prisma.opportunity.count.mockResolvedValue(4);
    prisma.saleOrder.count.mockResolvedValue(5);
    prisma.payment.aggregate
      .mockResolvedValueOnce({
        _sum: { paymentAmount: { toNumber: () => 1234.567 } },
      })
      .mockResolvedValueOnce({
        _sum: { paymentAmount: { toNumber: () => 234.111 } },
      });
    prisma.customer.aggregate.mockResolvedValue({
      _sum: { accountsReceivable: { toNumber: () => 88.884 } },
    });

    const result = await service.getKpis(customRange, null);

    expect(result.paymentAmount).toBe(1000.46);
    expect(result.accountsReceivableTotal).toBe(88.88);
    expect(result.customerCount).toBe(12);
    expect(result.sleepingSaCount).toBe(3);
    expect(prisma.payment.aggregate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ flowStatus: 'approved', direction: 'IN' }),
      })
    );
    expect(prisma.payment.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ flowStatus: 'approved', direction: 'OUT' }),
      })
    );
  });

  it('getKpis 的业绩指标只按单据固化负责人归因，不跟随客户当前负责人', async () => {
    const { service, prisma } = buildService();
    prisma.customer.count.mockResolvedValue(0);
    prisma.customer.aggregate.mockResolvedValue({ _sum: { accountsReceivable: 0 } });
    prisma.opportunity.count.mockResolvedValue(0);
    prisma.saleOrder.count.mockResolvedValue(0);
    prisma.payment.aggregate.mockResolvedValue({ _sum: { paymentAmount: 0 } });

    await service.getKpis(customRange, ['emp-new']);

    expect(prisma.opportunity.count).toHaveBeenCalledWith({
      where: { deletedAt: null, chargerId: { in: ['emp-new'] } },
    });
    expect(prisma.saleOrder.count).toHaveBeenCalledWith({
      where: { deletedAt: null, chargerId: { in: ['emp-new'] } },
    });
    for (const [args] of prisma.payment.aggregate.mock.calls) {
      expect(args.where).toEqual(
        expect.objectContaining({ chargerId: { in: ['emp-new'] }, deletedAt: null })
      );
      expect(args.where).not.toHaveProperty('OR');
      expect(args.where).not.toHaveProperty('customer');
    }
  });

  it('getFunnel 按固定商机阶段补齐缺失阶段并聚合金额', async () => {
    const { service, prisma } = buildService();
    prisma.opportunity.groupBy.mockResolvedValue([
      {
        opportunityStage: OPPORTUNITY_STAGE.DISCOVER,
        _count: { _all: 2 },
        _sum: { opportunityAmount: 100 },
      },
      {
        opportunityStage: OPPORTUNITY_STAGE.WON,
        _count: { _all: 1 },
        _sum: { opportunityAmount: { toNumber: () => 250.5 } },
      },
    ]);

    const result = await service.getFunnel(customRange, null);

    expect(result.stages).toHaveLength(6);
    expect(result.stages[0]).toEqual({ stage: OPPORTUNITY_STAGE.DISCOVER, count: 2, amount: 100 });
    expect(result.stages.find((item) => item.stage === OPPORTUNITY_STAGE.WON)).toEqual({
      stage: OPPORTUNITY_STAGE.WON,
      count: 1,
      amount: 250.5,
    });
  });

  it('getTrend 对净回款趋势把退款 OUT 作为负数参与桶聚合', async () => {
    const { service, prisma } = buildService();
    prisma.payment.findMany.mockResolvedValue([
      { businessDate: new Date('2026-06-01T10:00:00'), paymentAmount: 100, direction: 'IN' },
      { businessDate: new Date('2026-06-01T11:00:00'), paymentAmount: 30, direction: 'OUT' },
      { businessDate: null, paymentAmount: 999, direction: 'IN' },
    ]);

    const result = await service.getTrend(
      { ...customRange, metric: 'payment_amount', bucket: 'day' } as CrmTrendQueryInput,
      null
    );

    expect(result.points[0]).toEqual({ bucket: '2026-06-01', value: 70, count: 2 });
  });

  it('getDistribution 对客户级别分布计算百分比并按数量倒序', async () => {
    const { service, prisma } = buildService();
    prisma.customer.groupBy.mockResolvedValue([
      { customerLevel: CUSTOMER_LEVEL.A, _count: { _all: 1 } },
      { customerLevel: CUSTOMER_LEVEL.S, _count: { _all: 3 } },
    ]);

    const result = await service.getDistribution('level');

    expect(result.items).toEqual([
      { key: CUSTOMER_LEVEL.S, label: 'S级', count: 3, percentage: 75 },
      { key: CUSTOMER_LEVEL.A, label: 'A级', count: 1, percentage: 25 },
    ]);
  });

  it('getRanking 对销售净回款排行合并 IN/OUT ID，保留 OUT-only 与负净值', async () => {
    const { service, prisma } = buildService();
    prisma.payment.groupBy
      .mockResolvedValueOnce([
        { chargerId: 'emp-1', _sum: { paymentAmount: 100 } },
        { chargerId: 'emp-2', _sum: { paymentAmount: 80 } },
      ])
      .mockResolvedValueOnce([
        { chargerId: 'emp-1', _sum: { paymentAmount: 130 } },
        { chargerId: 'emp-3', _sum: { paymentAmount: 40 } },
      ]);
    prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-1', name: '张三' },
      { id: 'emp-2', name: '李四' },
      { id: 'emp-3', name: '王五' },
    ]);

    const result = await service.getRanking(
      {
        ...customRange,
        dimension: 'salesperson',
        metric: 'paid_amount',
        limit: 3,
      } as CrmRankingQueryInput,
      null
    );

    expect(result.items).toEqual([
      { id: 'emp-2', name: '李四', value: 80 },
      { id: 'emp-1', name: '张三', value: -30 },
      { id: 'emp-3', name: '王五', value: -40 },
    ]);
    expect(prisma.payment.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ take: expect.anything() })
    );
    expect(prisma.payment.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ take: expect.anything() })
    );
  });

  it('getRanking 对销售人员维度按负责人 scope 限制 IN/OUT 两侧', async () => {
    const { service, prisma } = buildService();
    prisma.payment.groupBy.mockResolvedValue([]);
    prisma.employee.findMany.mockResolvedValue([]);

    await service.getRanking(
      {
        ...customRange,
        dimension: 'salesperson',
        metric: 'paid_amount',
        limit: 3,
      } as CrmRankingQueryInput,
      ['emp-2']
    );

    for (const [args] of prisma.payment.groupBy.mock.calls) {
      expect(args.where).toEqual(
        expect.objectContaining({
          chargerId: { in: ['emp-2'] },
          businessDate: { gte: expect.any(Date), lt: expect.any(Date) },
        })
      );
      expect(args.where).not.toHaveProperty('OR');
    }
  });

  it('getRanking 对客户净回款排行合并 IN/OUT ID，保留 OUT-only 与负净值', async () => {
    const { service, prisma } = buildService();
    prisma.payment.groupBy
      .mockResolvedValueOnce([{ customerId: 'cust-1', _sum: { paymentAmount: 20 } }])
      .mockResolvedValueOnce([
        { customerId: 'cust-1', _sum: { paymentAmount: 25 } },
        { customerId: 'cust-2', _sum: { paymentAmount: 10 } },
      ]);
    prisma.customer.findMany.mockResolvedValue([
      { id: 'cust-1', customerName: '客户一', chargerName: '张三' },
      { id: 'cust-2', customerName: '客户二', chargerName: null },
    ]);

    const result = await service.getRanking(
      {
        ...customRange,
        dimension: 'customer',
        metric: 'paid_amount',
        limit: 2,
      } as CrmRankingQueryInput,
      null
    );

    expect(result.items).toEqual([
      { id: 'cust-1', name: '客户一', value: -5, hint: '负责人：张三' },
      { id: 'cust-2', name: '客户二', value: -10, hint: undefined },
    ]);
    for (const [args] of prisma.payment.groupBy.mock.calls) {
      expect(args.where).not.toHaveProperty('createdAt');
      expect(args.where.businessDate).toEqual({
        gte: expect.any(Date),
        lt: expect.any(Date),
      });
    }
  });

  it('getAging 按账龄桶去重客户并累计应收金额', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'));
    const { service, prisma } = buildService();
    prisma.saleOrder.findMany.mockResolvedValue([
      {
        customerId: 'cust-1',
        totalUncollected: 100,
        businessDate: new Date('2026-06-20'),
        createdAt: new Date('2026-06-20'),
      },
      {
        customerId: 'cust-1',
        totalUncollected: 50,
        businessDate: new Date('2026-05-15'),
        createdAt: new Date('2026-05-15'),
      },
      {
        customerId: 'cust-2',
        totalUncollected: 25.456,
        businessDate: new Date('2026-03-01'),
        createdAt: new Date('2026-03-01'),
      },
    ]);

    const result = await service.getAging(null);

    expect(result.buckets).toEqual([
      { label: '0-30 天', customerCount: 1, amount: 100 },
      { label: '31-60 天', customerCount: 1, amount: 50 },
      { label: '61-90 天', customerCount: 0, amount: 0 },
      { label: '90 天以上', customerCount: 1, amount: 25.46 },
    ]);
    expect(result.total).toEqual({ customerCount: 2, amount: 175.46 });
  });

  it('getSleeping 过滤沉睡 S/A 客户并返回距离最近跟进天数', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'));
    const { service, prisma } = buildService();
    prisma.customer.count.mockResolvedValue(2);
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        customerName: '客户一',
        customerLevel: CUSTOMER_LEVEL.S,
        chargerId: 'emp-1',
        chargerName: '张三',
        lastKeepRecordTime: null,
      },
      {
        id: 'cust-2',
        customerName: '客户二',
        customerLevel: CUSTOMER_LEVEL.A,
        chargerId: 'emp-2',
        chargerName: '李四',
        lastKeepRecordTime: new Date('2026-03-01T12:00:00Z'),
      },
    ]);

    const result = await service.getSleeping(null);

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerLevel: { in: [CUSTOMER_LEVEL.S, CUSTOMER_LEVEL.A] },
          NOT: { dealStatus: { in: [DEAL_STATUS.WON, DEAL_STATUS.MULTI_WON] } },
        }),
      })
    );
    expect(result.items[0]?.daysSinceLastKeep).toBeNull();
    expect(result.items[1]?.daysSinceLastKeep).toBe(121);
  });
});
