import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  assertInvoiceWithinOrderAmount,
  assertPaymentWithinReceivables,
  lockSaleOrderFinancialMutations,
} from '../financial-limits.helper';

describe('销售订单财务额度并发 E2E', () => {
  let prisma: PrismaService;
  let customerId: string;
  let saleOrderId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
  });

  beforeEach(async () => {
    await prisma.cleanDatabase();
    const customer = await prisma.customer.create({
      data: {
        serialNumber: 'E2E-CUSTOMER-001',
        customerName: '财务并发测试客户',
      },
    });
    customerId = customer.id;

    const saleOrder = await prisma.saleOrder.create({
      data: {
        serialNumber: 'E2E-ORDER-001',
        orderTitle: '财务并发测试订单',
        customerId,
        orderAmount: '100.00',
        totalReceivables: '100.00',
        flowStatus: 'approved',
      },
    });
    saleOrderId = saleOrder.id;
  });

  it('两笔并发回款都通过单笔校验时，最终只能落一笔', async () => {
    const createPayment = (serialNumber: string) =>
      prisma.$transaction(async (tx) => {
        await lockSaleOrderFinancialMutations(tx, saleOrderId);
        await assertPaymentWithinReceivables(tx, {
          saleOrderId,
          paymentAmount: '60.00',
        });
        return tx.payment.create({
          data: {
            serialNumber,
            subject: '并发回款',
            saleOrderId,
            customerId,
            paymentAmount: '60.00',
            flowStatus: 'approved',
            direction: 'IN',
          },
        });
      });

    const results = await Promise.allSettled([
      createPayment('E2E-PAYMENT-001'),
      createPayment('E2E-PAYMENT-002'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const aggregate = await prisma.payment.aggregate({
      where: { saleOrderId, flowStatus: 'approved', deletedAt: null, direction: 'IN' },
      _sum: { paymentAmount: true },
    });
    expect(Number(aggregate._sum.paymentAmount)).toBe(60);
  });

  it('两张并发发票都通过单笔校验时，最终只能落一张', async () => {
    const createInvoice = (serialNumber: string) =>
      prisma.$transaction(async (tx) => {
        await lockSaleOrderFinancialMutations(tx, saleOrderId);
        await assertInvoiceWithinOrderAmount(tx, {
          saleOrderId,
          invoiceAmount: '60.00',
          invoiceStatus: '正常',
        });
        return tx.invoice.create({
          data: {
            serialNumber,
            subject: '并发开票',
            saleOrderId,
            customerId,
            invoiceAmount: '60.00',
            invoiceStatus: '正常',
            flowStatus: 'approved',
          },
        });
      });

    const results = await Promise.allSettled([
      createInvoice('E2E-INVOICE-001'),
      createInvoice('E2E-INVOICE-002'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const aggregate = await prisma.invoice.aggregate({
      where: {
        saleOrderId,
        flowStatus: 'approved',
        status: 'active',
        invoiceStatus: '正常',
        deletedAt: null,
      },
      _sum: { invoiceAmount: true },
    });
    expect(Number(aggregate._sum.invoiceAmount)).toBe(60);
  });
});
