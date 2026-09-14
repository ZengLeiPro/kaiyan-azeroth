import { INVOICE_STATUS } from '@ky-azeroth/shared/constants';
import { deriveOrderInvoiceStatus } from '@ky-azeroth/shared/utils';
import { ConflictException, Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const MAX_RETRIES = 3;
const logger = new Logger('recalcSaleOrderInvoicedSummary');

/**
 * 重算订单的"已开票金额 + 开票状态"并物化到 SaleOrder。
 *
 * 触发点：
 * - 本地 InvoicesService.create/update/remove
 * - approvals.service.ts 在 invoice_approve 通过/驳回后
 *
 * 口径：sum(invoice.invoiceAmount)
 * where flowStatus='approved' AND status='active' AND invoiceStatus!='作废' AND deletedAt IS NULL
 * 历史 YCCRM 同步进来的 '已通过' flowStatus 已通过迁移 20260508055034 归一化为 'approved'。
 *
 * 并发安全：与 payment-summary.helper.ts 对齐——version CAS + 内部重试 MAX_RETRIES 次，
 * 软删订单 early return。
 */
export async function recalcSaleOrderInvoicedSummary(
  prisma: PrismaLike,
  saleOrderId: string
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const order = await prisma.saleOrder.findFirst({
      where: { id: saleOrderId, deletedAt: null },
      select: { orderAmount: true, version: true },
    });
    if (!order) return;

    const agg = await prisma.invoice.aggregate({
      where: {
        saleOrderId,
        flowStatus: 'approved',
        status: 'active',
        // 净开票口径：作废 + 红字冲销均不计入"已开票额"，
        // 让 deriveOrderInvoiceStatus 自动从"已开完"退回"部分开票"/"未开票"
        invoiceStatus: { notIn: [INVOICE_STATUS.VOID, INVOICE_STATUS.RED_VOIDED] },
        deletedAt: null,
      },
      _sum: { invoiceAmount: true },
    });

    const invoicedAmount =
      agg._sum.invoiceAmount != null ? new Decimal(agg._sum.invoiceAmount) : new Decimal(0);
    const orderInvoiceStatus = deriveOrderInvoiceStatus(
      invoicedAmount.toNumber(),
      order.orderAmount != null ? Number(order.orderAmount) : null
    );

    try {
      await prisma.saleOrder.update({
        where: { id: saleOrderId, version: order.version },
        data: {
          invoicedAmount: invoicedAmount.toFixed(2),
          orderInvoiceStatus,
          version: { increment: 1 },
        },
      });
      return;
    } catch (error) {
      const isVersionConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
      if (!isVersionConflict) throw error;
      if (attempt === MAX_RETRIES) {
        throw new ConflictException(
          `订单 ${saleOrderId} 开票聚合更新冲突，已重试 ${MAX_RETRIES} 次后仍失败`
        );
      }
      logger.warn(`订单 ${saleOrderId} 开票聚合 CAS 冲突，重试 ${attempt}/${MAX_RETRIES}`);
    }
  }
}
