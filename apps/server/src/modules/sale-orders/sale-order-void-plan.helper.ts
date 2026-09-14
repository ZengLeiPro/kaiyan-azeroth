import { isDeepStrictEqual } from 'node:util';

import {
  INVOICE_STATUS,
  PAYMENT_DIRECTION,
  PROJECT_STATUS,
} from '@ky-azeroth/shared/constants/status-values';
import type { SaleOrderVoidPreviewOutput } from '@ky-azeroth/shared/schemas/sale-order';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

type ReadClient = PrismaService | Prisma.TransactionClient;

export interface SaleOrderVoidDependencySnapshot {
  payments: Array<{
    id: string;
    version: number;
    direction: string;
    flowStatus: string | null;
    paymentAmount: string;
    relatedPaymentId: string | null;
    invoicedByInvoiceId: string | null;
  }>;
  invoices: Array<{
    id: string;
    version: number;
    flowStatus: string | null;
    invoiceStatus: string | null;
    invoiceNumber: string | null;
  }>;
  project: {
    id: string;
    version: number;
    name: string;
    status: string;
    opportunityId: string | null;
    activeTicketCount: number;
    effortRecordCount: number;
    otherSaleOrderCount: number;
  } | null;
  secondaryProjectLinks: Array<{
    id: string;
    projectId: string;
  }>;
  manualFinanceLedgers: Array<{
    id: string;
    version: number;
    source: string;
    paymentId: string | null;
    amount: string;
  }>;
}

export interface SaleOrderVoidPlan {
  snapshot: SaleOrderVoidDependencySnapshot;
  preview: SaleOrderVoidPreviewOutput;
  approvedPaymentIds: string[];
  removablePaymentIds: string[];
  removableInvoiceIds: string[];
}

const REMOVABLE_FLOW_STATUSES = new Set(['draft', 'rejected']);
const ECONOMICALLY_INACTIVE_INVOICE_STATUSES = new Set<string>([
  INVOICE_STATUS.VOID,
  INVOICE_STATUS.RED_VOIDED,
]);
const SAFE_PROJECT_STATUSES = new Set<string>([
  PROJECT_STATUS.CONTRACT,
  PROJECT_STATUS.NOT_STARTED,
]);

export async function buildSaleOrderVoidPlan(
  db: ReadClient,
  saleOrderId: string
): Promise<SaleOrderVoidPlan> {
  const [payments, invoices, project, secondaryProjectLinks, activeFinanceLedgers] =
    await Promise.all([
      db.payment.findMany({
        where: { saleOrderId, deletedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          version: true,
          direction: true,
          flowStatus: true,
          paymentAmount: true,
          relatedPaymentId: true,
          invoicedByInvoiceId: true,
        },
      }),
      db.invoice.findMany({
        where: { saleOrderId, deletedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          version: true,
          flowStatus: true,
          invoiceStatus: true,
          invoiceNumber: true,
        },
      }),
      db.project.findFirst({
        where: { saleOrderId, deletedAt: null },
        select: {
          id: true,
          version: true,
          name: true,
          status: true,
          opportunityId: true,
        },
      }),
      db.projectSaleOrder.findMany({
        where: { saleOrderId },
        orderBy: { id: 'asc' },
        select: { id: true, projectId: true },
      }),
      db.financeLedger.findMany({
        where: { saleOrderId, deletedAt: null },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          version: true,
          source: true,
          paymentId: true,
          amount: true,
        },
      }),
    ]);

  const paymentIds = new Set(payments.map((payment) => payment.id));
  const manualFinanceLedgers = activeFinanceLedgers.filter(
    (ledger) =>
      ledger.source !== 'crm_payment' || !ledger.paymentId || !paymentIds.has(ledger.paymentId)
  );

  const [activeTicketCount, effortRecordCount, otherSaleOrderCount] = project
    ? await Promise.all([
        db.projectTicket.count({ where: { projectId: project.id, deletedAt: null } }),
        db.effortRecord.count({ where: { projectId: project.id, deletedAt: null } }),
        project.opportunityId
          ? db.saleOrder.count({
              where: {
                opportunityId: project.opportunityId,
                id: { not: saleOrderId },
                deletedAt: null,
              },
            })
          : Promise.resolve(0),
      ])
    : [0, 0, 0];

  const blockers: string[] = [];
  const approvedPaymentIds: string[] = [];
  const removablePaymentIds: string[] = [];
  const removableInvoiceIds: string[] = [];

  let pendingPaymentCount = 0;
  let approvedInAmount = new Prisma.Decimal(0);
  let approvedOutAmount = new Prisma.Decimal(0);

  for (const payment of payments) {
    if (payment.flowStatus === 'approved') {
      approvedPaymentIds.push(payment.id);
      if (payment.direction === PAYMENT_DIRECTION.OUT) {
        approvedOutAmount = approvedOutAmount.plus(payment.paymentAmount);
      } else {
        approvedInAmount = approvedInAmount.plus(payment.paymentAmount);
      }
      continue;
    }
    if (REMOVABLE_FLOW_STATUSES.has(payment.flowStatus ?? '')) {
      removablePaymentIds.push(payment.id);
      continue;
    }
    if (payment.flowStatus === 'pending') {
      pendingPaymentCount += 1;
      continue;
    }
    blockers.push(
      `回款 ${payment.id} 的审批状态为 ${payment.flowStatus ?? '空'}，需先人工确认后处理`
    );
  }
  if (pendingPaymentCount > 0) {
    blockers.push(`仍有 ${pendingPaymentCount} 笔回款/退款审批中，请先撤回或完成审批`);
  }

  let preservedInvoiceCount = 0;
  let blockingInvoiceCount = 0;
  for (const invoice of invoices) {
    if (
      invoice.flowStatus === 'approved' &&
      ECONOMICALLY_INACTIVE_INVOICE_STATUSES.has(invoice.invoiceStatus ?? '')
    ) {
      preservedInvoiceCount += 1;
      continue;
    }
    if (invoice.flowStatus === 'approved') {
      blockingInvoiceCount += 1;
      blockers.push(
        `发票 ${invoice.invoiceNumber ?? invoice.id} 已开具且仍有效，请先完成作废或红字冲销`
      );
      continue;
    }
    if (REMOVABLE_FLOW_STATUSES.has(invoice.flowStatus ?? '') && !invoice.invoiceNumber?.trim()) {
      removableInvoiceIds.push(invoice.id);
      continue;
    }
    blockingInvoiceCount += 1;
    if (invoice.flowStatus === 'pending') {
      blockers.push(`发票 ${invoice.invoiceNumber ?? invoice.id} 正在审批，请先撤回或完成审批`);
    } else if (invoice.invoiceNumber?.trim()) {
      blockers.push(
        `发票 ${invoice.invoiceNumber} 已有正式票号，不能作为草稿自动删除，请先人工核实`
      );
    } else {
      blockers.push(
        `发票 ${invoice.id} 的审批状态为 ${invoice.flowStatus ?? '空'}，需先人工确认后处理`
      );
    }
  }

  if (secondaryProjectLinks.length > 0) {
    blockers.push(`订单还被 ${secondaryProjectLinks.length} 个项目作为关联订单使用，请先解除关联`);
  }
  if (manualFinanceLedgers.length > 0) {
    blockers.push(
      `订单还关联 ${manualFinanceLedgers.length} 条非 CRM 回款派生财务流水，请先人工核实并解除关联`
    );
  }

  const canRollbackProject =
    project !== null &&
    SAFE_PROJECT_STATUSES.has(project.status) &&
    project.opportunityId !== null &&
    activeTicketCount === 0 &&
    effortRecordCount === 0 &&
    otherSaleOrderCount === 0;
  if (project && !canRollbackProject) {
    blockers.push(
      buildProjectBlocker(project, activeTicketCount, effortRecordCount, otherSaleOrderCount)
    );
  }

  const snapshot: SaleOrderVoidDependencySnapshot = {
    payments: payments.map((payment) => ({
      ...payment,
      paymentAmount: payment.paymentAmount.toString(),
    })),
    invoices,
    project: project
      ? {
          ...project,
          activeTicketCount,
          effortRecordCount,
          otherSaleOrderCount,
        }
      : null,
    secondaryProjectLinks,
    manualFinanceLedgers: manualFinanceLedgers.map((ledger) => ({
      ...ledger,
      amount: ledger.amount.toString(),
    })),
  };

  return {
    snapshot,
    preview: {
      canSubmit: blockers.length === 0,
      requiresProjectAction: canRollbackProject,
      blockers,
      payments: {
        totalCount: payments.length,
        approvedCount: approvedPaymentIds.length,
        removableCount: removablePaymentIds.length,
        pendingCount: pendingPaymentCount,
        approvedInAmount: approvedInAmount.toNumber(),
        approvedOutAmount: approvedOutAmount.toNumber(),
      },
      invoices: {
        totalCount: invoices.length,
        preservedCount: preservedInvoiceCount,
        removableCount: removableInvoiceIds.length,
        blockingCount: blockingInvoiceCount,
      },
      project: project
        ? {
            id: project.id,
            name: project.name,
            status: project.status,
            canRollback: canRollbackProject,
            activeTicketCount,
            effortRecordCount,
            otherSaleOrderCount,
          }
        : null,
      secondaryProjectCount: secondaryProjectLinks.length,
      manualFinanceLedgerCount: manualFinanceLedgers.length,
    },
    approvedPaymentIds,
    removablePaymentIds,
    removableInvoiceIds,
  };
}

export function saleOrderVoidSnapshotsEqual(
  left: SaleOrderVoidDependencySnapshot,
  right: SaleOrderVoidDependencySnapshot
): boolean {
  return isDeepStrictEqual(left, right);
}

function buildProjectBlocker(
  project: { name: string; status: string; opportunityId: string | null },
  activeTicketCount: number,
  effortRecordCount: number,
  otherSaleOrderCount: number
): string {
  if (!SAFE_PROJECT_STATUSES.has(project.status)) {
    return `项目「${project.name}」已进入“${project.status}”，请先按项目实际情况收口，不能随纠错作废自动回退`;
  }
  if (!project.opportunityId) {
    return `项目「${project.name}」未关联商机，无法安全回退到商机阶段`;
  }
  if (activeTicketCount > 0 || effortRecordCount > 0) {
    return `项目「${project.name}」已有 ${activeTicketCount} 个工单、${effortRecordCount} 条工时，不能自动回退`;
  }
  if (otherSaleOrderCount > 0) {
    return `项目「${project.name}」的商机仍关联 ${otherSaleOrderCount} 份其他有效订单，不能自动回退`;
  }
  return `项目「${project.name}」当前不满足自动回退条件`;
}
