import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  buildSaleOrderVoidPlan,
  saleOrderVoidSnapshotsEqual,
} from '../sale-order-void-plan.helper';

function buildDb(overrides: Record<string, unknown> = {}) {
  return {
    payment: { findMany: vi.fn().mockResolvedValue([]) },
    invoice: { findMany: vi.fn().mockResolvedValue([]) },
    project: { findFirst: vi.fn().mockResolvedValue(null) },
    projectSaleOrder: { findMany: vi.fn().mockResolvedValue([]) },
    financeLedger: { findMany: vi.fn().mockResolvedValue([]) },
    projectTicket: { count: vi.fn().mockResolvedValue(0) },
    effortRecord: { count: vi.fn().mockResolvedValue(0) },
    saleOrder: { count: vi.fn().mockResolvedValue(0) },
    ...overrides,
  };
}

describe('buildSaleOrderVoidPlan', () => {
  it('归类已审批回款、可删草稿、已冲红发票和可回退项目', async () => {
    const db = buildDb({
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pay-in',
            version: 2,
            direction: 'IN',
            flowStatus: 'approved',
            paymentAmount: new Prisma.Decimal('1000'),
            relatedPaymentId: null,
            invoicedByInvoiceId: null,
          },
          {
            id: 'pay-out',
            version: 1,
            direction: 'OUT',
            flowStatus: 'approved',
            paymentAmount: new Prisma.Decimal('200'),
            relatedPaymentId: 'pay-in',
            invoicedByInvoiceId: null,
          },
          {
            id: 'pay-draft',
            version: 1,
            direction: 'IN',
            flowStatus: 'draft',
            paymentAmount: new Prisma.Decimal('50'),
            relatedPaymentId: null,
            invoicedByInvoiceId: null,
          },
        ]),
      },
      invoice: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inv-red',
            version: 3,
            flowStatus: 'approved',
            invoiceStatus: '已冲红',
            invoiceNumber: 'FP001',
          },
          {
            id: 'inv-draft',
            version: 1,
            flowStatus: 'draft',
            invoiceStatus: null,
            invoiceNumber: null,
          },
        ]),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'project-1',
          version: 4,
          name: '误建项目',
          status: '未开始',
          opportunityId: 'opp-1',
        }),
      },
    });

    const plan = await buildSaleOrderVoidPlan(db as never, 'so-1');

    expect(plan.preview).toMatchObject({
      canSubmit: true,
      requiresProjectAction: true,
      blockers: [],
      payments: {
        totalCount: 3,
        approvedCount: 2,
        removableCount: 1,
        approvedInAmount: 1000,
        approvedOutAmount: 200,
      },
      invoices: {
        totalCount: 2,
        preservedCount: 1,
        removableCount: 1,
        blockingCount: 0,
      },
      project: { id: 'project-1', canRollback: true },
    });
    expect(plan.approvedPaymentIds).toEqual(['pay-in', 'pay-out']);
    expect(plan.removablePaymentIds).toEqual(['pay-draft']);
    expect(plan.removableInvoiceIds).toEqual(['inv-draft']);
  });

  it('有效正式发票必须先作废或冲红', async () => {
    const db = buildDb({
      invoice: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inv-normal',
            version: 1,
            flowStatus: 'approved',
            invoiceStatus: '正常',
            invoiceNumber: 'FP100',
          },
        ]),
      },
    });

    const plan = await buildSaleOrderVoidPlan(db as never, 'so-1');

    expect(plan.preview.canSubmit).toBe(false);
    expect(plan.preview.invoices.blockingCount).toBe(1);
    expect(plan.preview.blockers).toContain('发票 FP100 已开具且仍有效，请先完成作废或红字冲销');
  });

  it('审批中回款、带票号草稿、二级项目关系、手工流水和已推进项目全部阻断', async () => {
    const db = buildDb({
      payment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pay-pending',
            version: 1,
            direction: 'IN',
            flowStatus: 'pending',
            paymentAmount: new Prisma.Decimal('100'),
            relatedPaymentId: null,
            invoicedByInvoiceId: null,
          },
        ]),
      },
      invoice: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inv-draft-numbered',
            version: 1,
            flowStatus: 'draft',
            invoiceStatus: null,
            invoiceNumber: 'FP-DRAFT',
          },
        ]),
      },
      project: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'project-live',
          version: 2,
          name: '已实施项目',
          status: '进行中',
          opportunityId: 'opp-1',
        }),
      },
      projectSaleOrder: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'project-order-1', projectId: 'project-secondary' }]),
      },
      financeLedger: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'ledger-manual',
            version: 1,
            source: 'manual',
            paymentId: null,
            amount: new Prisma.Decimal('100'),
          },
        ]),
      },
    });
    db.projectTicket.count.mockResolvedValue(1);
    db.effortRecord.count.mockResolvedValue(2);

    const plan = await buildSaleOrderVoidPlan(db as never, 'so-1');

    expect(plan.preview.canSubmit).toBe(false);
    expect(plan.preview.blockers).toHaveLength(5);
    expect(plan.preview.project?.canRollback).toBe(false);
    expect(plan.preview.secondaryProjectCount).toBe(1);
    expect(plan.preview.manualFinanceLedgerCount).toBe(1);
  });

  it('依赖快照忽略 jsonb 对象键顺序，但保留数组与值的严格比较', () => {
    const snapshot = {
      payments: [
        {
          id: 'pay-1',
          version: 2,
          direction: 'IN',
          flowStatus: 'draft',
          paymentAmount: '100',
          relatedPaymentId: null,
          invoicedByInvoiceId: null,
        },
      ],
      invoices: [],
      project: null,
      secondaryProjectLinks: [
        { id: 'link-1', projectId: 'project-1' },
        { id: 'link-2', projectId: 'project-2' },
      ],
      manualFinanceLedgers: [],
    };
    const reorderedLikeJsonb = {
      manualFinanceLedgers: [],
      secondaryProjectLinks: [
        { projectId: 'project-1', id: 'link-1' },
        { projectId: 'project-2', id: 'link-2' },
      ],
      project: null,
      invoices: [],
      payments: [
        {
          invoicedByInvoiceId: null,
          relatedPaymentId: null,
          paymentAmount: '100',
          flowStatus: 'draft',
          direction: 'IN',
          version: 2,
          id: 'pay-1',
        },
      ],
    };

    expect(saleOrderVoidSnapshotsEqual(snapshot, reorderedLikeJsonb)).toBe(true);
    expect(
      saleOrderVoidSnapshotsEqual(snapshot, {
        ...snapshot,
        secondaryProjectLinks: [...snapshot.secondaryProjectLinks].reverse(),
      })
    ).toBe(false);
    expect(
      saleOrderVoidSnapshotsEqual(snapshot, {
        ...snapshot,
        payments: [{ ...snapshot.payments[0]!, version: 3 }],
      })
    ).toBe(false);
  });
});
