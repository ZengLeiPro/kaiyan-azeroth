import { INVOICE_STATUS } from '@ky-azeroth/shared/constants';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { describe, expect, it } from 'vitest';

import { asPrismaService, createMockPrismaService } from '../../../test/prisma-mock.factory';
import { recalcSaleOrderInvoicedSummary } from '../invoiced-summary.helper';

function makeP2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Record to update not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

describe('recalcSaleOrderInvoicedSummary', () => {
  it('should exclude void invoices when calculating invoiced summary', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal(10000),
      version: 1,
    });
    prisma.invoice.aggregate.mockResolvedValue({
      _sum: { invoiceAmount: new Decimal(3000) },
    });

    await recalcSaleOrderInvoicedSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.invoice.aggregate).toHaveBeenCalledWith({
      where: {
        saleOrderId: 'order-1',
        flowStatus: 'approved',
        status: 'active',
        invoiceStatus: { notIn: [INVOICE_STATUS.VOID, INVOICE_STATUS.RED_VOIDED] },
        deletedAt: null,
      },
      _sum: { invoiceAmount: true },
    });
    expect(prisma.saleOrder.findFirst).toHaveBeenCalledWith({
      where: { id: 'order-1', deletedAt: null },
      select: { orderAmount: true, version: true },
    });
    expect(prisma.saleOrder.update).toHaveBeenCalledWith({
      where: { id: 'order-1', version: 1 },
      data: {
        invoicedAmount: '3000.00',
        orderInvoiceStatus: '部分开票',
        version: { increment: 1 },
      },
    });
  });

  it('should skip when sale order is soft-deleted (findFirst returns null)', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue(null);

    await recalcSaleOrderInvoicedSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.invoice.aggregate).not.toHaveBeenCalled();
    expect(prisma.saleOrder.update).not.toHaveBeenCalled();
  });

  it('should retry and succeed after a single P2025 conflict', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst
      .mockResolvedValueOnce({ orderAmount: new Decimal(10000), version: 1 })
      .mockResolvedValueOnce({ orderAmount: new Decimal(10000), version: 2 });
    prisma.invoice.aggregate.mockResolvedValue({
      _sum: { invoiceAmount: new Decimal(2000) },
    });
    prisma.saleOrder.update.mockRejectedValueOnce(makeP2025()).mockResolvedValueOnce({});

    await recalcSaleOrderInvoicedSummary(asPrismaService(prisma), 'order-1');

    expect(prisma.saleOrder.update).toHaveBeenCalledTimes(2);
    expect(prisma.saleOrder.update).toHaveBeenLastCalledWith({
      where: { id: 'order-1', version: 2 },
      data: {
        invoicedAmount: '2000.00',
        orderInvoiceStatus: '部分开票',
        version: { increment: 1 },
      },
    });
  });

  it('should throw ConflictException after MAX_RETRIES P2025 conflicts', async () => {
    const prisma = createMockPrismaService();
    prisma.saleOrder.findFirst.mockResolvedValue({
      orderAmount: new Decimal(10000),
      version: 1,
    });
    prisma.invoice.aggregate.mockResolvedValue({
      _sum: { invoiceAmount: new Decimal(1000) },
    });
    prisma.saleOrder.update.mockRejectedValue(makeP2025());

    await expect(
      recalcSaleOrderInvoicedSummary(asPrismaService(prisma), 'order-1')
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.saleOrder.update).toHaveBeenCalledTimes(3);
  });
});
