import { Prisma } from '@prisma/client';

import { auditUpdate } from '../../common/utils/audit-helper';

type AuditActor = { id: string; employeeId?: string | null };

/**
 * 在调用方完成 Invoice 头 CAS/count guard 后，解除 active Payment 的两类发票反向引用。
 * 调用方必须把本 helper 与 Invoice 头写入、SaleOrder 汇总放在同一事务中。
 */
export async function clearActivePaymentInvoiceReferences(
  tx: Prisma.TransactionClient,
  invoiceIdOrIds: string | readonly string[],
  currentUser: AuditActor
): Promise<void> {
  const invoiceIds =
    typeof invoiceIdOrIds === 'string' ? invoiceIdOrIds : [...new Set(invoiceIdOrIds)];
  if (Array.isArray(invoiceIds) && invoiceIds.length === 0) return;
  const invoiceReferenceWhere = typeof invoiceIds === 'string' ? invoiceIds : { in: invoiceIds };

  await tx.payment.updateMany({
    where: { invoicedByInvoiceId: invoiceReferenceWhere, deletedAt: null },
    data: {
      invoicedByInvoiceId: null,
      version: { increment: 1 },
      ...auditUpdate(currentUser),
    },
  });
  await tx.payment.updateMany({
    where: { relatedInvoiceId: invoiceReferenceWhere, deletedAt: null },
    data: {
      relatedInvoiceId: null,
      version: { increment: 1 },
      ...auditUpdate(currentUser),
    },
  });
}
