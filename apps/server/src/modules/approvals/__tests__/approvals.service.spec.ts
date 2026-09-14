import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { vi } from 'vitest';

import { DataScopeService } from '../../../common/services/data-scope.service';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import {
  asSerialNumberService,
  createMockSerialNumberService,
  type MockSerialNumberService,
} from '../../../test/serial-number-mock.factory';
import { reconcileSaleOrderActivationLifecycle } from '../../sale-orders/sale-order-activation-lifecycle.helper';
import { ApprovalBusinessEffectDispatcher } from '../approval-business-effect.dispatcher';
import { ApprovalChangeRequestsService } from '../approval-change-requests.service';
import { ApprovalNotifier } from '../approval-notifier.service';
import { ApprovalQueryService } from '../approval-query.service';
import { lockAndValidatePendingApprovalTarget } from '../approval-target-validator.helper';
import { ApprovalTransitionEngine } from '../approval-transition.engine';
import { ApprovalsController } from '../approvals.controller';
import { ApprovalsService } from '../approvals.service';
import { ApproverResolverService } from '../approver-resolver.service';

vi.mock('../approval-target-validator.helper', () => ({
  lockAndValidatePendingApprovalTarget: vi.fn().mockResolvedValue({ targetType: 'sale_order' }),
}));
vi.mock('../../sale-orders/invoiced-summary.helper', () => ({
  recalcSaleOrderInvoicedSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/sale-order-activation-lifecycle.helper', () => ({
  reconcileSaleOrderActivationLifecycle: vi.fn().mockResolvedValue(undefined),
}));

const mockApproverResolver = {
  resolveApprovers: vi.fn(),
  validateNodeConfig: vi.fn(),
  getUserInfo: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    code: 'SP0001',
    flowId: 'flow-1',
    flowVersion: 1,
    eventType: 'sale_order_activate',
    formId: 'form-1',
    formCode: 'SO001',
    targetVersion: 3,
    title: '测试审批',
    status: 'pending',
    version: 1,
    currentNode: 1,
    totalNodes: 1,
    initiatorId: 'user-1',
    initiatorName: '发起人',
    copyToIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    creatorEmployeeId: 'emp-user-1',
    deletedAt: null,
    ...overrides,
  };
}

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    instanceId: 'inst-1',
    nodeOrder: 1,
    nodeName: '审批节点1',
    approverId: 'approver-1',
    approverName: '审批人',
    approverType: 'user',
    sequence: 1,
    status: 'pending',
    comment: null,
    actionTime: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildFlow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flow-1',
    name: '测试流程',
    code: 'FLOW001',
    eventType: 'sale_order_activate',
    status: 'active',
    version: 1,
    copyToIds: ['copy-user-1'],
    nodes: [
      {
        id: 'node-1',
        flowId: 'flow-1',
        nodeName: '审批节点1',
        nodeOrder: 1,
        multiType: 'or',
        approverType: 'user',
        approverConfig: {},
      },
    ],
    ...overrides,
  };
}

function buildApprover(overrides: Record<string, unknown> = {}) {
  return {
    approverId: 'approver-1',
    approverName: '审批人',
    approverType: 'user',
    sequence: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const mockDingtalkTodo = {
  createTask: vi.fn().mockResolvedValue(null),
  completeTask: vi.fn().mockResolvedValue(true),
};

const mockApprovalChangeRequests = {
  validatePendingTargetSnapshot: vi.fn().mockResolvedValue(false),
  validatePendingTargetForApproval: vi.fn().mockResolvedValue(false),
  handleApprovalResult: vi.fn().mockResolvedValue(false),
  handleWithdraw: vi.fn().mockResolvedValue(false),
};

// CRM 回款 ↔ 财务流水绑定 v2.1 同步钩子，spec 默认 FEATURE_FLAG=false 等价空实现
const mockFinanceLedgerSync = {
  syncFromPayment: vi.fn().mockResolvedValue(undefined),
  revokeFromPayment: vi.fn().mockResolvedValue(undefined),
};

const mockOrderProductReceivableService = {
  recalculateForPayment: vi.fn().mockResolvedValue({ updated: 0 }),
};

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('SP');

    const prisma = asPrismaService(mockPrisma);
    const approverResolver = mockApproverResolver as unknown as ApproverResolverService;
    const changeRequests =
      mockApprovalChangeRequests as unknown as import('../approval-change-requests.service').ApprovalChangeRequestsService;
    const businessEffects = new ApprovalBusinessEffectDispatcher(
      changeRequests,
      mockFinanceLedgerSync as unknown as import('../../finance/sync/finance-ledger-sync.service').FinanceLedgerSyncService,
      mockOrderProductReceivableService as unknown as import('../../finance/receivables/order-product-receivable.service').OrderProductReceivableService
    );
    const transitionEngine = new ApprovalTransitionEngine(
      prisma,
      approverResolver,
      changeRequests,
      businessEffects
    );
    const notifier = new ApprovalNotifier(
      prisma,
      mockDingtalkTodo as unknown as import('../../dingtalk-todo/dingtalk-todo.service').DingtalkTodoService,
      {
        deliverForInstance: vi.fn().mockResolvedValue(undefined),
      } as unknown as import('../approval-notification-outbox.service').ApprovalNotificationOutboxService
    );

    service = new ApprovalsService(
      prisma,
      approverResolver,
      asSerialNumberService(mockSerialNumber),
      transitionEngine,
      notifier,
      new ApprovalQueryService(prisma)
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 通用默认 mock：让"申请人=审批人自动通过"链式推进在默认场景下早退（找不到 self 节点）。
  // 自动通过专属测试在本文件最后一段 describe 'autoPass' 里独立设定。
  // ---------------------------------------------------------------------------
  beforeEach(() => {
    // autoPassSelfTasksAndAdvance 内部用 tx.approvalTask.findMany 拉当前节点任务，
    // 默认返回空数组 → selfPendingTasks=[] → 立刻 return，不影响老路径行为。
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.approvalTask.findMany.mockResolvedValue([]);
    mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.saleOrder.update.mockResolvedValue({
      customerId: 'cust-sale-order',
      opportunityId: 'opp-sale-order',
    } as never);
    mockPrisma.customer.findFirst.mockResolvedValue(null);
  });

  // =========================================================================
  // createApprovalInstance（仅供已完成业务守卫的内部事务调用）
  // =========================================================================

  describe('createApprovalInstance', () => {
    const dto = {
      eventType: 'sale_order_activate' as const,
      formId: 'form-1',
      formCode: 'SO001',
      title: '测试审批',
      targetVersion: 3,
    };

    it('成功提交审批（实例 + 任务 + 记录）', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(buildFlow());
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockApproverResolver.validateNodeConfig.mockResolvedValue(true);
      mockApproverResolver.resolveApprovers.mockResolvedValue([buildApprover()]);
      mockPrisma.approvalInstance.create.mockResolvedValue(buildInstance());
      mockPrisma.approvalTask.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.createApprovalInstance(mockPrisma as never, dto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      expect(result).toBeDefined();
      expect(mockPrisma.approvalInstance.create).toHaveBeenCalled();
      expect(mockPrisma.approvalTask.createMany).toHaveBeenCalled();
      expect(mockPrisma.approvalRecord.create).toHaveBeenCalled();
    });

    it('已有进行中的审批 → BadRequestException', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(buildInstance());

      await expect(
        service.createApprovalInstance(mockPrisma as never, dto, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('已有 rejected/withdrawn 旧实例不阻挡再次提交（partial unique 修复，2026-06）', async () => {
      // 应用层守卫 createApprovalInstance:372 只查 status='pending'，rejected/withdrawn
      // 实例不会出现在结果里 → 直接放行。DB 层 partial unique 也仅约束 pending。
      // 此用例锁定该行为，防止后续误把 status 过滤拿掉导致驳回后再提单被错误拒绝。
      mockPrisma.approvalInstance.findFirst.mockImplementation((args: unknown) => {
        const where = (args as { where?: { status?: string } } | undefined)?.where;
        // 模拟表里有同 (eventType,formId) 的 rejected 实例——但守卫查询带 status='pending'
        // 不会命中。
        if (where?.status === 'pending') return Promise.resolve(null);
        return Promise.resolve(buildInstance({ status: 'rejected' }));
      });
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(buildFlow());
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockApproverResolver.validateNodeConfig.mockResolvedValue(true);
      mockApproverResolver.resolveApprovers.mockResolvedValue([buildApprover()]);
      mockPrisma.approvalInstance.create.mockResolvedValue(buildInstance());
      mockPrisma.approvalTask.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      await expect(
        service.createApprovalInstance(mockPrisma as never, dto, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).resolves.toBeDefined();
      expect(mockPrisma.approvalInstance.create).toHaveBeenCalled();
    });

    it('无激活流程 → BadRequestException', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(null);

      await expect(
        service.createApprovalInstance(mockPrisma as never, dto, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('流程无节点 → BadRequestException', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(buildFlow({ nodes: [] }));

      await expect(
        service.createApprovalInstance(mockPrisma as never, dto, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('发起人不存在 → BadRequestException', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(buildFlow());
      mockApproverResolver.getUserInfo.mockResolvedValue(null);

      await expect(
        service.createApprovalInstance(mockPrisma as never, dto, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('节点无有效审批人 → BadRequestException', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(buildFlow());
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockApproverResolver.validateNodeConfig.mockResolvedValue(false);

      await expect(
        service.createApprovalInstance(mockPrisma as never, dto, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('生成编号 — serialNumber.generate 被调用', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(buildFlow());
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockApproverResolver.validateNodeConfig.mockResolvedValue(true);
      mockApproverResolver.resolveApprovers.mockResolvedValue([buildApprover()]);
      mockPrisma.approvalInstance.create.mockResolvedValue(buildInstance());
      mockPrisma.approvalTask.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      await service.createApprovalInstance(mockPrisma as never, dto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      expect(mockSerialNumber.generate).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // doApproval - reject
  // =========================================================================

  describe('doApproval - reject', () => {
    const rejectDto = { action: 'reject' as const, comment: '不同意' };

    function setupRejectInstance() {
      const flow = buildFlow();
      const tasks = [buildTask({ approverId: 'user-2' })];
      const instance = buildInstance({
        flow,
        tasks,
        status: 'pending',
      });
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({ id: task.id, status: task.status }))
      );
      return instance;
    }

    it('驳回成功（instance → REJECTED, task → REJECTED, record created）', async () => {
      const instance = setupRejectInstance();
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      // 抢占当前 pending task（updateMany + status 守卫，命中 1 行）
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 实例置 REJECTED（updateMany + version CAS，命中 1 行）
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', rejectDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result).toEqual({ success: true, status: 'rejected' });
      // 任务抢占：updateMany 带 status:'pending' 守卫，data 置 rejected
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
          data: expect.objectContaining({ status: 'rejected' }),
        })
      );
      // 实例流转：updateMany 带 version CAS，data 置 rejected + version 自增
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: instance.version }),
          data: expect.objectContaining({
            status: 'rejected',
            version: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.approvalRecord.create).toHaveBeenCalled();
      expect(mockApprovalChangeRequests.validatePendingTargetSnapshot).toHaveBeenCalled();
      expect(mockApprovalChangeRequests.validatePendingTargetForApproval).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'form-1',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ flowStatus: 'rejected', version: { increment: 1 } }),
          select: { customerId: true, opportunityId: true },
        })
      );
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
        mockPrisma,
        {
          opportunityIds: ['opp-sale-order'],
          customerIds: ['cust-sale-order'],
        },
        { id: 'user-2', employeeId: 'emp-user-2' }
      );
    });

    it('拜访驳回与客户派生重算复用同一审批事务', async () => {
      const instance = {
        ...setupRejectInstance(),
        eventType: 'visit_approve',
        formId: 'visit-1',
      };
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockPrisma.visitRecord.update.mockResolvedValue({ customerId: 'cust-1' });
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await service.doApproval('inst-1', rejectDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith({
        where: {
          id: 'visit-1',
          version: 3,
          flowStatus: 'pending',
          deletedAt: null,
        },
        data: {
          flowStatus: 'rejected',
          version: { increment: 1 },
          updaterEmployeeId: 'emp-user-2',
        },
        select: { customerId: true },
      });
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-1', deletedAt: null } })
      );
    });

    it('invoice_approve 驳回先通过 Invoice 头 CAS，再清理 active Payment 两类反向引用', async () => {
      const instance = {
        ...setupRejectInstance(),
        eventType: 'invoice_approve',
        formId: 'inv-reject',
      };
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockPrisma.invoice.findUnique.mockResolvedValue({
        saleOrderId: 'so-1',
        invoiceAmount: '100',
        invoiceStatus: '正常',
      } as never);
      mockPrisma.invoice.update.mockResolvedValue({ saleOrderId: 'so-1' } as never);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.doApproval('inst-1', rejectDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'inv-reject',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ flowStatus: 'rejected', version: { increment: 1 } }),
        })
      );
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(1, {
        where: { invoicedByInvoiceId: 'inv-reject', deletedAt: null },
        data: expect.objectContaining({ invoicedByInvoiceId: null, version: { increment: 1 } }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, {
        where: { relatedInvoiceId: 'inv-reject', deletedAt: null },
        data: expect.objectContaining({ relatedInvoiceId: null, version: { increment: 1 } }),
      });
      expect(mockPrisma.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
        mockPrisma.payment.updateMany.mock.invocationCallOrder[0]!
      );
    });

    it('实例不存在 → NotFoundException', async () => {
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(null);

      await expect(
        service.doApproval('inst-x', rejectDto, { id: 'user-2', employeeId: 'emp-user-2' })
      ).rejects.toThrow(NotFoundException);
    });

    it('审批已结束 → BadRequestException', async () => {
      const instance = buildInstance({
        status: 'approved',
        flow: buildFlow(),
        tasks: [],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);

      await expect(
        service.doApproval('inst-1', rejectDto, { id: 'user-2', employeeId: 'emp-user-2' })
      ).rejects.toThrow(BadRequestException);
    });

    it('非审批人 → ForbiddenException', async () => {
      const tasks = [buildTask({ approverId: 'other-user' })];
      const instance = buildInstance({
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({ id: task.id, status: task.status }))
      );

      await expect(
        service.doApproval('inst-1', rejectDto, { id: 'user-2', employeeId: 'emp-user-2' })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // =========================================================================
  // doApproval - approve
  // =========================================================================

  describe('doApproval - approve', () => {
    const approveDto = { action: 'approve' as const, comment: '同意' };

    function setupPaymentFinalApproval() {
      const tasks = [buildTask({ id: 'task-1', approverId: 'user-2' })];
      const instance = buildInstance({
        eventType: 'payment_approve',
        formId: 'payment-1',
        totalNodes: 1,
        currentNode: 1,
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockPrisma.payment.findUnique.mockResolvedValue({
        saleOrderId: 'sale-order-1',
        paymentAmount: '100.00',
      });
      mockPrisma.payment.update.mockResolvedValue({ saleOrderId: 'sale-order-1' });
      mockOrderProductReceivableService.recalculateForPayment.mockResolvedValue({ updated: 0 });
    }

    it('or签 — 一人通过，其他 skipped', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'user-2', status: 'pending' }),
        buildTask({ id: 'task-2', approverId: 'user-3', status: 'pending' }),
      ];
      const instance = buildInstance({
        flow: buildFlow({
          nodes: [
            { id: 'node-1', flowId: 'flow-1', nodeName: '节点1', nodeOrder: 1, multiType: 'or' },
          ],
        }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      // 抢占当前 pending task → 命中 1 行（updateMany 同时承担抢占与 or 签 skip 两种调用）
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // lockCurrentNodeTasks 的 FOR UPDATE 重查：返回抢占后的实时态
      // （task-1 已被当前用户置 approved，task-2 仍 pending）
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result.status).toBe('approved');
      // or签：基于 $queryRaw 实时态，跳过当前节点其余 pending 任务（task-2）
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['task-2'] },
            status: 'pending',
            deletedAt: null,
          }),
          data: expect.objectContaining({
            status: 'skipped',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('and签 — 未全部通过（nodeComplete = false）', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'user-2', status: 'pending' }),
        buildTask({ id: 'task-2', approverId: 'user-3', status: 'pending' }),
      ];
      const instance = buildInstance({
        flow: buildFlow({
          nodes: [
            { id: 'node-1', flowId: 'flow-1', nodeName: '节点1', nodeOrder: 1, multiType: 'and' },
          ],
        }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      // 抢占当前 pending task → 命中 1 行
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 实时态：task-1 已被抢占置 approved，task-2 仍 pending → 会签未满足
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ]);
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      // 节点未完成，实例仍 pending
      expect(result.status).toBe('pending');
      // 不应推进实例状态（version CAS updateMany 不被调用）
      expect(mockPrisma.approvalInstance.updateMany).not.toHaveBeenCalled();
    });

    it('and签 — 全部通过', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'user-2', status: 'pending' }),
        buildTask({ id: 'task-2', approverId: 'user-3', status: 'approved' }),
      ];
      const instance = buildInstance({
        flow: buildFlow({
          nodes: [
            { id: 'node-1', flowId: 'flow-1', nodeName: '节点1', nodeOrder: 1, multiType: 'and' },
          ],
        }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      // 抢占当前用户的 task-1 → 命中 1 行
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 锁定后实时态：task-1 已被抢占置 approved，task-2 此前已 approved
      // → 会签全部 approved → 节点完成（关键：以 $queryRaw 实时态而非内存数组判断）
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'approved' },
      ]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result.status).toBe('approved');
      // 最后节点完成 → 实例置 approved（version CAS updateMany）
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: instance.version }),
          data: expect.objectContaining({
            status: 'approved',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('sequence模式 — 依次审批', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'user-2', status: 'pending', sequence: 1 }),
        buildTask({ id: 'task-2', approverId: 'user-3', status: 'pending', sequence: 2 }),
      ];
      const instance = buildInstance({
        flow: buildFlow({
          nodes: [
            {
              id: 'node-1',
              flowId: 'flow-1',
              nodeName: '节点1',
              nodeOrder: 1,
              multiType: 'sequence',
            },
          ],
        }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      // 抢占 sequence=1 的 task-1 → 命中 1 行
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 实时态：task-1 已 approved，task-2 仍 pending → 序列未走完，节点未完成
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: 'task-1', status: 'pending' },
        { id: 'task-2', status: 'pending' },
      ]);
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      // 还有 user-3 待审批，节点未完成
      expect(result.status).toBe('pending');
      expect(mockPrisma.approvalInstance.updateMany).not.toHaveBeenCalled();
    });

    it('sequence 前一位人工通过后，队首发起人自动通过并以 fresh-read 返回终态', async () => {
      const sequenceNode = {
        id: 'node-1',
        flowId: 'flow-1',
        nodeName: '节点1',
        nodeOrder: 1,
        multiType: 'sequence',
      };
      const tasks = [
        buildTask({ id: 'task-human', approverId: 'user-2', status: 'pending', sequence: 1 }),
        buildTask({ id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 2 }),
      ];
      const instance = buildInstance({
        totalNodes: 1,
        flow: buildFlow({ nodes: [sequenceNode] }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce({ ...instance, status: 'approved', tasks: [] });
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({
          id: task.id,
          status: task.status,
          approverId: task.approverId,
          sequence: task.sequence,
        }))
      );
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.findMany
        .mockResolvedValueOnce([
          { id: 'task-human', approverId: 'user-2', status: 'approved', sequence: 1 },
          { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 2 },
        ])
        .mockResolvedValueOnce([{ status: 'approved' }, { status: 'approved' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result.status).toBe('approved');
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['task-self'] },
            status: 'pending',
            deletedAt: null,
          }),
          data: expect.objectContaining({
            status: 'approved',
            actionTime: null,
            version: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.approvalInstance.findUnique).toHaveBeenCalledTimes(4);
    });

    it('多节点流转到下一节点', async () => {
      const node1 = {
        id: 'node-1',
        flowId: 'flow-1',
        nodeName: '节点1',
        nodeOrder: 1,
        multiType: 'or',
      };
      const node2 = {
        id: 'node-2',
        flowId: 'flow-1',
        nodeName: '节点2',
        nodeOrder: 2,
        multiType: 'or',
      };
      const tasks = [buildTask({ id: 'task-1', approverId: 'user-2', nodeOrder: 1 })];
      const instance = buildInstance({
        totalNodes: 2,
        flow: buildFlow({ nodes: [node1, node2] }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      mockApproverResolver.resolveApprovers.mockResolvedValue([
        buildApprover({ approverId: 'approver-2', approverName: '下一节点审批人' }),
      ]);
      // 抢占 task-1 → 命中 1 行
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 实时态：唯一 task-1 已 approved（or 节点，无其他 pending）→ 节点完成
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result.status).toBe('pending');
      // 流转下一节点：updateMany 带 version CAS，currentNode 推进到 2 + version 自增
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: instance.version }),
          data: expect.objectContaining({
            currentNode: 2,
            version: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.approvalTask.createMany).toHaveBeenCalled();
    });

    it('最后节点通过 → APPROVED', async () => {
      const tasks = [buildTask({ id: 'task-1', approverId: 'user-2' })];
      const instance = buildInstance({
        totalNodes: 1,
        currentNode: 1,
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      // 抢占 task-1 → 命中 1 行（旧 mock 误置 count:0 会导致抢占判定为并发冲突）
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 实时态：唯一 task-1 已 approved → or 节点完成
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result.status).toBe('approved');
      // 最后节点 → 实例置 approved（version CAS updateMany）
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: instance.version }),
          data: expect.objectContaining({
            status: 'approved',
            version: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'form-1',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ flowStatus: 'approved', version: { increment: 1 } }),
          select: { customerId: true, opportunityId: true },
        })
      );
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
        mockPrisma,
        {
          opportunityIds: ['opp-sale-order'],
          customerIds: ['cust-sale-order'],
        },
        { id: 'user-2', employeeId: 'emp-user-2' }
      );
    });

    it('回款终审在业务 flowStatus CAS 后同事务刷新产品应收缓存', async () => {
      setupPaymentFinalApproval();

      await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'payment-1',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
            legacyAdjustment: false,
          },
          data: expect.objectContaining({ flowStatus: 'approved' }),
        })
      );
      expect(mockOrderProductReceivableService.recalculateForPayment).toHaveBeenCalledWith(
        mockPrisma,
        'payment-1'
      );
      expect(mockPrisma.payment.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockOrderProductReceivableService.recalculateForPayment.mock.invocationCallOrder[0]!
      );
    });

    it('产品应收缓存刷新失败时拒绝审批事务且不写终态记录', async () => {
      setupPaymentFinalApproval();
      const cacheError = new Error('receivable cache refresh failed');
      mockOrderProductReceivableService.recalculateForPayment.mockRejectedValueOnce(cacheError);

      await expect(
        service.doApproval('inst-1', approveDto, {
          id: 'user-2',
          employeeId: 'emp-user-2',
        })
      ).rejects.toThrow(cacheError);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.approvalRecord.create).not.toHaveBeenCalled();
      expect(mockFinanceLedgerSync.syncFromPayment).not.toHaveBeenCalled();
    });

    it('拜访终审 approved 后在审批事务内成为完成事实', async () => {
      const tasks = [buildTask({ id: 'task-1', approverId: 'user-2' })];
      const instance = buildInstance({
        eventType: 'visit_approve',
        formId: 'visit-1',
        totalNodes: 1,
        currentNode: 1,
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockPrisma.visitRecord.update.mockResolvedValue({ customerId: 'cust-1' });
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      const result = await service.doApproval('inst-1', approveDto, {
        id: 'user-2',
        employeeId: 'emp-user-2',
      });

      expect(result.status).toBe('approved');
      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith({
        where: {
          id: 'visit-1',
          version: 3,
          flowStatus: 'pending',
          deletedAt: null,
        },
        data: {
          flowStatus: 'approved',
          version: { increment: 1 },
          updaterEmployeeId: 'emp-user-2',
        },
        select: { customerId: true },
      });
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-1', deletedAt: null } })
      );
    });

    it('sequence模式 — 未轮到 → ForbiddenException', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'user-2', status: 'pending', sequence: 1 }),
        buildTask({ id: 'task-2', approverId: 'user-3', status: 'pending', sequence: 2 }),
      ];
      const instance = buildInstance({
        flow: buildFlow({
          nodes: [
            {
              id: 'node-1',
              flowId: 'flow-1',
              nodeName: '节点1',
              nodeOrder: 1,
              multiType: 'sequence',
            },
          ],
        }),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({ id: task.id, status: task.status }))
      );

      await expect(
        service.doApproval('inst-1', approveDto, { id: 'user-3', employeeId: 'emp-user-3' })
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('审批事务锁序与并发漂移', () => {
    it('先锁 instance，再按固定顺序锁 tasks，随后强制 validator，最后才抢占 task', async () => {
      const instance = buildInstance({
        flow: buildFlow(),
        tasks: [buildTask({ id: 'task-1', approverId: 'user-2' })],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });

      await service.doApproval(
        'inst-1',
        { action: 'approve', comment: '同意' },
        { id: 'user-2', employeeId: 'emp-user-2' }
      );

      const [instanceLockOrder, taskLockOrder] = mockPrisma.$queryRaw.mock.invocationCallOrder;
      const validatorOrder = vi.mocked(lockAndValidatePendingApprovalTarget).mock
        .invocationCallOrder[0];
      const claimOrder = mockPrisma.approvalTask.updateMany.mock.invocationCallOrder[0];
      expect(instanceLockOrder).toBeLessThan(taskLockOrder!);
      expect(taskLockOrder).toBeLessThan(validatorOrder!);
      expect(validatorOrder).toBeLessThan(claimOrder!);
    });

    it('instance 在外层快照后发生 version/currentNode 漂移时返回 409 且不抢占 task', async () => {
      const snapshot = buildInstance({
        flow: buildFlow(),
        tasks: [buildTask({ id: 'task-1', approverId: 'user-2' })],
      });
      mockPrisma.approvalInstance.findUnique
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce({ ...snapshot, version: 2, currentNode: 2 });
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '审批人' });

      await expect(
        service.doApproval(
          'inst-1',
          { action: 'approve', comment: '同意' },
          { id: 'user-2', employeeId: 'emp-user-2' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.approvalTask.updateMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // withdraw
  // =========================================================================

  describe('withdraw', () => {
    it('撤回成功', async () => {
      const instance = buildInstance({
        tasks: [buildTask({ status: 'pending' })],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.withdraw(
        'inst-1',
        { id: 'user-1', employeeId: 'emp-user-1' },
        '撤回原因'
      );

      expect(result).toEqual({ success: true });
      const [instanceLockOrder, taskLockOrder] = mockPrisma.$queryRaw.mock.invocationCallOrder;
      expect(instanceLockOrder).toBeLessThan(taskLockOrder!);
      expect(taskLockOrder).toBeLessThan(
        mockPrisma.approvalTask.updateMany.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'inst-1',
            status: 'pending',
            deletedAt: null,
            version: instance.version,
            currentNode: instance.currentNode,
          },
          data: expect.objectContaining({
            status: 'withdrawn',
            version: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            instanceId: 'inst-1',
            nodeOrder: 1,
            status: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ status: 'skipped' }),
        })
      );
      expect(mockPrisma.approvalRecord.create).toHaveBeenCalled();
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'form-1',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ flowStatus: 'draft', version: { increment: 1 } }),
          select: { customerId: true, opportunityId: true },
        })
      );
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
        mockPrisma,
        {
          opportunityIds: ['opp-sale-order'],
          customerIds: ['cust-sale-order'],
        },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });

    it('invoice_approve 撤回先通过 Invoice 头 CAS，再清理 active Payment 两类反向引用', async () => {
      const instance = buildInstance({
        eventType: 'invoice_approve',
        formId: 'inv-withdraw',
        tasks: [buildTask({ status: 'pending' })],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockPrisma.invoice.update.mockResolvedValue({ saleOrderId: 'so-1' } as never);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await service.withdraw('inst-1', {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'inv-withdraw',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ flowStatus: 'draft', version: { increment: 1 } }),
        })
      );
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(1, {
        where: { invoicedByInvoiceId: 'inv-withdraw', deletedAt: null },
        data: expect.objectContaining({ invoicedByInvoiceId: null, version: { increment: 1 } }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, {
        where: { relatedInvoiceId: 'inv-withdraw', deletedAt: null },
        data: expect.objectContaining({ relatedInvoiceId: null, version: { increment: 1 } }),
      });
      expect(mockPrisma.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
        mockPrisma.payment.updateMany.mock.invocationCallOrder[0]!
      );
    });

    it('拜访撤回为 draft 后在同一事务回退客户完成事实', async () => {
      const instance = buildInstance({
        eventType: 'visit_approve',
        formId: 'visit-1',
        tasks: [buildTask({ status: 'pending' })],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'task-1', status: 'pending' }]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      mockPrisma.visitRecord.update.mockResolvedValue({ customerId: 'cust-1' });
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await service.withdraw('inst-1', {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith({
        where: {
          id: 'visit-1',
          version: 3,
          flowStatus: 'pending',
          deletedAt: null,
        },
        data: {
          flowStatus: 'draft',
          version: { increment: 1 },
          updaterEmployeeId: 'emp-user-1',
        },
        select: { customerId: true },
      });
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-1', deletedAt: null } })
      );
    });

    it('非发起人 → ForbiddenException', async () => {
      const instance = buildInstance({ tasks: [] });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);

      await expect(
        service.withdraw('inst-1', { id: 'other-user', employeeId: 'emp-other-user' })
      ).rejects.toThrow(ForbiddenException);
    });

    it('已结束 → BadRequestException', async () => {
      const instance = buildInstance({ status: 'approved', tasks: [] });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);

      await expect(
        service.withdraw('inst-1', { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(BadRequestException);
    });

    it('已流转到下一节点也允许发起人撤回', async () => {
      const instance = buildInstance({
        currentNode: 2,
        tasks: [buildTask({ status: 'approved' })],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.withdraw('inst-1', {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'withdrawn' }),
        })
      );
    });

    it('并发审批已推进时撤回返回 ConflictException 且不写审批记录', async () => {
      const instance = buildInstance({ tasks: [buildTask({ status: 'pending' })] });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.withdraw('inst-1', { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.approvalRecord.create).not.toHaveBeenCalled();
    });

    it('实例不存在 → NotFoundException', async () => {
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(null);

      await expect(
        service.withdraw('inst-x', { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // getPendingList
  // =========================================================================

  describe('getPendingList', () => {
    const query = { page: 1, pageSize: 10 };

    // 「待我审批」始终按 approverId 过滤——历史上对管理员放宽过滤会导致
    // 或签节点的同一 instance 在列表中重复出现（审批员甲 + 审批员乙 同为或签人时
    // 每条审批单都显示两次）。管理员看全部走 getAllApprovals。
    it('按 approverId 过滤（管理员也不放宽）', async () => {
      mockPrisma.approvalTask.findMany.mockResolvedValue([]);
      mockPrisma.approvalTask.count.mockResolvedValue(0);

      await service.getPendingList('user-1', query as never);

      expect(mockPrisma.approvalTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ approverId: 'user-1' }),
        })
      );
    });
  });

  // =========================================================================
  // getPendingCount
  // =========================================================================

  describe('getPendingCount', () => {
    it('返回待审批数量', async () => {
      mockPrisma.approvalTask.count.mockResolvedValue(5);

      const result = await service.getPendingCount('user-1');

      expect(result).toBe(5);
      expect(mockPrisma.approvalTask.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            approverId: 'user-1',
            status: 'pending',
          }),
        })
      );
    });
  });

  // =========================================================================
  // getCompletedList
  // =========================================================================

  describe('getCompletedList', () => {
    const query = { page: 1, pageSize: 10 };

    it('返回已审批列表', async () => {
      const completedTask = buildTask({ status: 'approved', actionTime: new Date() });
      mockPrisma.approvalTask.findMany.mockResolvedValue([completedTask]);
      mockPrisma.approvalTask.count.mockResolvedValue(1);

      const result = await service.getCompletedList('user-1', query as never);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.approvalTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            approverId: 'user-1',
            status: { in: ['approved', 'rejected'] },
          }),
        })
      );
    });
  });

  // =========================================================================
  // getCopyToList
  // =========================================================================

  describe('getCopyToList', () => {
    const query = { page: 1, pageSize: 10 };

    it('抄送列表 — copyToIds has userId', async () => {
      mockPrisma.approvalInstance.findMany.mockResolvedValue([]);
      mockPrisma.approvalInstance.count.mockResolvedValue(0);

      await service.getCopyToList('user-1', query as never);

      expect(mockPrisma.approvalInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            copyToIds: { has: 'user-1' },
          }),
        })
      );
    });
  });

  // =========================================================================
  // getInitiatedList
  // =========================================================================

  describe('getInitiatedList', () => {
    const query = { page: 1, pageSize: 10 };

    it('我发起的审批列表', async () => {
      mockPrisma.approvalInstance.findMany.mockResolvedValue([buildInstance()]);
      mockPrisma.approvalInstance.count.mockResolvedValue(1);

      const result = await service.getInitiatedList('user-1', query as never);

      expect(result.items).toHaveLength(1);
      expect(mockPrisma.approvalInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ initiatorId: 'user-1' }),
        })
      );
    });

    it('按 status 筛选', async () => {
      mockPrisma.approvalInstance.findMany.mockResolvedValue([]);
      mockPrisma.approvalInstance.count.mockResolvedValue(0);

      await service.getInitiatedList('user-1', {
        page: 1,
        pageSize: 10,
        status: 'approved',
      } as never);

      expect(mockPrisma.approvalInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'approved' }),
        })
      );
    });
  });

  // =========================================================================
  // getInstanceDetail
  // =========================================================================

  describe('getInstanceDetail', () => {
    const currentUser = { id: 'user-1' };

    it.each([
      ['发起人', { initiatorId: 'user-1' }],
      ['任务审批人', { tasks: { some: { approverId: 'user-1', deletedAt: null } } }],
      ['抄送人', { copyToIds: { has: 'user-1' } }],
    ])('非 ALL %s按三路身份查询详情', async (_identity, visibilityBranch) => {
      const instance = {
        ...buildInstance(),
        flow: { id: 'flow-1', name: '测试流程', code: 'FLOW001' },
        tasks: [buildTask()],
        records: [{ id: 'rec-1', action: 'submit', createdAt: new Date() }],
      };
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(instance);

      const result = await service.getInstanceDetail('inst-1', currentUser, false);

      expect(result).toBeDefined();
      expect(mockPrisma.approvalInstance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'inst-1',
            deletedAt: null,
            OR: expect.arrayContaining([visibilityBranch]),
          }),
          include: expect.objectContaining({
            tasks: expect.objectContaining({ where: { deletedAt: null } }),
            records: expect.anything(),
          }),
        })
      );
    });

    it('ALL 范围通过且不注入身份 OR', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(buildInstance());

      await service.getInstanceDetail('inst-1', currentUser, true);

      expect(mockPrisma.approvalInstance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inst-1', deletedAt: null } })
      );
    });

    it.each(['无关用户', '已软删除实例'])('%s查询无命中统一 404', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);

      await expect(service.getInstanceDetail('inst-x', currentUser, false)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  // =========================================================================
  // getByForm
  // =========================================================================

  describe('getByForm', () => {
    const currentUser = { id: 'user-1' };

    it('form lookup 注入与 ID 详情相同的三路可见性和软删除条件', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(buildInstance());

      const result = await service.getByForm('sale_order_activate', 'form-1', currentUser, false);

      expect(result).toBeDefined();
      expect(mockPrisma.approvalInstance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventType: 'sale_order_activate',
            formId: 'form-1',
            deletedAt: null,
            OR: [
              { initiatorId: 'user-1' },
              { tasks: { some: { approverId: 'user-1', deletedAt: null } } },
              { copyToIds: { has: 'user-1' } },
            ],
          },
        })
      );
    });

    it('form lookup 的 ALL 范围不注入身份 OR', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(buildInstance());

      await service.getByForm('sale_order_activate', 'form-1', currentUser, true);

      expect(mockPrisma.approvalInstance.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventType: 'sale_order_activate',
            formId: 'form-1',
            deletedAt: null,
          },
        })
      );
    });

    it.each(['无关用户', '已软删除实例', '表单不存在'])('%s统一 404', async () => {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);

      await expect(
        service.getByForm('sale_order_activate', 'nonexistent', currentUser, false)
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // getAllApprovals
  // =========================================================================

  describe('getAllApprovals', () => {
    it('全部列表', async () => {
      mockPrisma.approvalInstance.findMany.mockResolvedValue([buildInstance()]);
      mockPrisma.approvalInstance.count.mockResolvedValue(1);

      const result = await service.getAllApprovals({ page: 1, pageSize: 10 } as never);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('keyword 筛选（OR on title / code / initiatorName）', async () => {
      mockPrisma.approvalInstance.findMany.mockResolvedValue([]);
      mockPrisma.approvalInstance.count.mockResolvedValue(0);

      await service.getAllApprovals({ page: 1, pageSize: 10, keyword: '测试' } as never);

      expect(mockPrisma.approvalInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: '测试' } },
              { code: { contains: '测试' } },
              { initiatorName: { contains: '测试' } },
            ],
          }),
        })
      );
    });
  });

  // =========================================================================
  // doAdminApproval
  // =========================================================================

  describe('doAdminApproval', () => {
    it('管理员代审 — 通过', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'approver-1', status: 'pending', nodeOrder: 1 }),
      ];
      const instance = buildInstance({
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({ id: task.id, status: task.status }))
      );
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '管理员' });
      // 管理员通过：批量跳过当前节点所有 pending task（status 守卫）
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      // 最后节点 → 实例置 approved（version CAS updateMany，命中 1 行）
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doAdminApproval(
        'inst-1',
        { action: 'approve', comment: '管理员通过' },
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(result).toEqual({ success: true, status: 'approved' });
      // 任务批量跳过：updateMany 带 status:'pending' 守卫
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'pending' }),
          data: expect.objectContaining({ status: 'approved' }),
        })
      );
      // 实例置 approved：updateMany 带 version CAS
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: instance.version }),
          data: expect.objectContaining({
            status: 'approved',
            version: { increment: 1 },
          }),
        })
      );
      expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operatorName: '管理员（管理员代审）',
          }),
        })
      );
    });

    it('管理员代审推进到发起人节点后统一自动通过并 fresh-read 终态', async () => {
      const node1 = {
        id: 'node-1',
        flowId: 'flow-1',
        nodeName: '管理员代审节点',
        nodeOrder: 1,
        multiType: 'or',
      };
      const node2 = {
        id: 'node-2',
        flowId: 'flow-1',
        nodeName: '发起人节点',
        nodeOrder: 2,
        multiType: 'or',
      };
      const tasks = [
        buildTask({ id: 'task-admin', approverId: 'approver-1', status: 'pending', nodeOrder: 1 }),
      ];
      const instance = buildInstance({
        totalNodes: 2,
        flow: buildFlow({ nodes: [node1, node2] }),
        tasks,
      });
      const advancedInstance = {
        ...instance,
        currentNode: 2,
        version: 2,
        tasks: [
          buildTask({
            id: 'task-self-next',
            approverId: 'user-1',
            status: 'pending',
            nodeOrder: 2,
          }),
        ],
      };
      mockPrisma.approvalInstance.findUnique
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(advancedInstance)
        .mockResolvedValueOnce({ ...advancedInstance, status: 'approved', tasks: [] });
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({
          id: task.id,
          status: task.status,
          approverId: task.approverId,
          sequence: task.sequence,
        }))
      );
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '管理员' });
      mockApproverResolver.resolveApprovers.mockResolvedValue([
        buildApprover({ approverId: 'user-1', approverName: '发起人' }),
      ]);
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { id: 'task-self-next', approverId: 'user-1', status: 'pending', sequence: 1 },
      ]);
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doAdminApproval(
        'inst-1',
        { action: 'approve', comment: '管理员推进' },
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(result).toEqual({ success: true, status: 'approved' });
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['task-self-next'] },
            status: 'pending',
            deletedAt: null,
          }),
          data: expect.objectContaining({ status: 'approved', actionTime: null }),
        })
      );
      expect(mockPrisma.approvalInstance.findUnique).toHaveBeenCalledTimes(4);
    });

    it('管理员代审 — 驳回', async () => {
      const tasks = [
        buildTask({ id: 'task-1', approverId: 'approver-1', status: 'pending', nodeOrder: 1 }),
      ];
      const instance = buildInstance({
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
      mockPrisma.$queryRaw.mockResolvedValue(
        tasks.map((task) => ({ id: task.id, status: task.status }))
      );
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '管理员' });
      // 抢占 pending task（status 守卫，命中 1 行）+ 实例置 rejected（version CAS）
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalRecord.create.mockResolvedValue({});

      const result = await service.doAdminApproval(
        'inst-1',
        { action: 'reject', comment: '管理员驳回' },
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(result).toEqual({ success: true, status: 'rejected' });
      expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ version: instance.version }),
          data: expect.objectContaining({
            status: 'rejected',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('无待审批任务 → BadRequestException', async () => {
      const tasks = [buildTask({ id: 'task-1', status: 'approved', nodeOrder: 1 })];
      const instance = buildInstance({
        flow: buildFlow(),
        tasks,
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);

      await expect(
        service.doAdminApproval(
          'inst-1',
          { action: 'approve', comment: '' },
          { id: 'admin-1', employeeId: 'emp-admin-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('实例不存在 → NotFoundException', async () => {
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(null);

      await expect(
        service.doAdminApproval(
          'inst-x',
          { action: 'approve', comment: '' },
          { id: 'admin-1', employeeId: 'emp-admin-1' }
        )
      ).rejects.toThrow(NotFoundException);
    });

    it('审批已结束 → BadRequestException', async () => {
      const instance = buildInstance({
        status: 'approved',
        flow: buildFlow(),
        tasks: [],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);

      await expect(
        service.doAdminApproval(
          'inst-1',
          { action: 'approve', comment: '' },
          { id: 'admin-1', employeeId: 'emp-admin-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });
  });

  // =========================================================================
  // autoPassSelfTasksAndAdvance（申请人=审批人自动通过）
  // =========================================================================

  describe('autoPassSelfTasksAndAdvance', () => {
    const submitDto = {
      eventType: 'sale_order_activate' as const,
      formId: 'form-1',
      formCode: 'SO001',
      title: '测试审批',
      targetVersion: 3,
    };

    function setupSubmitWithNode(opts: {
      selfApproverId: string;
      multiType: 'or' | 'and' | 'sequence';
      tasks: { id: string; approverId: string; status: string; sequence: number }[];
      totalNodes?: number;
    }) {
      mockPrisma.approvalInstance.findFirst.mockResolvedValue(null);
      const node = {
        id: 'node-1',
        flowId: 'flow-1',
        nodeName: '节点1',
        nodeOrder: 1,
        multiType: opts.multiType,
      };
      const flow = buildFlow({ nodes: [node] });
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(flow);
      mockApproverResolver.getUserInfo.mockResolvedValue({ name: '发起人' });
      mockApproverResolver.validateNodeConfig.mockResolvedValue(true);
      mockApproverResolver.resolveApprovers.mockResolvedValue(
        opts.tasks.map((t) => buildApprover({ approverId: t.approverId, sequence: t.sequence }))
      );
      const createdInstance = buildInstance({
        currentNode: 1,
        totalNodes: opts.totalNodes ?? 1,
        flow,
      });
      mockPrisma.approvalInstance.create.mockResolvedValue(createdInstance);
      mockPrisma.approvalTask.createMany.mockResolvedValue({ count: opts.tasks.length });
      mockPrisma.approvalRecord.create.mockResolvedValue({});
      // autoPass 循环第 1 次：返回 pending 实例 + 节点配置；
      // 第 2 次（节点完成推进到 nextNode 后）：因 totalNodes=1 不会进入第 2 次；
      // 即便重复调，单节点场景在 instance.update 后 loop 立即终止。
      mockPrisma.approvalInstance.findUnique.mockResolvedValue({
        ...createdInstance,
        flow,
      });
      mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      return { node, flow, createdInstance };
    }

    it('CUSTOMER_TAG_CHANGE 末节点即使申请人=审批人也保留人工终审', async () => {
      const { createdInstance, flow } = setupSubmitWithNode({
        selfApproverId: 'user-1',
        multiType: 'or',
        tasks: [{ id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 }],
      });
      mockPrisma.approvalInstance.findUnique.mockResolvedValue({
        ...createdInstance,
        eventType: 'customer_tag_change',
        flow,
      });
      const customerTagSubmitDto = {
        ...submitDto,
        eventType: 'customer_tag_change' as const,
        formId: 'change-1',
      };

      const result = await service.createApprovalInstance(
        mockPrisma as never,
        customerTagSubmitDto,
        {
          id: 'user-1',
          employeeId: 'emp-user-1',
        }
      );

      // 末节点不自动通过，必须让人工审批提交 sideEffects.chargerId。
      expect(mockPrisma.approvalTask.updateMany).not.toHaveBeenCalled();
      const autoPassRecord = mockPrisma.approvalRecord.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { action: string } }).data.action === 'auto_pass'
      );
      expect(autoPassRecord).toBeUndefined();
      const finalUpdate = mockPrisma.approvalInstance.updateMany.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { status?: string } }).data?.status === 'approved'
      );
      expect(finalUpdate).toBeUndefined();
      expect(result.status).toBe('pending');
    });

    it('首节点 or 含发起人本人 → 本人 task 自动 approved + 写 auto_pass 记录 + 推到终态', async () => {
      setupSubmitWithNode({
        selfApproverId: 'user-1',
        multiType: 'or',
        tasks: [{ id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 }],
      });
      // autoPass 第 1 次 findMany 拉当前节点 tasks（覆盖通用默认 [] 兜底）
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 },
      ]);

      await service.createApprovalInstance(mockPrisma as never, submitDto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      // 本人那份 task → approved + actionTime=null
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['task-self'] },
            status: 'pending',
            deletedAt: null,
          }),
          data: expect.objectContaining({
            status: 'approved',
            actionTime: null,
            version: { increment: 1 },
          }),
        })
      );
      // 写一条 auto_pass record
      const autoPassRecord = mockPrisma.approvalRecord.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { action: string } }).data.action === 'auto_pass'
      );
      expect(autoPassRecord).toBeDefined();
      // 推到终态：instance.update status=approved
      const finalUpdate = mockPrisma.approvalInstance.updateMany.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { status?: string } }).data?.status === 'approved'
      );
      expect(finalUpdate).toBeDefined();
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'form-1',
            version: 3,
            flowStatus: 'pending',
            deletedAt: null,
          },
          data: expect.objectContaining({ flowStatus: 'approved' }),
        })
      );
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledTimes(1);
    });

    it('首节点 or 含本人 + 他人 → 本人 approved，他人 task → skipped', async () => {
      setupSubmitWithNode({
        selfApproverId: 'user-1',
        multiType: 'or',
        tasks: [
          { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 },
          { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 0 },
        ],
      });
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 },
        { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 0 },
      ]);

      await service.createApprovalInstance(mockPrisma as never, submitDto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      // 他人 task → skipped（updateMany 批量）
      const skippedCall = mockPrisma.approvalTask.updateMany.mock.calls.find((c: unknown[]) => {
        const arg = c[0] as { data: { status?: string }; where: { id?: { in?: string[] } } };
        return arg.data.status === 'skipped' && arg.where.id?.in?.includes('task-other');
      });
      expect(skippedCall).toBeDefined();
    });

    it('首节点 and 含本人 + 他人 → 仅本人 approved，他人 pending，节点未完成', async () => {
      setupSubmitWithNode({
        selfApproverId: 'user-1',
        multiType: 'and',
        tasks: [
          { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 },
          { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 0 },
        ],
      });
      // 第 1 次 findMany：autoPass 拉当前节点全量任务
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 },
        { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 0 },
      ]);
      // 第 2 次 findMany：autoPass 用于"会签是否全 approved"判定（本人刚 update 后，他人仍 pending）
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { status: 'approved' },
        { status: 'pending' },
      ]);

      await service.createApprovalInstance(mockPrisma as never, submitDto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      // 本人那份 → approved（updateMany id in [task-self]）
      const selfApprovedCall = mockPrisma.approvalTask.updateMany.mock.calls.find(
        (c: unknown[]) => {
          const arg = c[0] as { data: { status?: string }; where: { id?: { in?: string[] } } };
          return arg.data.status === 'approved' && arg.where.id?.in?.includes('task-self');
        }
      );
      expect(selfApprovedCall).toBeDefined();
      // 节点未完成 → 没有 instance.update status=approved
      const finalUpdate = mockPrisma.approvalInstance.updateMany.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { status?: string } }).data?.status === 'approved'
      );
      expect(finalUpdate).toBeUndefined();
    });

    it('首节点 sequence 队首=他人 → autoPass 不动作', async () => {
      setupSubmitWithNode({
        selfApproverId: 'user-1',
        multiType: 'sequence',
        tasks: [
          { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 1 },
          { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 2 },
        ],
      });
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 1 },
        { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 2 },
      ]);

      await service.createApprovalInstance(mockPrisma as never, submitDto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      // 队首是他人 → 不应 update 任何 task，也不应写 auto_pass record
      expect(mockPrisma.approvalTask.updateMany).not.toHaveBeenCalled();
      const autoPassRecord = mockPrisma.approvalRecord.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { action: string } }).data.action === 'auto_pass'
      );
      expect(autoPassRecord).toBeUndefined();
    });

    it('首节点 sequence 队首=本人 → 本人 task approved + 队列继续', async () => {
      setupSubmitWithNode({
        selfApproverId: 'user-1',
        multiType: 'sequence',
        tasks: [
          { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 1 },
          { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 2 },
        ],
      });
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 1 },
        { id: 'task-other', approverId: 'user-2', status: 'pending', sequence: 2 },
      ]);
      // 节点完成判定第 2 次 findMany：他人仍 pending → 节点未完成
      mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
        { status: 'approved' },
        { status: 'pending' },
      ]);

      await service.createApprovalInstance(mockPrisma as never, submitDto, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      // 本人那份 task → approved
      expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['task-self'] },
            status: 'pending',
            deletedAt: null,
          }),
          data: expect.objectContaining({
            status: 'approved',
            actionTime: null,
            version: { increment: 1 },
          }),
        })
      );
      // 节点未完成（他人仍在队伍）→ 不应推到终态
      const finalUpdate = mockPrisma.approvalInstance.updateMany.mock.calls.find(
        (c: unknown[]) => (c[0] as { data: { status?: string } }).data?.status === 'approved'
      );
      expect(finalUpdate).toBeUndefined();
    });
  });

  describe.each([['普通审批', 'assigned'] as const, ['管理员代审', 'admin'] as const])(
    '普通/管理员统一迁移引擎一致性：%s',
    (_label, operatorPolicy) => {
      const actor =
        operatorPolicy === 'admin'
          ? { id: 'admin-1', employeeId: 'emp-admin-1' }
          : { id: 'user-2', employeeId: 'emp-user-2' };

      function invoke(dto: { action: 'approve' | 'reject'; comment: string }) {
        return operatorPolicy === 'admin'
          ? service.doAdminApproval('inst-1', dto, actor)
          : service.doApproval('inst-1', dto, actor);
      }

      function setupSingleTaskInstance(overrides: Record<string, unknown> = {}) {
        const tasks = [buildTask({ id: 'task-1', approverId: 'user-2', sequence: 1 })];
        const instance = buildInstance({ tasks, flow: buildFlow(), ...overrides });
        mockPrisma.approvalInstance.findUnique.mockResolvedValue(instance);
        mockPrisma.$queryRaw.mockResolvedValue(
          tasks.map((task) => ({
            id: task.id,
            status: task.status,
            approverId: task.approverId,
            sequence: task.sequence,
          }))
        );
        mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.approvalRecord.create.mockResolvedValue({});
        mockApproverResolver.getUserInfo.mockResolvedValue({ name: '操作人' });
        return instance;
      }

      it.each([
        ['approve', 'approved'],
        ['reject', 'rejected'],
      ] as const)('%s 使用相同终态迁移与业务副作用入口', async (action, expectedStatus) => {
        setupSingleTaskInstance();

        const result = await invoke({ action, comment: '一致性测试' });

        expect(result.status).toBe(expectedStatus);
        expect(mockPrisma.saleOrder.update).toHaveBeenCalledTimes(1);
        expect(mockPrisma.approvalInstance.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: expectedStatus }),
          })
        );
      });

      it('sequence 队首通过使用同一锁序、CAS 与终态推进', async () => {
        const sequenceFlow = buildFlow({
          nodes: [
            {
              id: 'node-1',
              flowId: 'flow-1',
              nodeName: '顺序节点',
              nodeOrder: 1,
              multiType: 'sequence',
            },
          ],
        });
        setupSingleTaskInstance({ flow: sequenceFlow });

        const result = await invoke({ action: 'approve', comment: '顺序通过' });

        expect(result.status).toBe('approved');
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
        expect(mockPrisma.approvalTask.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: 'pending', deletedAt: null }),
            data: expect.objectContaining({ status: 'approved', version: { increment: 1 } }),
          })
        );
      });

      it('节点完成后使用同一下一节点创建与 pending 结果', async () => {
        const node1 = {
          id: 'node-1',
          flowId: 'flow-1',
          nodeName: '节点1',
          nodeOrder: 1,
          multiType: 'or',
        };
        const node2 = {
          id: 'node-2',
          flowId: 'flow-1',
          nodeName: '节点2',
          nodeOrder: 2,
          multiType: 'or',
        };
        const flow = buildFlow({ nodes: [node1, node2] });
        const tasks = [buildTask({ id: 'task-1', approverId: 'user-2' })];
        const snapshot = buildInstance({ flow, tasks, totalNodes: 2, currentNode: 1 });
        const progressed = buildInstance({
          flow,
          tasks: [],
          totalNodes: 2,
          currentNode: 2,
          version: 2,
        });
        mockPrisma.approvalInstance.findUnique
          .mockResolvedValueOnce(snapshot)
          .mockResolvedValueOnce(snapshot)
          .mockResolvedValueOnce(progressed)
          .mockResolvedValueOnce({
            status: 'pending',
            currentNode: 2,
            flow: { nodes: [{ nodeOrder: 2, multiType: 'or' }] },
            tasks: [{ approverId: 'user-4', nodeOrder: 2, sequence: 0, status: 'pending' }],
          });
        mockPrisma.$queryRaw.mockResolvedValue([
          { id: 'task-1', status: 'pending', approverId: 'user-2', sequence: 0 },
        ]);
        mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.approvalRecord.create.mockResolvedValue({});
        mockApproverResolver.getUserInfo.mockResolvedValue({ name: '操作人' });
        mockApproverResolver.resolveApprovers.mockResolvedValue([
          buildApprover({ approverId: 'user-4' }),
        ]);

        const result = await invoke({ action: 'approve', comment: '推进' });

        expect(result.status).toBe('pending');
        expect(mockPrisma.approvalTask.createMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: [expect.objectContaining({ nodeOrder: 2, approverId: 'user-4' })],
          })
        );
      });

      it('下一节点为发起人时使用同一自审批链并 fresh-read 终态', async () => {
        const node1 = {
          id: 'node-1',
          flowId: 'flow-1',
          nodeName: '节点1',
          nodeOrder: 1,
          multiType: 'or',
        };
        const node2 = {
          id: 'node-2',
          flowId: 'flow-1',
          nodeName: '自审批节点',
          nodeOrder: 2,
          multiType: 'or',
        };
        const flow = buildFlow({ nodes: [node1, node2] });
        const tasks = [buildTask({ id: 'task-1', approverId: 'user-2' })];
        const snapshot = buildInstance({ flow, tasks, totalNodes: 2, currentNode: 1 });
        const selfNodeInstance = buildInstance({
          flow,
          tasks: [],
          totalNodes: 2,
          currentNode: 2,
          version: 2,
        });
        mockPrisma.approvalInstance.findUnique
          .mockResolvedValueOnce(snapshot)
          .mockResolvedValueOnce(snapshot)
          .mockResolvedValueOnce(selfNodeInstance)
          .mockResolvedValueOnce({ status: 'approved', currentNode: 2, flow, tasks: [] });
        mockPrisma.$queryRaw.mockResolvedValue([
          { id: 'task-1', status: 'pending', approverId: 'user-2', sequence: 0 },
        ]);
        mockPrisma.approvalTask.findMany.mockResolvedValueOnce([
          { id: 'task-self', approverId: 'user-1', status: 'pending', sequence: 0 },
        ]);
        mockPrisma.approvalTask.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.approvalRecord.create.mockResolvedValue({});
        mockApproverResolver.getUserInfo.mockResolvedValue({ name: '操作人' });
        mockApproverResolver.resolveApprovers.mockResolvedValue([
          buildApprover({ approverId: 'user-1' }),
        ]);

        const result = await invoke({ action: 'approve', comment: '推进到本人' });

        expect(result.status).toBe('approved');
        expect(mockPrisma.approvalRecord.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ action: 'auto_pass', operatorId: 'user-1' }),
          })
        );
        expect(mockPrisma.saleOrder.update).toHaveBeenCalledTimes(1);
      });

      it('task CAS 并发冲突均回滚且不触发业务副作用', async () => {
        setupSingleTaskInstance();
        mockPrisma.approvalTask.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect(invoke({ action: 'approve', comment: '并发冲突' })).rejects.toThrow(
          ConflictException
        );

        expect(mockPrisma.approvalInstance.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
      });
    }
  );
});

describe('ApprovalsController — 详情数据范围透传', () => {
  const user = {
    id: 'user-1',
    username: 'user-1',
    roles: ['role-code-from-auth'],
    employeeId: 'user-1',
  };

  function createController(scope: string[] | null) {
    const approvalsService = Object.create(ApprovalsService.prototype) as ApprovalsService;
    vi.spyOn(approvalsService, 'getInstanceDetail').mockResolvedValue({} as never);
    vi.spyOn(approvalsService, 'getByForm').mockResolvedValue({} as never);

    const changeRequests = Object.create(
      ApprovalChangeRequestsService.prototype
    ) as ApprovalChangeRequestsService;
    vi.spyOn(changeRequests, 'findOneById').mockResolvedValue({} as never);

    const dataScope = Object.create(DataScopeService.prototype) as DataScopeService;
    vi.spyOn(dataScope, 'resolveChargerScope').mockResolvedValue(scope);

    const controller = new ApprovalsController(approvalsService, changeRequests, dataScope);
    return { controller, approvalsService, changeRequests, dataScope };
  }

  it('非 ALL 时三个详情入口均传当前用户和 false', async () => {
    const { controller, approvalsService, changeRequests, dataScope } = createController([
      'user-1',
    ]);

    await controller.getInstanceDetail('inst-1', user);
    await controller.getByForm('sale_order_activate', 'form-1', user);
    await controller.getChangeRequest('change-1', user);

    expect(dataScope.resolveChargerScope).toHaveBeenCalledTimes(3);
    expect(dataScope.resolveChargerScope).toHaveBeenCalledWith(
      user.id,
      user.roles,
      'approval',
      'approval_list',
      { employeeId: user.employeeId }
    );
    expect(approvalsService.getInstanceDetail).toHaveBeenCalledWith('inst-1', user, false);
    expect(approvalsService.getByForm).toHaveBeenCalledWith(
      'sale_order_activate',
      'form-1',
      user,
      false
    );
    expect(changeRequests.findOneById).toHaveBeenCalledWith('change-1', user.id, false);
  });

  it('数据范围 helper 返回 null 时透传 ALL=true', async () => {
    const { controller, approvalsService, changeRequests } = createController(null);

    await controller.getInstanceDetail('inst-1', user);
    await controller.getChangeRequest('change-1', user);

    expect(approvalsService.getInstanceDetail).toHaveBeenCalledWith('inst-1', user, true);
    expect(changeRequests.findOneById).toHaveBeenCalledWith('change-1', user.id, true);
  });
});
