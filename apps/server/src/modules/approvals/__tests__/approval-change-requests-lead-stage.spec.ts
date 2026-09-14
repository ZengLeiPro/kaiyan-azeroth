/**
 * leadStage 审批通过后的 write-once 守卫测试
 *
 * 防御的是 HubSpot 8 年来被吐槽的"Became MQL Date"陷阱：客户回归再升 MQL 时
 * 原始首次时间被覆盖、客户回退时该字段被直接清空——cohort 漏斗分析破产。
 *
 * 我们的保证：
 *  - 首次进入 MQL → firstMqlAt = now（同理 SQL）
 *  - 已有 firstMqlAt 时再次进入 MQL → 数据库 update.data 不含 firstMqlAt（永不覆盖）
 *  - 进入非 MQL/SQL 状态 → 不动 firstMqlAt/firstSqlAt
 */
// vi.mock 提到导入之前 —— 目的是把跨模块 helper 拦成 no-op，让 apply*Change 的
// 单元测试能只关注本文件内的分支控制（update.data 构造、白名单、审计写法），
// 不去关心销售订单/开票/回款金额聚合等其它模块的正确性。
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  const { Decimal } = await import('@prisma/client/runtime/library');
  return { ...actual, Prisma: { ...actual.Prisma, Decimal } };
});
vi.mock('../approval-target-validator.helper', () => ({
  lockAndValidateApprovalChangeTargetForApproval: vi.fn(
    async (
      _tx: unknown,
      input: { targetType: string; targetId: string; targetVersion: number }
    ) => ({
      targetType: input.targetType,
      where: {
        id: input.targetId,
        version: input.targetVersion,
        flowStatus: 'approved',
        deletedAt: null,
      },
    })
  ),
  lockAndValidateApprovalChangeTargetSnapshot: vi.fn(
    async (
      _tx: unknown,
      input: { targetType: string; targetId: string; targetVersion: number }
    ) => ({
      targetType: input.targetType,
      where: {
        id: input.targetId,
        version: input.targetVersion,
        flowStatus: 'approved',
        deletedAt: null,
      },
    })
  ),
}));
vi.mock('../../customers/customer-accounts-receivable.helper', () => ({
  recomputeCustomerAccountsReceivable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../customers/customer-lifecycle', () => ({
  recomputeCustomerLifecycle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/financial-limits.helper', () => ({
  lockSaleOrderFinancialMutations: vi.fn().mockResolvedValue(undefined),
  lockSaleOrderFinancialGraph: vi.fn().mockResolvedValue(undefined),
  assertInvoiceWithinOrderAmount: vi.fn().mockResolvedValue(undefined),
  assertPaymentWithinReceivables: vi.fn().mockResolvedValue(undefined),
  assertRefundWithinReceived: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/invoiced-summary.helper', () => ({
  recalcSaleOrderInvoicedSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/order-title.helper', () => ({
  resolveOrderTitle: vi.fn().mockResolvedValue('测试订单标题'),
}));
vi.mock('../../sale-orders/payment-summary.helper', () => ({
  recalcSaleOrderPaymentSummary: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../sale-orders/sale-order-activation-lifecycle.helper', () => ({
  reconcileSaleOrderActivationLifecycle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../projects/project-lifecycle.helper', () => ({
  advanceCustomDevelopmentProjectFromSaleOrder: vi.fn().mockResolvedValue(null),
  assertSaleOrderProjectRelationUnchanged: vi.fn().mockResolvedValue(undefined),
}));

import { recomputeCustomerLifecycle } from '../../customers/customer-lifecycle';
import {
  advanceCustomDevelopmentProjectFromSaleOrder,
  assertSaleOrderProjectRelationUnchanged,
} from '../../projects/project-lifecycle.helper';
import { lockSaleOrderFinancialGraph } from '../../sale-orders/financial-limits.helper';
import { recalcSaleOrderInvoicedSummary } from '../../sale-orders/invoiced-summary.helper';
import { recalcSaleOrderPaymentSummary } from '../../sale-orders/payment-summary.helper';
import { reconcileSaleOrderActivationLifecycle } from '../../sale-orders/sale-order-activation-lifecycle.helper';
import { ApprovalChangeRequestsService } from '../approval-change-requests.service';
import {
  lockAndValidateApprovalChangeTargetForApproval,
  lockAndValidateApprovalChangeTargetSnapshot,
} from '../approval-target-validator.helper';

function buildReceivableService() {
  return {
    recalculateForPayment: vi.fn().mockResolvedValue({ updated: 0 }),
  } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[2];
}

function buildTx() {
  return {
    approvalChangeRequest: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    customer: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    keepRecord: {
      create: vi.fn().mockResolvedValue({}),
    },
    employee: {
      findFirst: vi.fn().mockResolvedValue({ id: 'emp-sales', name: '承接销售' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    approvalNotificationOutbox: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function buildChange(overrides: Record<string, unknown> = {}) {
  return {
    id: 'change-1',
    eventType: 'customer_tag_change',
    status: 'pending',
    targetType: 'customer',
    targetId: 'cust-1',
    baseVersion: 1,
    version: 1,
    creatorEmployeeId: 'emp-tele',
    patch: { leadStage: 'MQL' },
    deletedAt: null,
    ...overrides,
  };
}

function buildExistingCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-1',
    customerName: '测试客户',
    version: 1,
    leadStage: null as string | null,
    firstMqlAt: null as Date | null,
    firstSqlAt: null as Date | null,
    ...overrides,
  };
}

const requiredCustomerTagSideEffects = { chargerId: 'emp-sales' };

describe('ApprovalChangeRequestsService — leadStage write-once 守卫', () => {
  let service: ApprovalChangeRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    // PrismaService 在 applyCustomerChange 路径上未直接用到（全部走 tx），可放空对象
    // financeLedgerSync 也未触达（leadStage 路径不涉及回款），mock 成 no-op
    const mockFinanceLedgerSync = {
      syncFromPayment: async () => {},
      revokeFromPayment: async () => {},
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      mockFinanceLedgerSync,
      buildReceivableService()
    );
  });

  it('首次从 NULL 升 MQL：firstMqlAt 被戳', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());
    tx.customer.findFirst.mockResolvedValue(buildExistingCustomer());

    const applied = await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      requiredCustomerTagSideEffects
    );

    expect(applied).toBe(true);
    expect(lockAndValidateApprovalChangeTargetForApproval).toHaveBeenCalled();
    expect(lockAndValidateApprovalChangeTargetSnapshot).not.toHaveBeenCalled();
    expect(tx.customer.update).toHaveBeenCalledTimes(1);
    const updateCall = tx.customer.update.mock.calls[0];
    if (!updateCall) throw new Error('expected customer.update to be called');
    const updateData = updateCall[0].data;
    expect(updateData.leadStage).toBe('MQL');
    expect(updateData.firstMqlAt).toBeInstanceOf(Date);
    expect(updateData.firstSqlAt).toBeUndefined();
  });

  it('已有 firstMqlAt 时再次升 MQL：firstMqlAt 不被覆盖', async () => {
    const tx = buildTx();
    const firstTime = new Date('2026-01-01T00:00:00Z');
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ leadStage: null, firstMqlAt: firstTime })
    );

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      {
        id: 'approver',
        employeeId: 'emp-approver',
      },
      requiredCustomerTagSideEffects
    );

    const updateCall = tx.customer.update.mock.calls[0];
    if (!updateCall) throw new Error('expected customer.update to be called');
    const updateData = updateCall[0].data;
    expect(updateData.leadStage).toBe('MQL');
    // 关键：data 里不应含 firstMqlAt 键（write-once，避免覆盖）
    expect(Object.prototype.hasOwnProperty.call(updateData, 'firstMqlAt')).toBe(false);
  });

  it('首次升 SQL：firstSqlAt 被戳，firstMqlAt 不受影响', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ patch: { leadStage: 'SQL' } })
    );
    tx.customer.findFirst.mockResolvedValue(buildExistingCustomer({ leadStage: 'MQL' }));

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      {
        id: 'approver',
        employeeId: 'emp-approver',
      },
      requiredCustomerTagSideEffects
    );

    const updateCall = tx.customer.update.mock.calls[0];
    if (!updateCall) throw new Error('expected customer.update to be called');
    const updateData = updateCall[0].data;
    expect(updateData.leadStage).toBe('SQL');
    expect(updateData.firstSqlAt).toBeInstanceOf(Date);
    expect(updateData.firstMqlAt).toBeUndefined();
  });

  it('回退到 NULL：firstMqlAt / firstSqlAt 都不被写', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ patch: { leadStage: null } })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({
        leadStage: 'SQL',
        firstSqlAt: new Date('2026-02-01'),
      })
    );

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      {
        id: 'approver',
        employeeId: 'emp-approver',
      },
      requiredCustomerTagSideEffects
    );

    const updateCall = tx.customer.update.mock.calls[0];
    if (!updateCall) throw new Error('expected customer.update to be called');
    const updateData = updateCall[0].data;
    expect(updateData.leadStage).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(updateData, 'firstMqlAt')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(updateData, 'firstSqlAt')).toBe(false);
  });

  it('审计人走 updater.connect，不写裸 FK 标量（防 Checked-input → Prisma 500 回归）', async () => {
    // 变更落地的 update.data 同时含 relation 操作（leadStageUpdatedBy.connect）→ Prisma 进入
    // Checked UpdateInput 分支，不接受裸 FK 标量 updaterEmployeeId（否则 PrismaClientValidationError
    // → 500）。本测试锁住所有 applyXxxChange 必须把审计人写成 updater.connect。
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());
    tx.customer.findFirst.mockResolvedValue(buildExistingCustomer());

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      {
        id: 'approver',
        employeeId: 'emp-approver',
      },
      requiredCustomerTagSideEffects
    );

    const updateCall = tx.customer.update.mock.calls[0];
    if (!updateCall) throw new Error('expected customer.update to be called');
    const updateData = updateCall[0].data;
    expect(Object.prototype.hasOwnProperty.call(updateData, 'updaterEmployeeId')).toBe(false);
    expect(updateData.updater).toEqual({ connect: { id: 'emp-approver' } });
  });
});

describe('ApprovalChangeRequestsService — 通用审批变更控制流', () => {
  let service: ApprovalChangeRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockFinanceLedgerSync = {
      syncFromPayment: async () => {},
      revokeFromPayment: async () => {},
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      mockFinanceLedgerSync,
      buildReceivableService()
    );
  });

  it('findOneById 找不到变更申请时抛 NotFound', async () => {
    const prisma = {
      approvalChangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0];
    service = new ApprovalChangeRequestsService(
      prisma,
      {
        syncFromPayment: async () => {},
        revokeFromPayment: async () => {},
      } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1],
      buildReceivableService()
    );

    await expect(service.findOneById('missing', 'viewer-1', false)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('findOneById 通过关联 approvalInstance 应用发起人/审批人/抄送人可见性', async () => {
    const findFirst = vi.fn().mockResolvedValue(buildChange());
    const prisma = {
      approvalChangeRequest: { findFirst },
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0];
    service = new ApprovalChangeRequestsService(
      prisma,
      {
        syncFromPayment: async () => {},
        revokeFromPayment: async () => {},
      } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1],
      buildReceivableService()
    );

    await expect(service.findOneById('change-1', 'viewer-1', false)).resolves.toBeDefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'change-1',
        deletedAt: null,
        approvalInstance: {
          is: {
            deletedAt: null,
            OR: [
              { initiatorId: 'viewer-1' },
              { tasks: { some: { approverId: 'viewer-1', deletedAt: null } } },
              { copyToIds: { has: 'viewer-1' } },
            ],
          },
        },
      },
    });
  });

  it('findOneById 的 ALL 范围仍限制变更申请和关联审批实例未删除', async () => {
    const findFirst = vi.fn().mockResolvedValue(buildChange());
    const prisma = {
      approvalChangeRequest: { findFirst },
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0];
    service = new ApprovalChangeRequestsService(
      prisma,
      {
        syncFromPayment: async () => {},
        revokeFromPayment: async () => {},
      } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1],
      buildReceivableService()
    );

    await service.findOneById('change-1', 'viewer-1', true);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'change-1',
        deletedAt: null,
        approvalInstance: { is: { deletedAt: null } },
      },
    });
  });

  it.each(['无关用户', '变更申请已删除', '关联审批实例已删除'])(
    'findOneById 对%s统一 404',
    async () => {
      const prisma = {
        approvalChangeRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0];
      service = new ApprovalChangeRequestsService(
        prisma,
        {
          syncFromPayment: async () => {},
          revokeFromPayment: async () => {},
        } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1],
        buildReceivableService()
      );

      await expect(service.findOneById('change-1', 'viewer-1', false)).rejects.toMatchObject({
        status: 404,
      });
    }
  );

  it('handleApprovalResult 对不存在或非 pending 的申请返回 false，不写完成状态', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(null);

    await expect(
      service.handleApprovalResult(
        tx as never,
        'customer_tag_change',
        'change-missing',
        1,
        'approved',
        {
          id: 'approver',
          employeeId: 'emp-approver',
        }
      )
    ).resolves.toBe(false);

    expect(tx.approvalChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('handleApprovalResult 拒绝陈旧 ApprovalInstance.targetVersion 且不落地终态', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange({ baseVersion: 2 }));

    await expect(
      service.handleApprovalResult(
        tx as never,
        'customer_tag_change',
        'change-1',
        1,
        'approved',
        { id: 'approver', employeeId: 'emp-approver' },
        requiredCustomerTagSideEffects
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.approvalChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('handleApprovalResult 驳回时只更新申请状态，不落地 patch', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());

    await expect(
      service.handleApprovalResult(tx as never, 'customer_tag_change', 'change-1', 1, 'rejected', {
        id: 'approver',
        employeeId: 'emp-approver',
      })
    ).resolves.toBe(true);

    expect(lockAndValidateApprovalChangeTargetSnapshot).toHaveBeenCalled();
    expect(lockAndValidateApprovalChangeTargetForApproval).not.toHaveBeenCalled();
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.approvalChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'change-1',
          version: 1,
          status: 'pending',
          deletedAt: null,
        },
        data: expect.objectContaining({
          status: 'rejected',
          completedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      })
    );
  });

  it('handleWithdraw 将 pending 申请标记为 withdrawn', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());

    await expect(
      service.handleWithdraw(tx as never, 'customer_tag_change', 'change-1', 1, {
        id: 'operator',
        employeeId: 'emp-operator',
      })
    ).resolves.toBe(true);

    expect(lockAndValidateApprovalChangeTargetSnapshot).toHaveBeenCalled();
    expect(lockAndValidateApprovalChangeTargetForApproval).not.toHaveBeenCalled();
    expect(tx.approvalChangeRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'change-1',
          version: 1,
          status: 'pending',
          deletedAt: null,
        },
        data: expect.objectContaining({
          status: 'withdrawn',
          completedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      })
    );
  });

  it('handleApprovalResult 对未知 targetType 抛业务错误，不吞掉错误', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ targetType: 'unknown_target_type' })
    );

    await expect(
      service.handleApprovalResult(tx as never, 'customer_tag_change', 'change-1', 1, 'approved', {
        id: 'approver',
        employeeId: 'emp-approver',
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.approvalChangeRequest.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * 审批通过时附带 CUSTOMER_TAG_CHANGE sideEffects
 *
 * 业务：SDR 提 MQL/SQL 审批，终审指定承接销售；通过后客户负责人同步，
 * 并把发起电销挂进"协作人"。旧版 addCollaboratorIds 仍需兼容。
 * 后端必须：
 *  - 与 leadStage 合并到同一次 customer.update（避免二次 version 冲突）
 *  - union 去重（已是协作人的 id 不重复写、不清零）
 *  - KeepRecord 内容留下承接销售与协作人变更
 *  - 驳回时忽略 sideEffects（不脏改客户）
 */
describe('ApprovalChangeRequestsService — customer sideEffects', () => {
  let service: ApprovalChangeRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockFinanceLedgerSync = {
      syncFromPayment: async () => {},
      revokeFromPayment: async () => {},
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      mockFinanceLedgerSync,
      buildReceivableService()
    );
  });

  it('终审指定承接销售：同步负责人并自动追加发起电销为协作人', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ chargerId: 'emp-old', collaboratorIds: [] })
    );
    tx.employee.findFirst.mockResolvedValue({
      id: 'emp-sales',
      name: '承接销售',
    });
    tx.employee.findMany.mockResolvedValue([{ id: 'emp-tele', name: '电销同事' }]);

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      { chargerId: 'emp-sales' }
    );

    expect(tx.customer.update).toHaveBeenCalledTimes(1);
    const updateData = tx.customer.update.mock.calls[0]![0].data;
    expect(updateData.charger).toEqual({ connect: { id: 'emp-sales' } });
    expect(updateData.chargerName).toBeNull();
    expect(updateData.collaboratorIds).toEqual(['emp-tele']);
    expect(updateData.collaboratorName).toBeNull();

    const kr = tx.keepRecord.create.mock.calls[0]![0].data;
    expect(kr.keepRecordContent).toContain('承接销售：承接销售');
    expect(kr.keepRecordContent).toContain('电销人员一并新增协作人：电销同事');
  });

  it('审批事务内把已确认承接人和客户快照写入 durable outbox', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ approvalInstanceId: 'instance-1' })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ customerName: '快照客户', collaboratorIds: [] })
    );

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      { chargerId: 'emp-sales' }
    );

    expect(tx.approvalNotificationOutbox.create).toHaveBeenCalledWith({
      data: {
        dedupKey: 'lead-assignment:instance-1',
        eventType: 'lead_assignment',
        recipientEmployeeId: 'emp-sales',
        payload: {
          instanceId: 'instance-1',
          customerId: 'cust-1',
          customerName: '快照客户',
          leadStage: 'MQL',
        },
      },
    });
  });

  it('新负责人原本已是协作人：通过时先从协作人列表剔除负责人', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ creatorEmployeeId: 'emp-sales' })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ collaboratorIds: ['emp-existing', 'emp-sales'] })
    );

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      { chargerId: 'emp-sales' }
    );

    const updateData = tx.customer.update.mock.calls[0]![0].data;
    expect(updateData.collaboratorIds).toEqual(['emp-existing']);
    expect(updateData.collaboratorName).toBeNull();
    expect(tx.employee.findMany).not.toHaveBeenCalled();
  });

  it('直接通过未指定承接销售：服务端拒绝且不查询或更新客户', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());

    await expect(
      service.handleApprovalResult(tx as never, 'customer_tag_change', 'change-1', 1, 'approved', {
        id: 'approver',
        employeeId: 'emp-approver',
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('指定承接销售不存在时拒绝落地客户变更', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());
    tx.customer.findFirst.mockResolvedValue(buildExistingCustomer());
    tx.employee.findFirst.mockResolvedValue(null);

    await expect(
      service.handleApprovalResult(
        tx as never,
        'customer_tag_change',
        'change-1',
        1,
        'approved',
        { id: 'approver', employeeId: 'emp-approver' },
        { chargerId: 'missing-sales' }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('通过时追加协作人：与 leadStage 合并到同一次 update.data.collaboratorIds', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ creatorEmployeeId: 'emp-sales' })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ collaboratorIds: ['emp-existing'] })
    );
    tx.employee.findMany.mockResolvedValue([{ id: 'emp-sales-a', name: '吴销售' }]);

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      { chargerId: 'emp-sales', addCollaboratorIds: ['emp-sales-a'] }
    );

    // 只有一次 update 调用（未产生二次 version 冲突）
    expect(tx.customer.update).toHaveBeenCalledTimes(1);
    const updateData = tx.customer.update.mock.calls[0]![0].data;
    // collaboratorIds = existing ∪ added
    expect(updateData.collaboratorIds).toEqual(['emp-existing', 'emp-sales-a']);
    // leadStage 逻辑不受影响
    expect(updateData.leadStage).toBe('MQL');

    // KeepRecord content 追加了协作人名（用 employee.findMany 拉的 name）
    expect(tx.keepRecord.create).toHaveBeenCalledTimes(1);
    const kr = tx.keepRecord.create.mock.calls[0]![0].data;
    expect(kr.keepRecordContent).toContain('审批人一并新增协作人：吴销售');
  });

  it('union 去重：addCollaboratorIds 里已是协作人的 id 被过滤掉', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ creatorEmployeeId: 'emp-sales' })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({
        collaboratorIds: ['emp-existing', 'emp-sales-a'],
      })
    );
    tx.employee.findMany.mockResolvedValue([{ id: 'emp-sales-b', name: '郑销售' }]);

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      {
        chargerId: 'emp-sales',
        addCollaboratorIds: ['emp-sales-a', 'emp-sales-b'],
      }
    );

    const updateData = tx.customer.update.mock.calls[0]![0].data;
    // emp-sales-a 已存在被跳过，只加 emp-sales-b
    expect(updateData.collaboratorIds).toEqual(['emp-existing', 'emp-sales-a', 'emp-sales-b']);
    // employee.findMany 只查真正新增的那部分
    expect(tx.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['emp-sales-b'] } } })
    );
    // KeepRecord 只展示真正新增的人名
    const kr = tx.keepRecord.create.mock.calls[0]![0].data;
    expect(kr.keepRecordContent).toContain('审批人一并新增协作人：郑销售');
    expect(kr.keepRecordContent).not.toContain('吴销售'); // 已是协作人不重复展示
  });

  it('仅指定承接销售时不追加额外协作人：collaboratorIds 键完全不出现', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ creatorEmployeeId: 'emp-sales' })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ collaboratorIds: ['emp-existing'] })
    );

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      {
        id: 'approver',
        employeeId: 'emp-approver',
      },
      { chargerId: 'emp-sales' }
    );

    const updateData = tx.customer.update.mock.calls[0]![0].data;
    // 关键：没有新增协作人时不能把 collaboratorIds 键塞进 data（避免无谓 JSONB 写）
    expect(Object.prototype.hasOwnProperty.call(updateData, 'collaboratorIds')).toBe(false);
    // 也不会去查 employee.findMany（承接销售只需 findFirst 校验）
    expect(tx.employee.findMany).not.toHaveBeenCalled();
  });

  it('addCollaboratorIds 全部已是协作人：不写 collaboratorIds、不查 employee', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(
      buildChange({ creatorEmployeeId: 'emp-sales' })
    );
    tx.customer.findFirst.mockResolvedValue(
      buildExistingCustomer({ collaboratorIds: ['emp-sales-a'] })
    );

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'approved',
      { id: 'approver', employeeId: 'emp-approver' },
      { chargerId: 'emp-sales', addCollaboratorIds: ['emp-sales-a'] }
    );

    const updateData = tx.customer.update.mock.calls[0]![0].data;
    expect(Object.prototype.hasOwnProperty.call(updateData, 'collaboratorIds')).toBe(false);
    expect(tx.employee.findMany).not.toHaveBeenCalled();
    // KeepRecord 仍然写（leadStage 有变化），但不带协作人行
    const kr = tx.keepRecord.create.mock.calls[0]![0].data;
    expect(kr.keepRecordContent).not.toContain('审批人一并新增协作人');
  });

  it('驳回：即使传了 addCollaboratorIds 也不落地任何客户改动', async () => {
    const tx = buildTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue(buildChange());

    await service.handleApprovalResult(
      tx as never,
      'customer_tag_change',
      'change-1',
      1,
      'rejected',
      { id: 'approver', employeeId: 'emp-approver' },
      { addCollaboratorIds: ['emp-sales-a'] }
    );

    // 驳回分支根本不走 applyApprovedChange
    expect(tx.customer.findFirst).not.toHaveBeenCalled();
    expect(tx.customer.update).not.toHaveBeenCalled();
    expect(tx.employee.findMany).not.toHaveBeenCalled();
    expect(tx.keepRecord.create).not.toHaveBeenCalled();
  });
});

/**
 * 其它 targetType 的 apply*Change happy-path 覆盖
 *
 * 目的：为 saleOrder/invoice/payment/visitRecord 四个 handler 各补最小走通用例，
 * 顺带把内部的 patch 解析（stringFromPatch/nullableStringFromPatch/dateOrNull 等）
 * 和 audit 走 relation 的 Checked-input 分支带过。跨模块 helper 已在文件顶部
 * vi.mock 拦为 no-op（金额校验/聚合/CRM AR 重算等不属于本文件的职责）。
 */
function buildFullTx() {
  return {
    approvalChangeRequest: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    saleOrder: {
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    orderProduct: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    opportunity: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
    },
    invoice: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    payment: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn().mockResolvedValue(0),
    },
    paymentItem: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    projectSaleOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    projectTicket: {
      count: vi.fn().mockResolvedValue(0),
    },
    effortRecord: {
      count: vi.fn().mockResolvedValue(0),
    },
    financeLedger: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    visitRecord: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    customer: {
      findFirst: vi.fn().mockResolvedValue({ id: 'cust-visible' }),
      update: vi.fn().mockResolvedValue({}),
    },
    keepRecord: {
      create: vi.fn().mockResolvedValue({}),
    },
    employee: {
      findFirst: vi.fn().mockResolvedValue({ id: 'emp-visible' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    rolePermission: {
      findMany: vi.fn().mockResolvedValue([{ viewScope: 'ALL' }]),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
}

describe('ApprovalChangeRequestsService — applySaleOrderChange happy path', () => {
  let service: ApprovalChangeRequestsService;
  const revokeFromPaymentMock = vi.fn().mockResolvedValue(undefined);
  const recalculateForPaymentMock = vi.fn().mockResolvedValue({ updated: 0 });
  const recalculateBatchMock = vi.fn().mockResolvedValue({ updated: 0 });
  const financeLedgerSync = {
    syncFromPayment: vi.fn().mockResolvedValue(undefined),
    revokeFromPayment: revokeFromPaymentMock,
  } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
  const receivableService = {
    recalculateForPayment: recalculateForPaymentMock,
    recalculateBatch: recalculateBatchMock,
  } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[2];

  beforeEach(() => {
    vi.clearAllMocks();
    revokeFromPaymentMock.mockClear();
    recalculateForPaymentMock.mockClear();
    recalculateBatchMock.mockClear();
    vi.mocked(advanceCustomDevelopmentProjectFromSaleOrder).mockClear();
    vi.mocked(assertSaleOrderProjectRelationUnchanged).mockClear();
    vi.mocked(reconcileSaleOrderActivationLifecycle).mockClear();
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      financeLedgerSync,
      receivableService
    );
  });

  it('订单金额+备注变更：走通 update；审计走 updater.connect', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-1',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-1',
      baseVersion: 3,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { orderAmount: '20000', remark: '客户降价' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      version: 3,
      customerId: 'cust-9',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '18000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
    });
    tx.saleOrder.update.mockResolvedValue({ id: 'so-1', customerId: 'cust-9' });

    await service.handleApprovalResult(
      tx as never,
      'sale_order_change',
      'chg-so-1',
      3,
      'approved',
      {
        id: 'admin',
        employeeId: 'emp-admin',
      }
    );

    expect(tx.saleOrder.update).toHaveBeenCalledTimes(1);
    const data = tx.saleOrder.update.mock.calls[0]![0].data;
    expect(data.orderAmount).toBe('20000');
    expect(data.remark).toBe('客户降价');
    expect(data.updater).toEqual({ connect: { id: 'emp-admin' } });
    // orderTitle 由 mock 的 resolveOrderTitle 返回，说明标题拼接分支走了
    expect(data.orderTitle).toBe('测试订单标题');
    expect(Object.prototype.hasOwnProperty.call(data, 'updaterEmployeeId')).toBe(false);
    expect(advanceCustomDevelopmentProjectFromSaleOrder).toHaveBeenCalledWith(
      tx,
      'so-1',
      '合同中',
      { id: 'admin', employeeId: 'emp-admin' },
      { createIfMissing: false }
    );
  });

  it.each([
    ['remark', { remark: '普通备注' }],
    ['amount', { orderAmount: '20000' }],
    [
      'products',
      {
        products: [
          {
            productName: '钉钉专业版',
            quantity: 1,
            unitPrice: 100,
            contractUnitPrice: 90,
          },
        ],
      },
    ],
  ])('历史多订单下普通 %s change apply 不跑 uniqueness 且仍可写入', async (_label, patch) => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-history',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-history',
      baseVersion: 7,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch,
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-history',
      version: 7,
      customerId: 'cust-history',
      opportunityId: 'opp-history',
      chargerId: 'emp-owner',
      orderAmount: '18000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
      products: [],
    });
    tx.opportunity.findFirst.mockResolvedValue({ id: 'opp-history' });
    tx.saleOrder.update.mockResolvedValue({
      id: 'so-history',
      customerId: 'cust-history',
      opportunityId: 'opp-history',
    });

    await service.handleApprovalResult(
      tx as never,
      'sale_order_change',
      'chg-history',
      7,
      'approved',
      { id: 'admin', employeeId: 'emp-admin' }
    );

    expect(tx.opportunity.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.saleOrder.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.saleOrder.update).toHaveBeenCalledTimes(1);
    expect(reconcileSaleOrderActivationLifecycle).not.toHaveBeenCalled();
  });

  it.each([
    ['最终客户已删除或超出发起人范围', 'customer'],
    ['最终负责人已删除或超出发起人范围', 'charger'],
    ['最终商机已删除、越权或客户关系漂移', 'opportunity'],
  ])('审批落地二次校验 fail-closed：%s', async (_label, missingRef) => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-final-refs',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-final-refs',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        customerId: 'cust-final',
        chargerId: 'emp-final',
        opportunityId: 'opp-final',
      },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-final-refs',
      version: 1,
      customerId: 'cust-old',
      opportunityId: 'opp-old',
      chargerId: 'emp-old',
      orderAmount: '1000',
      createdAt: new Date('2026-01-01'),
      totalReceived: '0',
      products: [],
    });
    tx.rolePermission.findMany.mockResolvedValue([]);
    tx.customer.findFirst.mockResolvedValue(
      missingRef === 'customer' ? null : { id: 'cust-final' }
    );
    tx.employee.findFirst
      .mockResolvedValueOnce({ id: 'emp-owner' })
      .mockResolvedValueOnce(missingRef === 'charger' ? null : { id: 'emp-final' });
    tx.opportunity.findFirst.mockResolvedValue(
      missingRef === 'opportunity' ? null : { id: 'opp-final' }
    );

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-final-refs',
        1,
        'approved',
        {
          id: 'admin',
          employeeId: 'emp-admin',
        }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ module: 'crm', menu: 'sale_orders' }),
      })
    );
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('订单审批变更改绑后同 tx 统一回退旧商机、推进新商机并重算新旧客户', async () => {
    const tx = buildFullTx();
    const existing = {
      id: 'so-rebind',
      version: 3,
      customerId: 'cust-old',
      opportunityId: 'opp-old',
      chargerId: 'emp-owner',
      orderAmount: '18000',
      createdAt: new Date('2026-05-01'),
      orderBeginDate: new Date('2026-05-01T00:00:00.000Z'),
      orderEndDate: new Date('2026-12-31T00:00:00.000Z'),
      totalReceived: '0',
      products: [],
    };
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-rebind',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-rebind',
      baseVersion: 3,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { customerId: 'cust-new', opportunityId: 'opp-new' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    tx.opportunity.findFirst.mockResolvedValue({ customerId: 'cust-new' });
    tx.saleOrder.update.mockResolvedValue({
      ...existing,
      customerId: 'cust-new',
      opportunityId: 'opp-new',
      version: 4,
    });

    await service.handleApprovalResult(
      tx as never,
      'sale_order_change',
      'chg-rebind',
      3,
      'approved',
      {
        id: 'admin',
        employeeId: 'emp-admin',
      }
    );

    const lastAdvisoryLock = tx.$executeRaw.mock.invocationCallOrder.at(-1)!;
    const postLockOpportunityRead = tx.opportunity.findFirst.mock.invocationCallOrder[0]!;
    const uniquenessRead = tx.saleOrder.findFirst.mock.invocationCallOrder[1]!;
    expect(lastAdvisoryLock).toBeLessThan(postLockOpportunityRead);
    expect(postLockOpportunityRead).toBeLessThan(uniquenessRead);
    expect(uniquenessRead).toBeLessThan(tx.saleOrder.update.mock.invocationCallOrder[0]!);
    expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
      tx,
      {
        opportunityIds: ['opp-old', 'opp-new'],
        customerIds: ['cust-old', 'cust-new'],
        retractedOpportunityIds: ['opp-old'],
      },
      { id: 'admin', employeeId: 'emp-admin' }
    );
    expect(advanceCustomDevelopmentProjectFromSaleOrder).toHaveBeenCalledWith(
      tx,
      'so-rebind',
      '合同中',
      { id: 'admin', employeeId: 'emp-admin' },
      { createIfMissing: false }
    );
  });

  it.each([
    ['begin-only', { orderBeginDate: '2026-06-01' }],
    ['end-only', { orderEndDate: '2026-04-30' }],
  ])('审批落地二次校验拒绝 %s 倒置最终区间', async (_label, patch) => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-date',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-date',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch,
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-date',
      version: 1,
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '1000',
      createdAt: new Date('2026-05-01'),
      orderBeginDate: new Date('2026-05-01T00:00:00.000Z'),
      orderEndDate: new Date('2026-05-31T00:00:00.000Z'),
      totalReceived: '0',
      products: [],
    });

    await expect(
      service.handleApprovalResult(tx as never, 'sale_order_change', 'chg-date', 1, 'approved', {
        id: 'admin',
        employeeId: 'emp-admin',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('审批落地二次校验拒绝持久 patch 绕过的非法日历日', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-invalid-date',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-date',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { orderEndDate: '2026-02-31' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-date',
      version: 1,
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '1000',
      createdAt: new Date('2026-01-01'),
      orderBeginDate: new Date('2026-01-01T00:00:00.000Z'),
      orderEndDate: new Date('2026-12-31T00:00:00.000Z'),
      totalReceived: '0',
      products: [],
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-invalid-date',
        1,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toThrow('合同结束日期必须是有效的 YYYY-MM-DD 日历日期');
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('baseVersion 与当前不一致：抛 ConflictException 且不 update', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-2',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-2',
      baseVersion: 3,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { orderAmount: '20000' },
      deletedAt: null,
    });
    // 订单版本已被抬到 5，与 baseVersion=3 冲突
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-2',
      version: 5,
      customerId: 'cust-9',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '18000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
    });

    await expect(
      service.handleApprovalResult(tx as never, 'sale_order_change', 'chg-so-2', 3, 'approved', {
        id: 'admin',
        employeeId: 'emp-admin',
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('历史 pending 订单变更审批通过后落地 patch 并恢复订单 approved', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-legacy-so',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-legacy',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { remark: '历史变更已批准' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-legacy',
      version: 2,
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '10000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
      products: [],
    });
    tx.saleOrder.update.mockResolvedValue({ id: 'so-legacy', customerId: 'cust-1' });
    vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mockResolvedValueOnce({
      targetType: 'sale_order',
      where: { id: 'so-legacy', version: 2, flowStatus: 'pending', deletedAt: null },
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-legacy-so',
        1,
        'approved',
        { id: 'approver', employeeId: 'emp-approver' }
      )
    ).resolves.toBe(true);

    expect(tx.saleOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'so-legacy', version: 2, flowStatus: 'pending', deletedAt: null },
        data: expect.objectContaining({
          remark: '历史变更已批准',
          flowStatus: 'approved',
          version: { increment: 1 },
        }),
      })
    );
  });

  it('回款推进订单版本后，备注和其他费用变更可合并并重新计算财务汇总', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-payment-updated',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-payment-updated',
      baseVersion: 2,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { remark: '赠送一台考勤机', otherFee: 345 },
      beforeSnapshot: { remark: null, otherFee: 0 },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-payment-updated',
      version: 4,
      flowStatus: 'approved',
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '20000',
      otherFee: '0',
      remark: null,
      totalReceived: '13800',
      createdAt: new Date('2026-09-02'),
      products: [],
    });
    tx.saleOrder.update.mockResolvedValue({ id: 'so-payment-updated', customerId: 'cust-1' });
    vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mockResolvedValueOnce({
      targetType: 'sale_order',
      where: { id: 'so-payment-updated', version: 4, flowStatus: 'approved', deletedAt: null },
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-so-payment-updated',
        2,
        'approved',
        { id: 'approver', employeeId: 'emp-approver' }
      )
    ).resolves.toBe(true);

    expect(tx.saleOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'so-payment-updated', version: 4, flowStatus: 'approved', deletedAt: null },
        data: expect.objectContaining({
          remark: '赠送一台考勤机',
          otherFee: '345',
          version: { increment: 1 },
        }),
      })
    );
    expect(recalcSaleOrderInvoicedSummary).toHaveBeenCalledWith(tx, 'so-payment-updated');
    expect(recalcSaleOrderPaymentSummary).toHaveBeenCalledWith(tx, 'so-payment-updated');
  });

  it('并发修改同一字段时明确列出冲突字段和当前内容', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-field-conflict',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-field-conflict',
      baseVersion: 2,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { remark: '赠送一台考勤机' },
      beforeSnapshot: { remark: '原备注' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-field-conflict',
      version: 4,
      flowStatus: 'approved',
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '20000',
      remark: '财务已更新备注',
      totalReceived: '13800',
      createdAt: new Date('2026-09-02'),
      products: [],
    });
    vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mockResolvedValueOnce({
      targetType: 'sale_order',
      where: { id: 'so-field-conflict', version: 4, flowStatus: 'approved', deletedAt: null },
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-so-field-conflict',
        2,
        'approved',
        { id: 'approver', employeeId: 'emp-approver' }
      )
    ).rejects.toThrow('订单变更审批存在字段冲突：备注（当前：财务已更新备注）');
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('订单换客户 + 有回款：拒绝（assertSaleOrderCustomerCanChange 拦截）', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-3',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-3',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { customerId: 'cust-new' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-3',
      version: 1,
      customerId: 'cust-old',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '10000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
    });
    tx.payment.count.mockResolvedValueOnce(1); // 有一条回款

    await expect(
      service.handleApprovalResult(tx as never, 'sale_order_change', 'chg-so-3', 1, 'approved', {
        id: 'admin',
        employeeId: 'emp-admin',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('历史 pending 订单版本超过基准版本加一时仍拒绝落地', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-stale-legacy-so',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-stale-legacy',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { remark: '不应落地' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-stale-legacy',
      version: 3,
      customerId: 'cust-1',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '10000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
      products: [],
    });
    vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mockResolvedValueOnce({
      targetType: 'sale_order',
      where: { id: 'so-stale-legacy', version: 3, flowStatus: 'pending', deletedAt: null },
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-stale-legacy-so',
        1,
        'approved',
        { id: 'approver', employeeId: 'emp-approver' }
      )
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('订单已关联项目时改绑客户：由项目关系守卫拒绝，避免项目与订单错链', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-project-link',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-project-link',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { customerId: 'cust-new' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-project-link',
      version: 1,
      customerId: 'cust-old',
      opportunityId: null,
      chargerId: 'emp-owner',
      orderAmount: '10000',
      createdAt: new Date('2026-05-01'),
      totalReceived: '0',
    });
    vi.mocked(assertSaleOrderProjectRelationUnchanged).mockRejectedValueOnce(
      new Error('合同订单已关联项目')
    );

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_change',
        'chg-so-project-link',
        1,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toThrow('合同订单已关联项目');

    expect(assertSaleOrderProjectRelationUnchanged).toHaveBeenCalledWith(
      tx,
      'so-project-link',
      'cust-new',
      null
    );
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });

  it('订单作废审批通过：软删除订单并回退唯一关联商机', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-void',
      eventType: 'sale_order_change',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-void',
      baseVersion: 4,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { __operation: 'void', __reason: '重复录入' },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-void',
      version: 4,
      customerId: 'cust-9',
      opportunityId: 'opp-1',
      products: [],
    });
    tx.opportunity.findFirst.mockResolvedValue({ opportunityStage: '赢单' });
    tx.opportunity.count.mockResolvedValue(0);
    tx.saleOrder.update.mockResolvedValue({ id: 'so-void' });

    await service.handleApprovalResult(
      tx as never,
      'sale_order_change',
      'chg-so-void',
      4,
      'approved',
      {
        id: 'admin',
        employeeId: 'emp-admin',
      }
    );

    expect(lockAndValidateApprovalChangeTargetForApproval).toHaveBeenCalled();
    expect(
      vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mock.invocationCallOrder[0]
    ).toBeLessThan(tx.saleOrder.update.mock.invocationCallOrder[0]!);
    expect(lockSaleOrderFinancialGraph).not.toHaveBeenCalled();
    expect(tx.saleOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'so-void',
          version: 4,
          flowStatus: 'approved',
          deletedAt: null,
        },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      })
    );
    expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
      tx,
      {
        opportunityIds: ['opp-1'],
        customerIds: ['cust-9'],
        retractedOpportunityIds: ['opp-1'],
      },
      { id: 'admin', employeeId: 'emp-admin' }
    );
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('纠错作废包审批通过：先退款后回款，清理草稿并回退安全项目，最后软删订单', async () => {
    const tx = buildFullTx();
    const payments = [
      {
        id: 'pay-in',
        version: 2,
        direction: 'IN',
        flowStatus: 'approved',
        paymentAmount: '1000',
        relatedPaymentId: null,
        invoicedByInvoiceId: null,
      },
      {
        id: 'pay-out',
        version: 1,
        direction: 'OUT',
        flowStatus: 'approved',
        paymentAmount: '200',
        relatedPaymentId: 'pay-in',
        invoicedByInvoiceId: null,
      },
      {
        id: 'pay-draft',
        version: 1,
        direction: 'IN',
        flowStatus: 'draft',
        paymentAmount: '50',
        relatedPaymentId: null,
        invoicedByInvoiceId: null,
      },
    ];
    const invoices = [
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
    ];
    const project = {
      id: 'project-1',
      version: 2,
      name: '误建项目',
      status: '未开始',
      opportunityId: 'opp-1',
    };
    const dependencySnapshot = {
      payments,
      invoices,
      project: {
        ...project,
        activeTicketCount: 0,
        effortRecordCount: 0,
        otherSaleOrderCount: 0,
      },
      secondaryProjectLinks: [],
      manualFinanceLedgers: [],
    };
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-bundle',
      eventType: 'sale_order_void',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-bundle',
      baseVersion: 5,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        __operation: 'void_bundle',
        __reason: '重复录入',
        dependencySnapshot,
        projectAction: 'rollback_to_opportunity',
      },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-bundle',
      version: 5,
      customerId: 'cust-9',
      opportunityId: 'opp-1',
      products: [],
    });
    tx.payment.findMany.mockResolvedValue(payments);
    tx.invoice.findMany.mockResolvedValue(invoices);
    tx.project.findFirst.mockResolvedValue(project);
    tx.opportunity.findFirst.mockResolvedValue({ opportunityStage: '赢单' });
    tx.opportunity.count.mockResolvedValue(0);
    tx.payment.update.mockResolvedValue({});
    tx.paymentItem.findMany
      .mockResolvedValueOnce([{ id: 'item-out', version: 4, saleOrderProductId: 'product-out' }])
      .mockResolvedValueOnce([{ id: 'item-in', version: 5, saleOrderProductId: 'product-in' }])
      .mockResolvedValueOnce([
        { id: 'item-draft', version: 6, saleOrderProductId: 'product-draft' },
      ]);
    tx.invoice.update.mockResolvedValue({});
    tx.saleOrder.update.mockResolvedValue({});

    await service.handleApprovalResult(
      tx as never,
      'sale_order_void',
      'chg-so-bundle',
      5,
      'approved',
      { id: 'admin', employeeId: 'emp-admin' }
    );

    expect(lockAndValidateApprovalChangeTargetForApproval).toHaveBeenCalled();
    expect(
      vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mock.invocationCallOrder[0]
    ).toBeLessThan(tx.payment.update.mock.invocationCallOrder[0]!);
    expect(lockSaleOrderFinancialGraph).not.toHaveBeenCalled();
    expect(tx.payment.update.mock.calls.map((call) => call[0].where.id)).toEqual([
      'pay-out',
      'pay-in',
      'pay-draft',
    ]);
    expect(tx.paymentItem.findMany.mock.calls.map((call) => call[0].where.paymentId.in)).toEqual([
      ['pay-out'],
      ['pay-in'],
      ['pay-draft'],
    ]);
    const deletedAt = tx.payment.update.mock.calls[0]![0].data.deletedAt;
    expect(tx.paymentItem.update.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({
        where: { id: 'item-out', version: 4, deletedAt: null },
        data: expect.objectContaining({ deletedAt, version: { increment: 1 } }),
      }),
      expect.objectContaining({
        where: { id: 'item-in', version: 5, deletedAt: null },
        data: expect.objectContaining({ deletedAt, version: { increment: 1 } }),
      }),
      expect.objectContaining({
        where: { id: 'item-draft', version: 6, deletedAt: null },
        data: expect.objectContaining({ deletedAt, version: { increment: 1 } }),
      }),
    ]);
    expect(recalculateBatchMock.mock.calls.map((call) => call[1])).toEqual([
      ['product-out'],
      ['product-in'],
      ['product-draft'],
    ]);
    expect(revokeFromPaymentMock.mock.calls.map((call) => call[1])).toEqual([
      'pay-out',
      'pay-in',
      'pay-draft',
    ]);
    expect(recalculateForPaymentMock).not.toHaveBeenCalled();
    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'inv-draft', version: 1 } })
    );
    expect(tx.payment.updateMany).toHaveBeenNthCalledWith(1, {
      where: { invoicedByInvoiceId: 'inv-draft', deletedAt: null },
      data: expect.objectContaining({ invoicedByInvoiceId: null, version: { increment: 1 } }),
    });
    expect(tx.payment.updateMany).toHaveBeenNthCalledWith(2, {
      where: { relatedInvoiceId: 'inv-draft', deletedAt: null },
      data: expect.objectContaining({ relatedInvoiceId: null, version: { increment: 1 } }),
    });
    expect(tx.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.payment.updateMany.mock.invocationCallOrder[0]!
    );
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1', version: 2 },
      data: expect.objectContaining({
        saleOrderId: null,
        status: '商机中',
        version: { increment: 1 },
      }),
    });
    expect(tx.saleOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'so-bundle',
          version: 5,
          flowStatus: 'approved',
          deletedAt: null,
        },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      })
    );
    expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
      tx,
      {
        opportunityIds: ['opp-1'],
        customerIds: ['cust-9'],
        retractedOpportunityIds: ['opp-1'],
      },
      { id: 'admin', employeeId: 'emp-admin' }
    );
    expect(tx.customer.update).not.toHaveBeenCalled();
  });

  it('纠错作废包 PaymentItem CAS 陈旧：返回 409 且终审和后续业务写入不执行', async () => {
    const tx = buildFullTx();
    const payments = [
      {
        id: 'pay-draft-stale-item',
        version: 2,
        direction: 'IN',
        flowStatus: 'draft',
        paymentAmount: '100',
        relatedPaymentId: null,
        invoicedByInvoiceId: null,
      },
    ];
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-bundle-stale-item',
      eventType: 'sale_order_void',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-bundle-stale-item',
      baseVersion: 3,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        __operation: 'void_bundle',
        __reason: '重复录入',
        dependencySnapshot: {
          payments,
          invoices: [],
          project: null,
          secondaryProjectLinks: [],
          manualFinanceLedgers: [],
        },
        projectAction: null,
      },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-bundle-stale-item',
      version: 3,
      customerId: 'cust-9',
      opportunityId: null,
      products: [],
    });
    tx.payment.findMany.mockResolvedValue(payments);
    tx.payment.update.mockResolvedValue({});
    tx.paymentItem.findMany.mockResolvedValue([
      { id: 'item-stale', version: 8, saleOrderProductId: 'product-stale' },
    ]);
    tx.paymentItem.update.mockRejectedValueOnce({ code: 'P2025' });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'sale_order_void',
        'chg-so-bundle-stale-item',
        3,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pay-draft-stale-item', version: 2 } })
    );
    expect(tx.paymentItem.update).toHaveBeenCalledWith({
      where: { id: 'item-stale', version: 8, deletedAt: null },
      data: expect.objectContaining({ version: { increment: 1 } }),
    });
    expect(recalculateBatchMock).not.toHaveBeenCalled();
    expect(recalculateForPaymentMock).not.toHaveBeenCalled();
    expect(revokeFromPaymentMock).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
    expect(tx.approvalChangeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('纠错作废包审批时依赖快照变化：整包拒绝且不写任何业务表', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-so-stale',
      eventType: 'sale_order_void',
      status: 'pending',
      targetType: 'sale_order',
      targetId: 'so-stale',
      baseVersion: 2,
      patch: {
        __operation: 'void_bundle',
        __reason: '重复录入',
        dependencySnapshot: {
          payments: [],
          invoices: [],
          project: null,
          secondaryProjectLinks: [],
          manualFinanceLedgers: [],
        },
        projectAction: null,
      },
      deletedAt: null,
    });
    tx.saleOrder.findFirst.mockResolvedValue({
      id: 'so-stale',
      version: 2,
      customerId: 'cust-1',
      opportunityId: null,
      products: [],
    });
    tx.payment.findMany.mockResolvedValue([
      {
        id: 'pay-new',
        version: 1,
        direction: 'IN',
        flowStatus: 'approved',
        paymentAmount: '100',
        relatedPaymentId: null,
        invoicedByInvoiceId: null,
      },
    ]);

    await expect(
      service.handleApprovalResult(tx as never, 'sale_order_void', 'chg-so-stale', 2, 'approved', {
        id: 'admin',
        employeeId: 'emp-admin',
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(tx.saleOrder.update).not.toHaveBeenCalled();
  });
});

describe('ApprovalChangeRequestsService — applyInvoiceChange happy path', () => {
  let service: ApprovalChangeRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockFinanceLedgerSync = {
      syncFromPayment: vi.fn().mockResolvedValue(undefined),
      revokeFromPayment: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      mockFinanceLedgerSync,
      buildReceivableService()
    );
  });

  it('开票金额+抬头+日期变更：走通 update；数值/日期分支正确解析', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-inv-1',
      eventType: 'invoice_change',
      status: 'pending',
      targetType: 'invoice',
      targetId: 'inv-1',
      baseVersion: 2,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        invoiceAmount: '9500',
        title: '示例科技有限公司',
        invoiceDate: '2026-06-25',
        invoiceType: '专票',
      },
      deletedAt: null,
    });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      version: 2,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      invoiceAmount: '9000',
      invoiceStatus: 'issued',
    });
    tx.invoice.update.mockResolvedValue({ id: 'inv-1', saleOrderId: 'so-77' });

    await service.handleApprovalResult(tx as never, 'invoice_change', 'chg-inv-1', 2, 'approved', {
      id: 'admin',
      employeeId: 'emp-admin',
    });

    expect(tx.invoice.update).toHaveBeenCalledTimes(1);
    const data = tx.invoice.update.mock.calls[0]![0].data;
    expect(data.invoiceAmount).toBe('9500');
    expect(data.title).toBe('示例科技有限公司');
    expect(data.invoiceDate).toBeInstanceOf(Date);
    expect(data.invoiceType).toBe('专票');
    expect(data.updater).toEqual({ connect: { id: 'emp-admin' } });
  });

  it('发票变更终态作废：头 CAS 成功后清理 active Payment 两类反向引用', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-inv-void',
      eventType: 'invoice_change',
      status: 'pending',
      targetType: 'invoice',
      targetId: 'inv-void',
      baseVersion: 4,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { invoiceStatus: '作废' },
      deletedAt: null,
    });
    tx.invoice.findFirst.mockResolvedValue({
      id: 'inv-void',
      version: 4,
      saleOrderId: 'so-old',
      customerId: 'cust-9',
      invoiceAmount: '9000',
      invoiceStatus: '正常',
    });
    tx.invoice.update.mockResolvedValue({
      id: 'inv-void',
      saleOrderId: 'so-old',
      invoiceStatus: '作废',
    });

    await service.handleApprovalResult(
      tx as never,
      'invoice_change',
      'chg-inv-void',
      4,
      'approved',
      { id: 'admin', employeeId: 'emp-admin' }
    );

    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'inv-void',
          version: 4,
          flowStatus: 'approved',
          deletedAt: null,
        },
      })
    );
    expect(tx.payment.updateMany).toHaveBeenNthCalledWith(1, {
      where: { invoicedByInvoiceId: 'inv-void', deletedAt: null },
      data: expect.objectContaining({ invoicedByInvoiceId: null, version: { increment: 1 } }),
    });
    expect(tx.payment.updateMany).toHaveBeenNthCalledWith(2, {
      where: { relatedInvoiceId: 'inv-void', deletedAt: null },
      data: expect.objectContaining({ relatedInvoiceId: null, version: { increment: 1 } }),
    });
    expect(tx.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
      tx.payment.updateMany.mock.invocationCallOrder[0]!
    );
  });
});

describe('ApprovalChangeRequestsService — applyPaymentChange happy path', () => {
  let service: ApprovalChangeRequestsService;
  // 单独持有 mock 引用避免 cast 到 ConstructorParameters 后类型丢失 mock 方法
  const syncFromPaymentMock = vi.fn().mockResolvedValue(undefined);
  const revokeFromPaymentMock = vi.fn().mockResolvedValue(undefined);
  const financeLedgerSync = {
    syncFromPayment: syncFromPaymentMock,
    revokeFromPayment: revokeFromPaymentMock,
  } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
  const recalculateForPaymentMock = vi.fn().mockResolvedValue({ updated: 0 });
  const recalculateBatchMock = vi.fn().mockResolvedValue({ updated: 0 });
  const receivableService = {
    recalculateForPayment: recalculateForPaymentMock,
    recalculateBatch: recalculateBatchMock,
  } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[2];

  beforeEach(() => {
    vi.clearAllMocks();
    syncFromPaymentMock.mockClear();
    revokeFromPaymentMock.mockClear();
    recalculateForPaymentMock.mockClear();
    recalculateBatchMock.mockClear();
    vi.mocked(advanceCustomDevelopmentProjectFromSaleOrder).mockClear();
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      financeLedgerSync,
      receivableService
    );
  });

  it('IN 方向回款金额变更：走通 update；syncFromPayment 被调用一次', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-1',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-1',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        paymentAmount: '3000',
        bankName: '招行',
        items: [
          {
            id: 'item-1',
            version: 2,
            saleOrderProductId: 'op-1',
            amount: 3000,
            paymentMode: 'direct',
          },
        ],
      },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      version: 1,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '2500',
      direction: 'IN',
      relatedPaymentId: null,
    });
    tx.payment.update.mockResolvedValue({
      id: 'pay-1',
      saleOrderId: 'so-77',
      paymentAmount: '3000',
    });
    tx.orderProduct.findMany.mockResolvedValue([
      { id: 'op-1', saleOrderId: 'so-77', productName: '产品一', financeSubjectId: null },
    ]);
    tx.paymentItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        itemSeq: 4,
        saleOrderProductId: 'op-1',
        deletedAt: null,
        version: 2,
      },
    ]);

    await service.handleApprovalResult(tx as never, 'payment_change', 'chg-pay-1', 1, 'approved', {
      id: 'admin',
      employeeId: 'emp-admin',
    });

    expect(tx.payment.update).toHaveBeenCalledTimes(1);
    const data = tx.payment.update.mock.calls[0]![0].data;
    expect(data.paymentAmount).toBe('3000');
    expect(data.bankName).toBe('招行');
    expect(syncFromPaymentMock).toHaveBeenCalledTimes(1);
    expect(advanceCustomDevelopmentProjectFromSaleOrder).toHaveBeenCalledWith(
      tx,
      'so-77',
      '未开始',
      { id: 'admin', employeeId: 'emp-admin' },
      { createIfMissing: false }
    );
  });

  it('IN 金额变化但缺少 items replacement：审批拒绝且不更新头表', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-missing-items',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-1',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { paymentAmount: '3000' },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      version: 1,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '2500',
      direction: 'IN',
      relatedPaymentId: null,
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'payment_change',
        'chg-pay-missing-items',
        1,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.paymentItem.findMany).not.toHaveBeenCalled();
  });

  it('IN 纯弱字段变化不要求 items replacement', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-weak',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-weak',
      baseVersion: 3,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { bankName: '建设银行', remark: '补充备注' },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-weak',
      version: 3,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '2500',
      direction: 'IN',
      relatedPaymentId: null,
    });
    tx.payment.update.mockResolvedValue({
      id: 'pay-weak',
      saleOrderId: 'so-77',
      paymentAmount: '2500',
    });

    await service.handleApprovalResult(
      tx as never,
      'payment_change',
      'chg-pay-weak',
      3,
      'approved',
      {
        id: 'admin',
        employeeId: 'emp-admin',
      }
    );

    expect(tx.payment.update).toHaveBeenCalledTimes(1);
    expect(tx.paymentItem.findMany).not.toHaveBeenCalled();
    expect(recalculateBatchMock).not.toHaveBeenCalled();
  });

  it('IN replacement 按 id 保留既有 itemSeq，不随 patch 顺序换号', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-items',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-items',
      baseVersion: 5,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        items: [
          {
            id: 'item-b',
            version: 4,
            saleOrderProductId: 'op-b',
            amount: 40,
            paymentMode: 'direct',
          },
          {
            id: 'item-a',
            version: 2,
            saleOrderProductId: 'op-a',
            amount: 60,
            paymentMode: 'direct',
          },
        ],
      },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-items',
      version: 5,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '100',
      direction: 'IN',
      relatedPaymentId: null,
    });
    tx.payment.update.mockResolvedValue({
      id: 'pay-items',
      saleOrderId: 'so-77',
      paymentAmount: '100',
    });
    tx.orderProduct.findMany.mockResolvedValue([
      { id: 'op-a', saleOrderId: 'so-77', productName: '产品 A', financeSubjectId: null },
      { id: 'op-b', saleOrderId: 'so-77', productName: '产品 B', financeSubjectId: null },
    ]);
    tx.paymentItem.findMany.mockResolvedValue([
      { id: 'item-a', itemSeq: 2, saleOrderProductId: 'op-a', deletedAt: null, version: 2 },
      { id: 'item-b', itemSeq: 9, saleOrderProductId: 'op-b', deletedAt: null, version: 4 },
    ]);

    await service.handleApprovalResult(
      tx as never,
      'payment_change',
      'chg-pay-items',
      5,
      'approved',
      {
        id: 'admin',
        employeeId: 'emp-admin',
      }
    );

    expect(tx.paymentItem.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'item-b', version: 4, deletedAt: null },
        data: expect.not.objectContaining({ itemSeq: expect.anything() }),
      })
    );
    expect(tx.paymentItem.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'item-a', version: 2, deletedAt: null },
        data: expect.not.objectContaining({ itemSeq: expect.anything() }),
      })
    );
    expect(tx.paymentItem.create).not.toHaveBeenCalled();
    expect(recalculateBatchMock).toHaveBeenCalledWith(tx, ['op-a', 'op-b']);
  });

  it('IN replacement 遇到陈旧 item CAS：拒绝整个审批事务且不刷新缓存', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-stale-item',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-stale',
      baseVersion: 2,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        items: [
          {
            id: 'item-stale',
            version: 7,
            saleOrderProductId: 'op-1',
            amount: 100,
            paymentMode: 'direct',
          },
        ],
      },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-stale',
      version: 2,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '100',
      direction: 'IN',
      relatedPaymentId: null,
    });
    tx.payment.update.mockResolvedValue({
      id: 'pay-stale',
      saleOrderId: 'so-77',
      paymentAmount: '100',
    });
    tx.orderProduct.findMany.mockResolvedValue([
      { id: 'op-1', saleOrderId: 'so-77', productName: '产品一', financeSubjectId: null },
    ]);
    tx.paymentItem.findMany.mockResolvedValue([
      { id: 'item-stale', itemSeq: 1, saleOrderProductId: 'op-1', deletedAt: null, version: 7 },
    ]);
    tx.paymentItem.update.mockRejectedValueOnce({ code: 'P2025' });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'payment_change',
        'chg-pay-stale-item',
        2,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.approvalChangeRequest.updateMany).not.toHaveBeenCalled();
    expect(recalculateBatchMock).not.toHaveBeenCalled();
  });

  it('OUT 方向 patch 一旦携带 items 即拒绝', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-refund-items',
      eventType: 'payment_refund_change',
      status: 'pending',
      targetType: 'payment_refund',
      targetId: 'refund-items',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        remark: '非法拆分',
        items: [{ saleOrderProductId: 'op-1', amount: 10, paymentMode: 'direct' }],
      },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'refund-items',
      version: 1,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '10',
      direction: 'OUT',
      relatedPaymentId: 'pay-in-1',
    });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'payment_refund_change',
        'chg-refund-items',
        1,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.paymentItem.findMany).not.toHaveBeenCalled();
  });

  it('OUT 方向退款：最终 validator 校验关联原回款，apply 仅 CAS 更新退款目标', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-2',
      eventType: 'payment_refund_change',
      status: 'pending',
      targetType: 'payment_refund',
      targetId: 'refund-1',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { paymentAmount: '500' },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'refund-1',
      version: 1,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      paymentAmount: '400',
      direction: 'OUT',
      relatedPaymentId: 'pay-in-1',
    });
    tx.payment.update.mockResolvedValue({ id: 'refund-1', saleOrderId: 'so-77' });

    await service.handleApprovalResult(
      tx as never,
      'payment_refund_change',
      'chg-pay-2',
      1,
      'approved',
      { id: 'admin', employeeId: 'emp-admin' }
    );

    expect(lockAndValidateApprovalChangeTargetForApproval).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ targetType: 'payment_refund', targetVersion: 1 })
    );
    expect(tx.payment.update).toHaveBeenCalledTimes(1);
    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'refund-1',
          version: 1,
          flowStatus: 'approved',
          deletedAt: null,
        },
        data: expect.objectContaining({ version: { increment: 1 } }),
      })
    );
  });

  it('回款作废审批通过：validator 先锁图，头与 active items 用同一时间软删后刷新汇总和流水', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-void',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-void',
      baseVersion: 2,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { __operation: 'void', __reason: '重复回款' },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-void',
      version: 2,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      direction: 'IN',
    });
    tx.payment.count.mockResolvedValue(0);
    tx.payment.update.mockResolvedValue({ id: 'pay-void' });
    tx.paymentItem.findMany.mockResolvedValue([
      { id: 'item-a', version: 2, saleOrderProductId: 'op-a' },
      { id: 'item-b', version: 4, saleOrderProductId: 'op-b' },
    ]);

    await service.handleApprovalResult(
      tx as never,
      'payment_change',
      'chg-pay-void',
      2,
      'approved',
      {
        id: 'admin',
        employeeId: 'emp-admin',
      }
    );

    expect(tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'pay-void',
          version: 2,
          flowStatus: 'approved',
          deletedAt: null,
        },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      })
    );
    const deletedAt = tx.payment.update.mock.calls[0]![0].data.deletedAt;
    expect(tx.paymentItem.findMany).toHaveBeenCalledWith({
      where: { paymentId: { in: ['pay-void'] }, deletedAt: null },
      select: { id: true, version: true, saleOrderProductId: true },
      orderBy: { id: 'asc' },
    });
    expect(tx.paymentItem.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'item-a', version: 2, deletedAt: null },
      data: expect.objectContaining({ deletedAt, version: { increment: 1 } }),
    });
    expect(tx.paymentItem.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'item-b', version: 4, deletedAt: null },
      data: expect.objectContaining({ deletedAt, version: { increment: 1 } }),
    });
    expect(recalculateBatchMock).toHaveBeenCalledWith(tx, ['op-a', 'op-b']);
    expect(recalculateForPaymentMock).not.toHaveBeenCalled();
    expect(revokeFromPaymentMock).toHaveBeenCalledWith(tx, 'pay-void', '回款作废：重复回款');

    expect(
      vi.mocked(lockAndValidateApprovalChangeTargetForApproval).mock.invocationCallOrder[0]
    ).toBeLessThan(tx.payment.update.mock.invocationCallOrder[0]!);
    expect(vi.mocked(lockSaleOrderFinancialGraph)).not.toHaveBeenCalled();
    expect(recalculateBatchMock.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(recalcSaleOrderPaymentSummary).mock.invocationCallOrder[0]!
    );
    expect(vi.mocked(recalcSaleOrderPaymentSummary).mock.invocationCallOrder[0]).toBeLessThan(
      revokeFromPaymentMock.mock.invocationCallOrder[0]!
    );
  });

  it('回款作废明细 CAS 陈旧：返回 409，审批完成与后续汇总/流水均不执行以便事务整体回滚', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-void-stale-item',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-void-stale-item',
      baseVersion: 3,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { __operation: 'void', __reason: '重复回款' },
      deletedAt: null,
    });
    tx.payment.findFirst.mockResolvedValue({
      id: 'pay-void-stale-item',
      version: 3,
      saleOrderId: 'so-77',
      customerId: 'cust-9',
      direction: 'IN',
    });
    tx.payment.count.mockResolvedValue(0);
    tx.payment.update.mockResolvedValue({ id: 'pay-void-stale-item' });
    tx.paymentItem.findMany.mockResolvedValue([
      { id: 'item-stale', version: 7, saleOrderProductId: 'op-stale' },
    ]);
    tx.paymentItem.update.mockRejectedValueOnce({ code: 'P2025' });

    await expect(
      service.handleApprovalResult(
        tx as never,
        'payment_change',
        'chg-pay-void-stale-item',
        3,
        'approved',
        { id: 'admin', employeeId: 'emp-admin' }
      )
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.payment.update).toHaveBeenCalledTimes(1);
    expect(tx.approvalChangeRequest.updateMany).not.toHaveBeenCalled();
    expect(recalculateBatchMock).not.toHaveBeenCalled();
    expect(recalculateForPaymentMock).not.toHaveBeenCalled();
    expect(recalcSaleOrderPaymentSummary).not.toHaveBeenCalled();
    expect(revokeFromPaymentMock).not.toHaveBeenCalled();
  });

  it('direction 字段试图通过变更审批改：直接抛 BadRequest', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-pay-3',
      eventType: 'payment_change',
      status: 'pending',
      targetType: 'payment',
      targetId: 'pay-3',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: { direction: 'out' },
      deletedAt: null,
    });

    await expect(
      service.handleApprovalResult(tx as never, 'payment_change', 'chg-pay-3', 1, 'approved', {
        id: 'admin',
        employeeId: 'emp-admin',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
  });
});

describe('ApprovalChangeRequestsService — applyVisitRecordChange happy path', () => {
  let service: ApprovalChangeRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockFinanceLedgerSync = {
      syncFromPayment: vi.fn().mockResolvedValue(undefined),
      revokeFromPayment: vi.fn().mockResolvedValue(undefined),
    } as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[1];
    service = new ApprovalChangeRequestsService(
      {} as unknown as ConstructorParameters<typeof ApprovalChangeRequestsService>[0],
      mockFinanceLedgerSync,
      buildReceivableService()
    );
  });

  it('拜访记录内容+时间+持续时长变更：走通 update；数值/日期分支正确解析', async () => {
    const tx = buildFullTx();
    tx.approvalChangeRequest.findFirst.mockResolvedValue({
      id: 'chg-visit-1',
      eventType: 'visit_change',
      status: 'pending',
      targetType: 'visit_record',
      targetId: 'visit-1',
      baseVersion: 1,
      version: 1,
      creatorEmployeeId: 'emp-owner',
      patch: {
        content: '和 KP 沟通新一期需求',
        signInTime: '2026-06-25 10:00',
        signOutTime: '2026-06-25 11:30',
        duration: 90,
        visitStatus: 'finished',
        signLocation: '118.643052,24.729363',
      },
      deletedAt: null,
    });
    tx.visitRecord.findFirst.mockResolvedValue({
      id: 'visit-1',
      customerId: 'cust-1',
      version: 1,
    });
    tx.visitRecord.update.mockResolvedValue({ customerId: 'cust-1' });

    await service.handleApprovalResult(tx as never, 'visit_change', 'chg-visit-1', 1, 'approved', {
      id: 'admin',
      employeeId: 'emp-admin',
    });

    expect(tx.visitRecord.update).toHaveBeenCalledTimes(1);
    const data = tx.visitRecord.update.mock.calls[0]![0].data;
    expect(data.content).toBe('和 KP 沟通新一期需求');
    expect(data.duration).toBe(90);
    expect(data.visitStatus).toBe('finished');
    expect(data.signLocation).toBe('118.643052,24.729363');
    expect(data.updater).toEqual({ connect: { id: 'emp-admin' } });
    expect(recomputeCustomerLifecycle).toHaveBeenCalledWith(tx, ['cust-1', 'cust-1'], {
      syncLeadProgress: true,
      actor: { id: 'admin', employeeId: 'emp-admin' },
    });
  });
});
