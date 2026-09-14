import { INVOICE_STATUS } from '@ky-azeroth/shared/constants';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { asPrismaService, createMockPrismaService } from '../../../test/prisma-mock.factory';
import {
  assertBadDebtAmountWithinOutstanding,
  assertInvoiceWithinOrderAmount,
  assertPaymentWithinReceivables,
  assertRefundWithinReceived,
  lockSaleOrderFinancialMutations,
  validateFinancialSaleOrderAfterLock,
} from '../financial-limits.helper';

describe('financial-limits helper', () => {
  it('坏账金额不得超过扣除已确认毛回款后的未收余额', () => {
    expect(() =>
      assertBadDebtAmountWithinOutstanding({
        receivablesBase: '10000.00',
        approvedGross: '2000.00',
        badDebtAmount: '8000.01',
      })
    ).toThrow(BadRequestException);
  });

  it('坏账金额等于可核销上限时允许', () => {
    expect(() =>
      assertBadDebtAmountWithinOutstanding({
        receivablesBase: '10000.00',
        approvedGross: '2000.00',
        badDebtAmount: '8000.00',
      })
    ).not.toThrow();
  });

  it('按固定顺序锁定订单财务写入，避免跨订单更新死锁', async () => {
    const prisma = createMockPrismaService();

    await lockSaleOrderFinancialMutations(prisma as never, ['order-b', 'order-a', 'order-b']);

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.calls[0]?.[1]).toBe('sale_order_financial:order-a');
    expect(prisma.$executeRaw.mock.calls[1]?.[1]).toBe('sale_order_financial:order-b');
  });

  it('新财务事实应排除历史冲正订单', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-1',
      flowStatus: 'approved',
      version: 1,
    });

    await validateFinancialSaleOrderAfterLock(asPrismaService(prisma), {
      saleOrderId: 'order-1',
    });

    expect(prisma.saleOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ legacyAdjustment: false }),
      })
    );
  });

  it('should reject payment when approved total exceeds receivables', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: 10000,
      totalReceivables: 10000,
    });
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { paymentAmount: 9000 },
    });

    await expect(
      assertPaymentWithinReceivables(asPrismaService(prisma), {
        saleOrderId: 'order-1',
        paymentAmount: 1500,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should allow payment when approved total stays within receivables', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: 10000,
      totalReceivables: 10000,
    });
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { paymentAmount: 8000 },
    });

    await expect(
      assertPaymentWithinReceivables(asPrismaService(prisma), {
        saleOrderId: 'order-1',
        paymentAmount: 2000,
      })
    ).resolves.toBeUndefined();
  });

  it('should reject invoice when approved total exceeds order amount', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({ orderAmount: 10000 });
    prisma.invoice.aggregate.mockResolvedValue({
      _sum: { invoiceAmount: 9500 },
    });

    await expect(
      assertInvoiceWithinOrderAmount(asPrismaService(prisma), {
        saleOrderId: 'order-1',
        invoiceAmount: 600,
        invoiceStatus: INVOICE_STATUS.NORMAL,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should ignore void invoice when checking order amount limit', async () => {
    const prisma = createMockPrismaService();

    await expect(
      assertInvoiceWithinOrderAmount(asPrismaService(prisma), {
        saleOrderId: 'order-1',
        invoiceAmount: 999999,
        invoiceStatus: INVOICE_STATUS.VOID,
      })
    ).resolves.toBeUndefined();
    expect(prisma.saleOrder.findFirst).not.toHaveBeenCalled();
  });

  it('should ignore red-voided invoice when checking order amount limit', async () => {
    const prisma = createMockPrismaService();

    await expect(
      assertInvoiceWithinOrderAmount(asPrismaService(prisma), {
        saleOrderId: 'order-1',
        invoiceAmount: 999999,
        invoiceStatus: INVOICE_STATUS.RED_VOIDED,
      })
    ).resolves.toBeUndefined();
    expect(prisma.saleOrder.findFirst).not.toHaveBeenCalled();
  });

  it('assertPaymentWithinReceivables should filter to direction=IN only', async () => {
    // 退款（OUT）金额不应被计入"已确认回款"做正向超额校验，
    // 否则退过款后又能多收一笔与退款等额的回款。
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: 10000,
      totalReceivables: 10000,
    });
    prisma.payment.aggregate.mockResolvedValue({ _sum: { paymentAmount: 5000 } });

    await assertPaymentWithinReceivables(asPrismaService(prisma), {
      saleOrderId: 'order-1',
      paymentAmount: 1000,
    });

    expect(prisma.payment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          saleOrderId: 'order-1',
          flowStatus: 'approved',
          direction: 'IN',
        }),
      })
    );
  });
});

describe('assertRefundWithinReceived', () => {
  const baseParams = {
    saleOrderId: 'order-1',
    refundAmount: 1000,
    relatedPaymentId: 'pay-1',
  };

  it('should throw NotFoundException when related payment does not exist', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue(null);

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), baseParams)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should reject when related payment belongs to another order', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'order-OTHER',
      customerId: 'cust-1',
      direction: 'IN',
      flowStatus: 'approved',
      paymentAmount: new Prisma.Decimal('5000.00'),
    });

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), baseParams)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject when related payment is OUT (cannot relate refund to refund)', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'order-1',
      customerId: 'cust-1',
      direction: 'OUT',
      flowStatus: 'approved',
      paymentAmount: new Prisma.Decimal('5000.00'),
    });

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), baseParams)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject when related payment is not approved', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'order-1',
      customerId: 'cust-1',
      direction: 'IN',
      flowStatus: 'pending',
      paymentAmount: new Prisma.Decimal('5000.00'),
    });

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), baseParams)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject when refund exceeds single related-payment balance', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'order-1',
      customerId: 'cust-1',
      direction: 'IN',
      flowStatus: 'approved',
      paymentAmount: new Prisma.Decimal('1000.00'),
    });
    // 已经退过 800，关联回款仅 1000，本次再退 500 = 1300 > 1000
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { paymentAmount: 800 } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: 5000 } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: 800 } });

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), {
        ...baseParams,
        refundAmount: 500,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject when total OUT > total IN at order level', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'order-1',
      customerId: 'cust-1',
      direction: 'IN',
      flowStatus: 'approved',
      paymentAmount: new Prisma.Decimal('10000.00'),
    });
    // 单笔关联回款余额足够，但订单维度 IN=5000 / OUT=4000 / 本次再退 2000 = 6000 > 5000
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { paymentAmount: 0 } }) // 单笔已退
      .mockResolvedValueOnce({ _sum: { paymentAmount: 5000 } }) // 订单 IN
      .mockResolvedValueOnce({ _sum: { paymentAmount: 4000 } }); // 订单 OUT

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), {
        ...baseParams,
        refundAmount: 2000,
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should allow refund within both single-payment and order-level limits', async () => {
    const prisma = createMockPrismaService();
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'order-1',
      customerId: 'cust-1',
      direction: 'IN',
      flowStatus: 'approved',
      paymentAmount: new Prisma.Decimal('5000.00'),
    });
    prisma.payment.aggregate
      .mockResolvedValueOnce({ _sum: { paymentAmount: 1000 } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: 10000 } })
      .mockResolvedValueOnce({ _sum: { paymentAmount: 2000 } });

    await expect(
      assertRefundWithinReceived(asPrismaService(prisma), {
        ...baseParams,
        refundAmount: 1500,
      })
    ).resolves.toBeUndefined();
    expect(prisma.payment.aggregate).toHaveBeenNthCalledWith(3, {
      where: {
        saleOrderId: 'order-1',
        flowStatus: 'approved',
        deletedAt: null,
        direction: 'OUT',
        legacyAdjustment: false,
      },
      _sum: { paymentAmount: true },
    });
  });
});
