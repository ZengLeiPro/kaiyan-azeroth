import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertOpportunityHasNoActiveSaleOrder,
  lockSaleOrderRelationshipsBeforeCustomerTouch,
} from '../../sale-orders/sale-order-opportunity-link.helper';
import {
  lockAndValidateApprovalChangeTargetForApproval,
  lockAndValidatePendingApprovalTarget,
} from '../approval-target-validator.helper';

vi.mock('../../sale-orders/sale-order-opportunity-link.helper', () => ({
  assertOpportunityHasNoActiveSaleOrder: vi.fn().mockResolvedValue(undefined),
  lockSaleOrderRelationshipsBeforeCustomerTouch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/financial-limits.helper', () => ({
  lockSaleOrderFinancialGraph: vi.fn().mockResolvedValue([]),
  validateFinancialSaleOrderAfterLock: vi.fn(
    async (_tx: unknown, input: { saleOrderId: string; expectedCustomerId?: string | null }) => ({
      id: input.saleOrderId,
      customerId: input.expectedCustomerId ?? 'customer-1',
      opportunityId: null,
      chargerId: 'emp-1',
      flowStatus: 'approved',
      version: 1,
    })
  ),
}));

function createTransaction() {
  return {
    employee: {
      findFirst: vi.fn().mockResolvedValue({ id: 'emp-1' }),
    },
    rolePermission: {
      findMany: vi.fn().mockResolvedValue([{ viewScope: 'ALL' }]),
    },
    saleOrder: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'so-1',
        customerId: 'customer-1',
        opportunityId: 'opportunity-1',
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: 'so-1',
        version: 7,
        flowStatus: 'approved',
        customerId: 'customer-1',
        opportunityId: 'opportunity-1',
        chargerId: 'emp-1',
      }),
    },
    customer: {
      findFirst: vi.fn().mockResolvedValue({ id: 'customer-1' }),
    },
    opportunity: {
      findFirst: vi.fn().mockResolvedValue({ id: 'opportunity-1' }),
    },
  };
}

function createInvoiceTransaction(sourcePaymentIds: unknown, reverseReferenceCount: number) {
  return {
    employee: {
      findFirst: vi.fn().mockResolvedValue({ id: 'emp-1' }),
    },
    rolePermission: {
      findMany: vi.fn().mockResolvedValue([{ viewScope: 'ALL' }]),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'invoice-1',
        saleOrderId: 'so-1',
        customerId: 'customer-1',
      }),
      findFirst: vi.fn().mockResolvedValue({
        id: 'invoice-1',
        saleOrderId: 'so-1',
        customerId: 'customer-1',
        chargerId: null,
        sourcePaymentIds,
      }),
    },
    payment: {
      count: vi.fn().mockResolvedValue(reverseReferenceCount),
    },
  };
}

describe('approval target validator 的 SaleOrder 商机占用检查', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只改备注时仍锁后复查最终引用，但不误拦历史一商机多订单', async () => {
    const tx = createTransaction();

    await lockAndValidateApprovalChangeTargetForApproval(tx as never, {
      targetType: 'sale_order',
      targetId: 'so-1',
      targetVersion: 7,
      patch: { remark: '仅修改备注' },
      initiatorEmployeeId: 'emp-1',
    });

    expect(lockSaleOrderRelationshipsBeforeCustomerTouch).toHaveBeenCalled();
    expect(tx.opportunity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'opportunity-1',
          customerId: 'customer-1',
          deletedAt: null,
        }),
      })
    );
    expect(assertOpportunityHasNoActiveSaleOrder).not.toHaveBeenCalled();
  });

  it('历史订单变更审批的 pending + 基准版本加一快照可继续审批', async () => {
    const tx = createTransaction();
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      version: 8,
      flowStatus: 'pending',
      customerId: 'customer-1',
      opportunityId: 'opportunity-1',
      chargerId: 'emp-1',
    });

    await expect(
      lockAndValidateApprovalChangeTargetForApproval(tx as never, {
        targetType: 'sale_order',
        targetId: 'so-1',
        targetVersion: 7,
        eventType: 'sale_order_change',
        patch: { remark: '历史变更' },
        initiatorEmployeeId: 'emp-1',
      })
    ).resolves.toMatchObject({
      where: { id: 'so-1', version: 8, flowStatus: 'pending', deletedAt: null },
    });
  });

  it('回款推进订单版本后允许订单变更审批进入字段级冲突校验', async () => {
    const tx = createTransaction();
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      version: 9,
      flowStatus: 'approved',
      customerId: 'customer-1',
      opportunityId: 'opportunity-1',
      chargerId: 'emp-1',
    });

    await expect(
      lockAndValidateApprovalChangeTargetForApproval(tx as never, {
        targetType: 'sale_order',
        targetId: 'so-1',
        targetVersion: 7,
        eventType: 'sale_order_change',
        patch: { remark: '赠送一台考勤机', otherFee: 345 },
        initiatorEmployeeId: 'emp-1',
      })
    ).resolves.toMatchObject({
      where: { id: 'so-1', version: 9, flowStatus: 'approved', deletedAt: null },
    });
  });

  it('实际改绑商机时锁后执行一商机一有效订单检查', async () => {
    const tx = createTransaction();
    tx.opportunity.findFirst.mockResolvedValue({ id: 'opportunity-2' });

    await lockAndValidateApprovalChangeTargetForApproval(tx as never, {
      targetType: 'sale_order',
      targetId: 'so-1',
      targetVersion: 7,
      patch: { opportunityId: 'opportunity-2' },
      initiatorEmployeeId: 'emp-1',
    });

    expect(assertOpportunityHasNoActiveSaleOrder).toHaveBeenCalledWith(tx, 'opportunity-2', 'so-1');
  });

  it('纠错作废不校验已软删的历史关联商机', async () => {
    const tx = createTransaction();
    tx.opportunity.findFirst.mockResolvedValue(null);

    await expect(
      lockAndValidateApprovalChangeTargetForApproval(tx as never, {
        targetType: 'sale_order',
        targetId: 'so-1',
        targetVersion: 7,
        eventType: 'sale_order_void',
        patch: { __operation: 'void_bundle' },
        initiatorEmployeeId: 'emp-1',
      })
    ).resolves.toMatchObject({ targetType: 'sale_order' });

    expect(tx.opportunity.findFirst).not.toHaveBeenCalled();
  });

  it('订单激活审批始终检查商机是否已被其他有效订单占用', async () => {
    const tx = createTransaction();

    await lockAndValidatePendingApprovalTarget(tx as never, {
      eventType: 'sale_order_activate',
      formId: 'so-1',
      targetVersion: 7,
      initiatorEmployeeId: 'emp-1',
    });

    expect(assertOpportunityHasNoActiveSaleOrder).toHaveBeenCalledWith(tx, 'opportunity-1', 'so-1');
  });
});

describe('approval target validator 的 Invoice 改绑反向引用检查', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('开票审批不要求发票负责人', async () => {
    const tx = createInvoiceTransaction([], 0);

    await expect(
      lockAndValidatePendingApprovalTarget(tx as never, {
        eventType: 'invoice_approve',
        formId: 'invoice-1',
        targetVersion: 3,
        initiatorEmployeeId: 'emp-1',
      })
    ).resolves.toMatchObject({ targetType: 'invoice' });
  });

  it('改绑时 sourcePaymentIds 非空则返回 409', async () => {
    const tx = createInvoiceTransaction(['payment-1'], 0);

    await expect(
      lockAndValidateApprovalChangeTargetForApproval(tx as never, {
        targetType: 'invoice',
        targetId: 'invoice-1',
        targetVersion: 3,
        patch: { saleOrderId: 'so-2' },
        initiatorEmployeeId: 'emp-1',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('改绑时 active Payment 通过任一发票反向字段引用则返回 409', async () => {
    const tx = createInvoiceTransaction([], 1);

    await expect(
      lockAndValidateApprovalChangeTargetForApproval(tx as never, {
        targetType: 'invoice',
        targetId: 'invoice-1',
        targetVersion: 3,
        patch: { saleOrderId: 'so-2' },
        initiatorEmployeeId: 'emp-1',
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.payment.count).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [{ invoicedByInvoiceId: 'invoice-1' }, { relatedInvoiceId: 'invoice-1' }],
      },
    });
  });

  it('改绑时 sourcePaymentIds 为空且无 active Payment 反向引用则通过', async () => {
    const tx = createInvoiceTransaction([], 0);

    await expect(
      lockAndValidateApprovalChangeTargetForApproval(tx as never, {
        targetType: 'invoice',
        targetId: 'invoice-1',
        targetVersion: 3,
        patch: { saleOrderId: 'so-2' },
        initiatorEmployeeId: 'emp-1',
      })
    ).resolves.toMatchObject({ targetType: 'invoice' });
  });
});
