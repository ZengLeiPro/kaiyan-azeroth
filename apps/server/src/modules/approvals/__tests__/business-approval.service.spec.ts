import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { recomputeCustomerLifecycle } from '../../customers/customer-lifecycle';
import { reconcileSaleOrderActivationLifecycle } from '../../sale-orders/sale-order-activation-lifecycle.helper';
import {
  lockAndValidateApprovalChangeTargetForApproval,
  lockAndValidateApprovalSubmissionTarget,
  lockAndValidatePendingApprovalTarget,
} from '../approval-target-validator.helper';
import { ApprovalsService } from '../approvals.service';
import { BusinessApprovalService } from '../business-approval.service';

vi.mock('../approval-target-validator.helper', () => ({
  lockAndValidateApprovalChangeTargetForApproval: vi
    .fn()
    .mockResolvedValue({ targetType: 'invoice', where: {} }),
  lockAndValidateApprovalSubmissionTarget: vi
    .fn()
    .mockResolvedValue({ targetType: 'invoice', where: {} }),
  lockAndValidatePendingApprovalTarget: vi
    .fn()
    .mockResolvedValue({ targetType: 'invoice', where: {} }),
}));
vi.mock('../../customers/customer-lifecycle', () => ({
  recomputeCustomerLifecycle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/sale-order-activation-lifecycle.helper', () => ({
  reconcileSaleOrderActivationLifecycle: vi.fn().mockResolvedValue(undefined),
}));

const mockApprovalsService = {
  createApprovalInstance: vi.fn(),
  completeInstanceTodos: vi.fn(),
  notifyOnSubmit: vi.fn().mockResolvedValue(undefined),
};

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    serialNumber: 'INV001',
    invoiceAmount: 10000,
    title: '示例科技',
    flowStatus: 'draft',
    version: 3,
    deletedAt: null,
    customerId: 'customer-1',
    saleOrderId: 'order-1',
    customer: { id: 'customer-1', customerName: '示例科技', shortName: null },
    saleOrder: { id: 'order-1', serialNumber: 'DD001' },
    ...overrides,
  };
}

describe('BusinessApprovalService', () => {
  let service: BusinessApprovalService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'locked-target' }]);
    service = new BusinessApprovalService(
      asPrismaService(mockPrisma),
      mockApprovalsService as unknown as ApprovalsService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('新建即提审持久化创建后业务 targetVersion', async () => {
    const record = buildInvoice({ flowStatus: 'pending', version: 1 });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'inst-new' });

    const instanceId = await service.createApprovalForNewRecord(
      mockPrisma as never,
      'invoice_approve',
      record,
      { id: 'user-1', employeeId: 'emp-1' }
    );

    expect(instanceId).toBe('inst-new');
    expect(lockAndValidatePendingApprovalTarget).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ targetVersion: 1, initiatorEmployeeId: 'emp-1' })
    );
    expect(mockApprovalsService.createApprovalInstance).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ formId: 'invoice-1', targetVersion: 1 }),
      { id: 'user-1', employeeId: 'emp-1' }
    );
  });

  it('审批中表单在事务内校验发起人，已通过单据仍禁止直接编辑', () => {
    expect(() => service.assertCanDirectEdit('draft', '合同订单')).not.toThrow();
    expect(() => service.assertCanDirectEdit('rejected', '合同订单')).not.toThrow();
    expect(() => service.assertCanDirectEdit('pending', '合同订单')).not.toThrow();
    expect(() => service.assertCanDirectEdit('approved', '合同订单')).toThrow(BadRequestException);
  });

  it('锁定发起人的审批中表单，并在业务更新后同步审批快照', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'approval-1', initiatorId: 'user-1', version: 4 },
    ]);
    mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
    const lock = await service.lockPendingFormEdit(
      mockPrisma as never,
      'invoice_approve',
      'invoice-1',
      'pending',
      { id: 'user-1', employeeId: 'emp-1' }
    );

    await service.syncPendingFormEdit(
      mockPrisma as never,
      lock,
      'invoice_approve',
      buildInvoice({ version: 5, invoiceAmount: 12000 }),
      { id: 'user-1', employeeId: 'emp-1' }
    );

    expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'approval-1',
          initiatorId: 'user-1',
          version: 4,
          status: 'pending',
        }),
        data: expect.objectContaining({ targetVersion: 5 }),
      })
    );
  });

  it('拒绝非发起人编辑审批中表单', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.approvalInstance.findFirst.mockResolvedValue({ id: 'approval-1' });

    await expect(
      service.lockPendingFormEdit(mockPrisma as never, 'invoice_approve', 'invoice-1', 'pending', {
        id: 'other-user',
      })
    ).rejects.toThrow('只有审批发起人或管理员可在审核通过前修改表单');
  });

  it('允许管理员编辑其他发起人的审批中表单，并保留原审批发起人', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'approval-1', initiatorId: 'user-1', version: 4 },
    ]);
    mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });

    const lock = await service.lockPendingFormEdit(
      mockPrisma as never,
      'invoice_approve',
      'invoice-1',
      'pending',
      { id: 'admin-1', roles: ['ADMIN'] }
    );
    await service.syncPendingFormEdit(
      mockPrisma as never,
      lock,
      'invoice_approve',
      buildInvoice({ version: 5, invoiceAmount: 12000 }),
      { id: 'admin-1', roles: ['ADMIN'] }
    );

    expect(lock).toEqual({ id: 'approval-1', initiatorId: 'user-1', version: 4 });
    expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ initiatorId: 'user-1' }),
        data: expect.objectContaining({ targetVersion: 5 }),
      })
    );
  });

  it('审批中或已通过的业务单据不能直接删除', () => {
    expect(() => service.assertCanDelete('draft', '合同订单')).not.toThrow();
    expect(() => service.assertCanDelete('rejected', '合同订单')).not.toThrow();
    expect(() => service.assertCanDelete('pending', '合同订单')).toThrow(BadRequestException);
    expect(() => service.assertCanDelete('approved', '合同订单')).toThrow(BadRequestException);
  });

  it('管理员也可发起变更审批（2026-06 改造后 ADMIN 拦截已删除）', async () => {
    // Arrange：构造变更审批所需的 prisma mock；改造后 ADMIN 走完整路径
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
    mockPrisma.approvalChangeRequest.create.mockResolvedValue({ id: 'change-1' });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'inst-1' });
    mockPrisma.approvalChangeRequest.update.mockResolvedValue({
      id: 'change-1',
      approvalInstanceId: 'inst-1',
    });

    const result = await service.submitChangeApproval(
      {
        eventType: 'invoice_change',
        targetType: 'invoice',
        targetId: 'invoice-1',
        targetCode: 'INV001',
        title: '开票变更｜INV001',
        baseVersion: 1,
        patch: { remark: 'admin' },
        beforeSnapshot: {},
        afterSnapshot: {},
      },
      { id: 'admin-1', employeeId: 'emp-admin', roles: ['ADMIN'] }
    );

    expect(result).toBeDefined();
    expect(mockApprovalsService.createApprovalInstance).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ eventType: 'invoice_change', formId: 'change-1' }),
      { id: 'admin-1', employeeId: 'emp-admin', roles: ['ADMIN'] }
    );
    expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.approvalChangeRequest.findFirst.mock.invocationCallOrder[0]!
    );
  });

  it('订单重新提交变更时自动作废旧审批并创建新入口', async () => {
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'change-old',
      approvalInstanceId: 'instance-old',
      patch: { remark: '旧备注' },
    });
    mockPrisma.approvalChangeRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.approvalChangeRequest.create.mockResolvedValue({ id: 'change-new' });
    mockPrisma.approvalChangeRequest.update.mockResolvedValue({});
    mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'instance-new' });

    await service.submitChangeApproval(
      {
        eventType: 'sale_order_change',
        targetType: 'sale_order',
        targetId: 'order-1',
        title: '合同订单变更',
        baseVersion: 3,
        patch: { remark: '新备注' },
        beforeSnapshot: { remark: '旧备注' },
        afterSnapshot: { remark: '新备注' },
      },
      { id: 'user-1', employeeId: 'emp-1' }
    );

    expect(mockPrisma.approvalChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'change-old', status: 'pending' }),
        data: expect.objectContaining({ status: 'withdrawn' }),
      })
    );
    expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'instance-old', status: 'pending' }),
        data: expect.objectContaining({ status: 'withdrawn' }),
      })
    );
    expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comment: '销售重新提交订单变更，原审批自动失效' }),
      })
    );
    expect(mockPrisma.approvalChangeRequest.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'change-old' },
        data: expect.objectContaining({
          patch: expect.objectContaining({ __latestApprovalInstanceId: 'instance-new' }),
        }),
      })
    );
    expect(mockApprovalsService.completeInstanceTodos).toHaveBeenCalledWith('instance-old');
  });

  it('目标锁与 pending 检查后在同事务执行模块校验，校验成功才创建申请', async () => {
    const validateInTransaction = vi.fn().mockResolvedValue(undefined);
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
    mockPrisma.approvalChangeRequest.create.mockResolvedValue({ id: 'change-validated' });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'inst-validated' });
    mockPrisma.approvalChangeRequest.update.mockResolvedValue({});

    await service.submitChangeApproval(
      {
        eventType: 'sale_order_change',
        targetType: 'sale_order',
        targetId: 'order-1',
        title: '合同订单变更',
        baseVersion: 1,
        patch: { remark: 'validated' },
        beforeSnapshot: {},
        afterSnapshot: {},
        validateInTransaction,
      },
      { id: 'user-1', employeeId: 'emp-1' }
    );

    expect(validateInTransaction).toHaveBeenCalledWith(mockPrisma);
    expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.approvalChangeRequest.findFirst.mock.invocationCallOrder[0]!
    );
    expect(mockPrisma.approvalChangeRequest.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mock.invocationCallOrder[0]!
    );
    expect(
      vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mock.invocationCallOrder[0]
    ).toBeLessThan(validateInTransaction.mock.invocationCallOrder[0]!);
    expect(validateInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.approvalChangeRequest.create.mock.invocationCallOrder[0]!
    );
  });

  it('6 类 change 提交都调用最终 patch 强制 validator 并持久 targetVersion', async () => {
    const targetTypes = [
      'customer',
      'sale_order',
      'invoice',
      'payment',
      'payment_refund',
      'visit_record',
    ] as const;

    for (const targetType of targetTypes) {
      vi.clearAllMocks();
      mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.approvalChangeRequest.create.mockResolvedValue({ id: `change-${targetType}` });
      mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'instance-1' });
      mockPrisma.approvalChangeRequest.update.mockResolvedValue({});

      await service.submitChangeApproval(
        {
          eventType: `${targetType}_change`,
          targetType,
          targetId: `target-${targetType}`,
          title: '变更审批',
          baseVersion: 7,
          patch: { remark: 'new' },
          beforeSnapshot: {},
          afterSnapshot: {},
        },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      expect(lockAndValidateApprovalChangeTargetForApproval).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          targetType,
          targetId: `target-${targetType}`,
          targetVersion: 7,
          patch: { remark: 'new' },
          initiatorEmployeeId: 'emp-1',
        })
      );
      expect(mockPrisma.approvalChangeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ baseVersion: 7 }),
        })
      );
      expect(mockApprovalsService.createApprovalInstance).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ targetVersion: 7 }),
        { id: 'user-1', employeeId: 'emp-1' }
      );
    }
  });

  it('统一 validator 判定 targetVersion 陈旧时返回 409，模块校验与 create 均不执行', async () => {
    const validateInTransaction = vi.fn();
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
    vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mockRejectedValueOnce(
      new ConflictException('审批目标版本已变化')
    );

    await expect(
      service.submitChangeApproval(
        {
          eventType: 'invoice_change',
          targetType: 'invoice',
          targetId: 'invoice-1',
          title: '开票变更',
          baseVersion: 3,
          patch: { remark: 'stale' },
          beforeSnapshot: {},
          afterSnapshot: {},
          validateInTransaction,
        },
        { id: 'user-1', employeeId: 'emp-1' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(lockAndValidateApprovalChangeTargetForApproval).toHaveBeenCalled();
    expect(validateInTransaction).not.toHaveBeenCalled();
    expect(mockPrisma.approvalChangeRequest.create).not.toHaveBeenCalled();
  });

  it('锁后 target-specific validator 失败时事务抛 409，且不得 create', async () => {
    const validateInTransaction = vi
      .fn()
      .mockRejectedValue(new ConflictException('目标引用或范围已变化'));
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.submitChangeApproval(
        {
          eventType: 'customer_tag_change',
          targetType: 'customer',
          targetId: 'customer-1',
          title: '线索阶段变更',
          baseVersion: 2,
          patch: { leadStage: 'SQL' },
          beforeSnapshot: {},
          afterSnapshot: {},
          validateInTransaction,
        },
        { id: 'user-1', employeeId: 'emp-1' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(validateInTransaction).toHaveBeenCalledWith(mockPrisma);
    expect(mockPrisma.approvalChangeRequest.create).not.toHaveBeenCalled();
  });

  it('同 target 已有 pending 时锁后返回 409，且不创建第二条申请', async () => {
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue({ id: 'change-existing' });

    await expect(
      service.submitChangeApproval(
        {
          eventType: 'invoice_change',
          targetType: 'invoice',
          targetId: 'invoice-1',
          title: '开票变更',
          baseVersion: 1,
          patch: { remark: 'duplicate' },
          beforeSnapshot: {},
          afterSnapshot: {},
        },
        { id: 'user-1', employeeId: 'emp-1' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockPrisma.approvalChangeRequest.create).not.toHaveBeenCalled();
  });

  it('pending partial UNIQUE 的 P2002 兜底映射为 409', async () => {
    mockPrisma.approvalChangeRequest.findFirst.mockResolvedValue(null);
    mockPrisma.approvalChangeRequest.create.mockRejectedValue({
      code: 'P2002',
      message: 'pending unique conflict',
      meta: { target: 'approval_change_requests_target_pending_unique' },
    });

    await expect(
      service.submitChangeApproval(
        {
          eventType: 'invoice_change',
          targetType: 'invoice',
          targetId: 'invoice-1',
          title: '开票变更',
          baseVersion: 1,
          patch: { remark: 'race' },
          beforeSnapshot: {},
          afterSnapshot: {},
        },
        { id: 'user-1', employeeId: 'emp-1' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(mockApprovalsService.createApprovalInstance).not.toHaveBeenCalled();
  });

  it('开票提交审批：创建审批实例、更新业务 pending 并在同事务写操作日志', async () => {
    const invoice = buildInvoice();
    const pendingInvoice = { ...invoice, flowStatus: 'pending', version: 4 };
    mockPrisma.invoice.findFirst
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce(pendingInvoice);
    mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'inst-1' });
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.submitBusinessApproval('invoice_approve', 'invoice-1', {
      id: 'user-1',
      employeeId: 'emp-1',
    });

    expect(result).toBeDefined();
    expect(mockApprovalsService.createApprovalInstance).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        eventType: 'invoice_approve',
        formId: 'invoice-1',
        formCode: 'INV001',
        title: '开票申请｜示例科技｜￥10,000.00｜订单DD001｜INV001',
        targetVersion: 4,
      }),
      { id: 'user-1', employeeId: 'emp-1' }
    );
    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invoice-1',
        deletedAt: null,
        version: 3,
        flowStatus: 'draft',
      },
      data: {
        flowStatus: 'pending',
        version: { increment: 1 },
        updaterEmployeeId: 'emp-1',
      },
    });
    expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp-1',
        module: 'invoices',
        action: 'submit-approval',
        target: 'invoice-1',
        targetCustomerId: 'customer-1',
        details: expect.objectContaining({
          kind: 'change',
          targetName: 'INV001',
          before: invoice,
          after: pendingInvoice,
        }),
      }),
    });
  });

  it('操作日志写入失败时审批提交事务整体失败且不发送通知', async () => {
    const invoice = buildInvoice();
    const pendingInvoice = { ...invoice, flowStatus: 'pending', version: 4 };
    mockPrisma.invoice.findFirst
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce(pendingInvoice);
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({ id: 'inst-log-fail' });
    mockPrisma.operationLog.create.mockRejectedValue(new Error('operation log unavailable'));

    await expect(
      service.submitBusinessApproval('invoice_approve', 'invoice-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      })
    ).rejects.toThrow('operation log unavailable');

    expect(mockPrisma.operationLog.create).toHaveBeenCalled();
    expect(mockApprovalsService.notifyOnSubmit).not.toHaveBeenCalled();
  });

  it('self-approve 后保留业务 approved 终态，且 CAS 必须发生在实例创建前', async () => {
    const invoice = buildInvoice();
    const approvedInvoice = { ...invoice, flowStatus: 'approved', version: 5 };
    mockPrisma.invoice.findFirst
      .mockResolvedValueOnce(invoice)
      .mockResolvedValueOnce(approvedInvoice);
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({
      id: 'inst-self',
      status: 'approved',
    });

    const result = await service.submitBusinessApproval('invoice_approve', 'invoice-1', {
      id: 'user-1',
      employeeId: 'emp-1',
    });

    expect(result).toMatchObject({ id: 'inst-self', status: 'approved' });
    expect(mockPrisma.invoice.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invoice.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockApprovalsService.createApprovalInstance.mock.invocationCallOrder[0]!
    );
    expect(mockPrisma.invoice.findFirst).toHaveBeenCalledTimes(2);
  });

  it('legacy SaleOrder NULL→pending 在同一事务撤销订单生效事实', async () => {
    const legacyOrder = {
      id: 'order-legacy',
      serialNumber: 'SO-LEGACY',
      orderTitle: '历史合同',
      orderAmount: 1000,
      customerId: 'cust-legacy',
      opportunityId: 'opp-legacy',
      flowStatus: null,
      version: 7,
      deletedAt: null,
      customer: { id: 'cust-legacy', customerName: '历史客户', shortName: null },
    };
    mockPrisma.saleOrder.findFirst
      .mockResolvedValueOnce(legacyOrder)
      .mockResolvedValueOnce({ ...legacyOrder, flowStatus: 'pending', version: 8 });
    mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 1 });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({
      id: 'inst-sale-order',
      status: 'pending',
    });

    await service.submitBusinessApproval(
      'sale_order_activate',
      legacyOrder.id,
      { id: 'user-1', employeeId: 'emp-1' },
      null
    );

    expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
      mockPrisma,
      {
        opportunityIds: ['opp-legacy'],
        customerIds: ['cust-legacy'],
        retractedOpportunityIds: ['opp-legacy'],
      },
      { id: 'user-1', employeeId: 'emp-1' }
    );
  });

  it('legacy Visit NULL→pending 在同一事务撤销拜访生效事实', async () => {
    const legacyVisit = {
      id: 'visit-legacy',
      customerId: 'cust-legacy',
      signAddress: '客户现场',
      flowStatus: null,
      version: 4,
      deletedAt: null,
      customer: { id: 'cust-legacy', customerName: '历史客户', shortName: null },
      contact: null,
    };
    mockPrisma.visitRecord.findFirst
      .mockResolvedValueOnce(legacyVisit)
      .mockResolvedValueOnce({ ...legacyVisit, flowStatus: 'pending', version: 5 });
    mockPrisma.visitRecord.updateMany.mockResolvedValue({ count: 1 });
    mockApprovalsService.createApprovalInstance.mockResolvedValue({
      id: 'inst-visit',
      status: 'pending',
    });

    await service.submitBusinessApproval(
      'visit_approve',
      legacyVisit.id,
      { id: 'user-1', employeeId: 'emp-1' },
      null
    );

    expect(recomputeCustomerLifecycle).toHaveBeenCalledWith(mockPrisma, 'cust-legacy', {
      syncLeadProgress: true,
      actor: { id: 'user-1', employeeId: 'emp-1' },
    });
  });

  it('submit 与 delete/edit 竞争导致 CAS 未命中时返回 409，且不创建审批实例', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice());
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.submitBusinessApproval('invoice_approve', 'invoice-1', {
        id: 'user-1',
        employeeId: 'emp-1',
      })
    ).rejects.toThrow(ConflictException);

    expect(mockApprovalsService.createApprovalInstance).not.toHaveBeenCalled();
  });

  it('缺少 employeeId 时不把认证 id 猜成 Employee FK，强制 validator fail-closed', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice());
    vi.mocked(lockAndValidateApprovalSubmissionTarget).mockRejectedValueOnce(
      new ForbiddenException('审批缺少可验证的发起员工')
    );

    await expect(
      service.submitBusinessApproval('invoice_approve', 'invoice-1', { id: 'auth-user-only' }, [
        'emp-scope',
      ])
    ).rejects.toThrow(ForbiddenException);

    expect(lockAndValidateApprovalSubmissionTarget).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ initiatorEmployeeId: undefined })
    );
    expect(mockPrisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(mockApprovalsService.createApprovalInstance).not.toHaveBeenCalled();
  });

  it('flowStatus=pending 时重复提交报错', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice({ flowStatus: 'pending' }));

    await expect(
      service.submitBusinessApproval('invoice_approve', 'invoice-1', { id: 'user-1' })
    ).rejects.toThrow(BadRequestException);
    expect(mockApprovalsService.createApprovalInstance).not.toHaveBeenCalled();
  });

  it('flowStatus=approved 时重复提交报错', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(buildInvoice({ flowStatus: 'approved' }));

    await expect(
      service.submitBusinessApproval('invoice_approve', 'invoice-1', { id: 'user-1' })
    ).rejects.toThrow(BadRequestException);
  });

  it('业务记录不存在时报 NotFoundException', async () => {
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    await expect(
      service.submitBusinessApproval('invoice_approve', 'invoice-1', { id: 'user-1' })
    ).rejects.toThrow(NotFoundException);
  });

  it('不支持的 eventType 报错', async () => {
    await expect(
      service.submitBusinessApproval('unknown_event', 'form-1', { id: 'user-1' })
    ).rejects.toThrow(BadRequestException);
  });
});
