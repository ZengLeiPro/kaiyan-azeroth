import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';

import { asPrismaService, createMockPrismaService } from '../../../test/prisma-mock.factory';
import { deriveOrderStatus, recalcSaleOrderPaymentSummary } from '../payment-summary.helper';

function makeP2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Record to update not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

/**
 * 给 prisma.payment.aggregate mock 注入 IN、普通退款 OUT、历史负向调整 OUT 三次返回值。
 */
function mockAggInOut(
  prisma: ReturnType<typeof createMockPrismaService>,
  inAmount: Decimal | null,
  outAmount: Decimal | null,
  inMaxBusinessDate: Date | null = null,
  legacyAdjustmentAmount: Decimal | null = null
) {
  prisma.payment.aggregate
    .mockResolvedValueOnce({
      _sum: { paymentAmount: inAmount },
      _max: { businessDate: inMaxBusinessDate },
    })
    .mockResolvedValueOnce({ _sum: { paymentAmount: outAmount } })
    .mockResolvedValueOnce({ _sum: { paymentAmount: legacyAdjustmentAmount } });
}

describe('recalcSaleOrderPaymentSummary', () => {
  it('should calculate uncollected from totalReceivables when present (IN only, partially received)', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal(10000),
      totalReceivables: new Decimal(12000),
      version: 1,
    });
    mockAggInOut(prisma, new Decimal(3000), null, new Date('2026-07-01'));

    await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.saleOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', deletedAt: null },
      select: {
        orderAmount: true,
        totalReceivables: true,
        badDebtAmount: true,
        legacyAdjustment: true,
        version: true,
        customerId: true,
      },
    });
    expect(prisma.saleOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1', version: 1 },
      data: {
        totalReceived: '3000.00',
        totalRefunded: '0.00',
        lastPaymentDate: new Date('2026-07-01'),
        orderStatus: '部分回款',
        totalUncollected: '9000.00',
        version: { increment: 1 },
      },
    });
    const summaryData = prisma.saleOrder.update.mock.calls[0]![0].data;
    expect(summaryData).not.toHaveProperty('opportunityId');
    expect(summaryData).not.toHaveProperty('opportunity');
    expect(summaryData).not.toHaveProperty('customerId');
    expect(summaryData).not.toHaveProperty('customer');
    expect(summaryData).not.toHaveProperty('deletedAt');
  });

  it('should fall back to orderAmount when totalReceivables is null', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal(10000),
      totalReceivables: null,
      version: 5,
    });
    mockAggInOut(prisma, new Decimal(3500), null);

    await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.saleOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1', version: 5 },
      data: {
        totalReceived: '3500.00',
        totalRefunded: '0.00',
        lastPaymentDate: null,
        orderStatus: '部分回款',
        totalUncollected: '6500.00',
        version: { increment: 1 },
      },
    });
  });

  it('should preserve decimal precision through subtraction', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal('1000.50'),
      totalReceivables: new Decimal('1000.50'),
      version: 1,
    });
    mockAggInOut(prisma, new Decimal('999.45'), null);

    await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.saleOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1', version: 1 },
      data: {
        totalReceived: '999.45',
        totalRefunded: '0.00',
        lastPaymentDate: null,
        orderStatus: '部分回款',
        totalUncollected: '1.05',
        version: { increment: 1 },
      },
    });
  });

  it('should skip when sale order is soft-deleted (findFirst returns null)', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue(null);

    await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.payment.aggregate).not.toHaveBeenCalled();
    expect(prisma.saleOrder.update).not.toHaveBeenCalled();
  });

  it('should retry and succeed after a single P2025 conflict', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst
      .mockResolvedValueOnce({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(10000),
        version: 1,
      })
      .mockResolvedValueOnce({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(10000),
        version: 2,
      });
    // 两次重试，每次都需要 IN、普通退款、历史负向调整三组聚合返回值。
    prisma.payment.aggregate
      .mockResolvedValueOnce({
        _sum: { paymentAmount: new Decimal(2000) },
        _max: { businessDate: null },
      })
      .mockResolvedValueOnce({ _sum: { paymentAmount: null } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: null } })
      .mockResolvedValueOnce({
        _sum: { paymentAmount: new Decimal(2000) },
        _max: { businessDate: null },
      })
      .mockResolvedValueOnce({ _sum: { paymentAmount: null } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: null } });
    prisma.saleOrder.update.mockRejectedValueOnce(makeP2025()).mockResolvedValueOnce({});

    await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.saleOrder.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.saleOrder.update).toHaveBeenCalledTimes(2);
    expect(prisma.saleOrder.update).toHaveBeenLastCalledWith({
      where: { id: 'order-1', version: 2 },
      data: {
        totalReceived: '2000.00',
        totalRefunded: '0.00',
        lastPaymentDate: null,
        orderStatus: '部分回款',
        totalUncollected: '8000.00',
        version: { increment: 1 },
      },
    });
  });

  it('should throw ConflictException after MAX_RETRIES P2025 conflicts', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal(10000),
      totalReceivables: new Decimal(10000),
      version: 1,
    });
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { paymentAmount: new Decimal(1000) },
      _max: { businessDate: null },
    });
    prisma.saleOrder.update.mockRejectedValue(makeP2025());

    await expect(
      recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1')
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.saleOrder.update).toHaveBeenCalledTimes(3);
  });

  it('should rethrow non-P2025 errors without retry', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal(10000),
      totalReceivables: new Decimal(10000),
      version: 1,
    });
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { paymentAmount: new Decimal(1000) },
      _max: { businessDate: null },
    });
    const otherError = new Error('connection lost');
    prisma.saleOrder.update.mockRejectedValue(otherError);

    await expect(recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1')).rejects.toBe(
      otherError
    );
    expect(prisma.saleOrder.update).toHaveBeenCalledTimes(1);
  });

  describe('with IN + OUT (5-state orderStatus derivation)', () => {
    it('IN=3000, OUT=1000, receivables=12000 → 部分退款 / totalReceived=2000 / totalUncollected=9000(毛口径)', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(12000),
        version: 1,
      });
      mockAggInOut(prisma, new Decimal(3000), new Decimal(1000));

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      // totalUncollected = max(12000 - gross(3000), 0) = 9000
      // 不是 max(12000 - net(2000), 0) = 10000 —— 见 helper 注释，未收用毛收算，
      // 与退款解耦，避免被催收/账龄类报表重复计入。
      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '2000.00',
          totalRefunded: '1000.00',
          lastPaymentDate: null,
          orderStatus: '部分退款',
          totalUncollected: '9000.00',
          version: { increment: 1 },
        },
      });
    });

    it('IN=3000, OUT=3000 → 全额退款 / totalReceived=0 / totalUncollected=7000(毛口径)', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(10000),
        version: 1,
      });
      mockAggInOut(prisma, new Decimal(3000), new Decimal(3000));

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      // totalUncollected = max(10000 - gross(3000), 0) = 7000
      // 全额退款语义 = "所有收到的钱都退了"，并不等价于"订单作废，应收清零"；
      // 应收 10000 中客户实际从未真正付清，因此还有 7000 未收（在 gross 口径下）。
      // 是否把"全额退款"额外语义化为"作废、应收清零"属产品决策，不在 helper 公式范围。
      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '0.00',
          totalRefunded: '3000.00',
          lastPaymentDate: null,
          orderStatus: '全额退款',
          totalUncollected: '7000.00',
          version: { increment: 1 },
        },
      });
    });

    it('IN=10000, OUT=0, receivables=10000 → 全额回款', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(10000),
        version: 1,
      });
      mockAggInOut(prisma, new Decimal(10000), null);

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '10000.00',
          totalRefunded: '0.00',
          lastPaymentDate: null,
          orderStatus: '全额回款',
          totalUncollected: '0.00',
          version: { increment: 1 },
        },
      });
    });

    it('IN=1000, OUT=800, receivables=1000 → 部分退款 / totalUncollected=0（已付清的退款不该被折回"未收"）', async () => {
      // 场景：客户合同 1000，已全额付款 1000，后退还 800。
      // 期望：未收=0（客户曾经付清，应收没有缺口）、已退=800、净收=200。
      // 旧 net 口径会把"未收"算成 800，与状态"部分退款"叠加后产生
      // "已付清 vs 未收 800" 的展示矛盾，并被客户应收/账龄/缺口侦探
      // 类报表重复计入。本 case 固化新口径，防止回归。
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(1000),
        totalReceivables: new Decimal(1000),
        version: 1,
      });
      mockAggInOut(prisma, new Decimal(1000), new Decimal(800));

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '200.00',
          totalRefunded: '800.00',
          lastPaymentDate: null,
          orderStatus: '部分退款',
          totalUncollected: '0.00',
          version: { increment: 1 },
        },
      });
    });

    it('普通回款、退款与历史调整分别计入净收和退款口径', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(1000),
        totalReceivables: new Decimal(1000),
        version: 1,
      });
      mockAggInOut(prisma, new Decimal(1000), new Decimal(200), null, new Decimal(300));

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '500.00',
          totalRefunded: '200.00',
          lastPaymentDate: null,
          orderStatus: '部分退款',
          totalUncollected: '0.00',
          version: { increment: 1 },
        },
      });
    });

    it('历史冲正订单仅有负向调整 → 净收为负、退款为 0、状态历史冲正', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(-6000),
        totalReceivables: new Decimal(-6000),
        legacyAdjustment: true,
        version: 1,
      });
      mockAggInOut(prisma, null, null, null, new Decimal(6000));

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '-6000.00',
          totalRefunded: '0.00',
          lastPaymentDate: null,
          orderStatus: '历史冲正',
          totalUncollected: '0.00',
          version: { increment: 1 },
        },
      });
    });

    it('坏账金额从未收余额中核销，但不计入实际回款', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(10000),
        badDebtAmount: new Decimal(4000),
        version: 1,
      });
      mockAggInOut(prisma, new Decimal(3000), null);

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '3000.00',
          totalRefunded: '0.00',
          lastPaymentDate: null,
          orderStatus: '部分回款',
          totalUncollected: '3000.00',
          version: { increment: 1 },
        },
      });
    });

    it('IN=0, OUT=0 → 未回款', async () => {
      const prisma = createMockPrismaService();
      prisma.saleOrder.findFirst.mockResolvedValue({
        orderAmount: new Decimal(10000),
        totalReceivables: new Decimal(10000),
        version: 1,
      });
      mockAggInOut(prisma, null, null);

      await recalcSaleOrderPaymentSummary(asPrismaService(prisma), 'order-1');

      expect(prisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: 1 },
        data: {
          totalReceived: '0.00',
          totalRefunded: '0.00',
          lastPaymentDate: null,
          orderStatus: '未回款',
          totalUncollected: '10000.00',
          version: { increment: 1 },
        },
      });
    });
  });
});

describe('deriveOrderStatus (pure unit)', () => {
  const cases: Array<[string, number, number, number | null, string]> = [
    ['gross=0 → 未回款', 0, 0, 10000, '未回款'],
    ['gross<receivables, no refund → 部分回款', 3000, 0, 10000, '部分回款'],
    ['gross>=receivables, no refund → 全额回款', 10000, 0, 10000, '全额回款'],
    ['refund>0, refund<gross → 部分退款', 5000, 2000, 10000, '部分退款'],
    ['refund=gross → 全额退款', 5000, 5000, 10000, '全额退款'],
    ['refund>gross (异常) → 全额退款（兜底）', 5000, 6000, 10000, '全额退款'],
    ['receivablesBase=null, gross>0 → 部分回款（无应收基准，保守判定）', 5000, 0, null, '部分回款'],
  ];

  for (const [label, grossNum, refundNum, baseNum, expected] of cases) {
    it(label, () => {
      const status = deriveOrderStatus(
        new Decimal(grossNum),
        new Decimal(refundNum),
        baseNum == null ? null : new Decimal(baseNum)
      );
      expect(status).toBe(expected);
    });
  }
});
