import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { ApprovalFlowsService } from '../approval-flows.service';

// mock crypto.randomUUID
vi.mock('crypto', async () => {
  const actual = await vi.importActual('crypto');
  return { ...actual, randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678') };
});

// ─── Helper: 构建审批流程对象 ──────────────────────────────────────────

interface FlowData {
  id: string;
  groupId: string;
  code: string;
  name: string;
  eventType: string;
  description: string | null;
  copyToIds: string[];
  version: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
}

interface FlowNodeData {
  id: string;
  flowId: string;
  nodeOrder: number;
  nodeName: string;
  approverType: string;
  approverUserIds: string[];
  approverRoleId: string | null;
  managerLevel: number;
  multiType: string;
  timeoutHours: number | null;
  createdAt: Date;
  updatedAt: Date;
}

let flowSeq = 0;

function buildFlow(overrides: Partial<FlowData> = {}): FlowData {
  flowSeq++;
  const seq = flowSeq.toString().padStart(4, '0');
  const now = new Date();
  return {
    id: `flow-${seq}`,
    groupId: `leave_request_abcd1234`,
    code: `LEAVE_REQUEST_V1`,
    name: `请假审批流程${seq}`,
    eventType: 'leave_request',
    description: null,
    copyToIds: [],
    version: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function buildNode(overrides: Partial<FlowNodeData> = {}): FlowNodeData {
  const now = new Date();
  return {
    id: 'node-1',
    flowId: 'flow-1',
    nodeOrder: 1,
    nodeName: '审批节点1',
    approverType: 'user',
    approverUserIds: ['user-a'],
    approverRoleId: null,
    managerLevel: 1,
    multiType: 'or',
    timeoutHours: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildFlowWithNodes(flowOverrides: Partial<FlowData> = {}, nodes?: FlowNodeData[]) {
  const flow = buildFlow(flowOverrides);
  return { ...flow, nodes: nodes ?? [buildNode({ flowId: flow.id })] };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('ApprovalFlowsService', () => {
  let service: ApprovalFlowsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    flowSeq = 0;
    mockPrisma = createMockPrismaService();
    // approvalFlow.findUniqueOrThrow 不在默认 MockDelegate 中，需手动添加
    (mockPrisma.approvalFlow as Record<string, unknown>).findUniqueOrThrow = vi.fn();
    mockFilterApplier = {
      // approval-flows 的 findAll 在 baseWhere 里写入 status 默认值，legacyFilters 传入
      // eventType。我们让 mock buildWhere 把 baseWhere + legacyFilters 合成观察对象，
      // 避免在 legacyFilters 测试里再手工跑一遍 filter 逻辑。
      buildWhere: vi.fn(async ({ baseWhere, legacyFilters }) => ({
        ...baseWhere,
        ...(legacyFilters && Array.isArray((legacyFilters as Record<string, unknown>).eventType)
          ? { eventType: { in: (legacyFilters as { eventType: string[] }).eventType } }
          : {}),
      })),
    };
    service = new ApprovalFlowsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('应创建流程并停用旧的激活流程，在事务中完成', async () => {
      const createdFlow = buildFlow({ id: 'new-flow-id' });
      const resultFlow = buildFlowWithNodes({ id: 'new-flow-id' });

      mockPrisma.approvalFlow.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalFlow.create.mockResolvedValue(createdFlow);
      mockPrisma.approvalFlowNode.createMany.mockResolvedValue({ count: 1 });
      (
        mockPrisma.approvalFlow as Record<string, ReturnType<typeof vi.fn>>
      ).findUniqueOrThrow!.mockResolvedValue(resultFlow);

      const dto = {
        name: '请假审批',
        eventType: 'leave_request',
        description: '请假审批流程',
        copyToIds: ['user-x'],
        nodes: [
          {
            nodeOrder: 1,
            nodeName: '主管审批',
            approverType: 'user',
            approverUserIds: ['user-a'],
            approverRoleId: undefined,
            managerLevel: 1,
            multiType: 'or',
            timeoutHours: undefined,
          },
        ],
      };

      const result = await service.create(dto as Parameters<typeof service.create>[0], {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toBeDefined();
      // 验证停用旧流程
      expect(mockPrisma.approvalFlow.updateMany).toHaveBeenCalledWith({
        where: { eventType: 'leave_request', status: 'active' },
        data: { status: 'inactive' },
      });
      // 验证创建新流程
      expect(mockPrisma.approvalFlow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          groupId: 'leave_request_mock-uui',
          code: 'LEAVE_REQUEST_V1',
          name: '请假审批',
          eventType: 'leave_request',
          version: 1,
          status: 'active',
        }),
      });
      // 验证创建节点
      expect(mockPrisma.approvalFlowNode.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            flowId: 'new-flow-id',
            nodeOrder: 1,
            nodeName: '主管审批',
            approverType: 'user',
          }),
        ],
      });
      // 验证事务被调用
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ─── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('应创建新版本而非覆盖旧流程', async () => {
      const oldFlow = buildFlowWithNodes({
        id: 'old-flow',
        groupId: 'leave_request_grp1',
        version: 1,
      });
      const newFlow = buildFlow({
        id: 'new-flow',
        groupId: 'leave_request_grp1',
        version: 2,
      });
      const newFlowWithNodes = { ...newFlow, nodes: [buildNode({ flowId: 'new-flow' })] };

      mockPrisma.approvalFlow.findUnique.mockResolvedValue(oldFlow);
      mockPrisma.approvalFlow.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalFlow.aggregate.mockResolvedValue({ _max: { version: 1 } });
      mockPrisma.approvalFlow.create.mockResolvedValue(newFlow);
      mockPrisma.approvalFlowNode.createMany.mockResolvedValue({ count: 1 });
      (
        mockPrisma.approvalFlow as Record<string, ReturnType<typeof vi.fn>>
      ).findUniqueOrThrow!.mockResolvedValue(newFlowWithNodes);

      const dto = {
        name: '请假审批V2',
        nodes: [
          {
            nodeOrder: 1,
            nodeName: '经理审批',
            approverType: 'user',
            approverUserIds: ['user-b'],
            managerLevel: 1,
            multiType: 'and',
          },
        ],
      };

      const result = await service.update('old-flow', dto as Parameters<typeof service.update>[1], {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toBeDefined();
      // 验证创建的新版本
      expect(mockPrisma.approvalFlow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          groupId: 'leave_request_grp1',
          version: 2,
          code: 'LEAVE_REQUEST_V2',
          status: 'active',
        }),
      });
    });

    it('流程不存在时应抛出 NotFoundException', async () => {
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(null);

      await expect(
        service.update('non-exist', { name: '不存在' } as Parameters<typeof service.update>[1], {
          id: 'user-1',
          employeeId: 'emp-' + 'user-1',
        })
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('版本号应基于 aggregate 最大值递增', async () => {
      const oldFlow = buildFlowWithNodes({
        id: 'old-flow',
        groupId: 'leave_request_grp1',
        version: 2,
      });
      const newFlow = buildFlow({
        id: 'new-flow',
        groupId: 'leave_request_grp1',
        version: 4,
      });

      mockPrisma.approvalFlow.findUnique.mockResolvedValue(oldFlow);
      mockPrisma.approvalFlow.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalFlow.aggregate.mockResolvedValue({ _max: { version: 3 } });
      mockPrisma.approvalFlow.create.mockResolvedValue(newFlow);
      mockPrisma.approvalFlowNode.createMany.mockResolvedValue({ count: 1 });
      (
        mockPrisma.approvalFlow as Record<string, ReturnType<typeof vi.fn>>
      ).findUniqueOrThrow!.mockResolvedValue({ ...newFlow, nodes: [] });

      await service.update('old-flow', { name: 'V4' } as Parameters<typeof service.update>[1], {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(mockPrisma.approvalFlow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 4 }),
      });
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('应返回分页结果', async () => {
      const items = [buildFlowWithNodes(), buildFlowWithNodes()];
      mockPrisma.approvalFlow.findMany.mockResolvedValue(items);
      mockPrisma.approvalFlow.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 10 } as Parameters<
        typeof service.findAll
      >[0]);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it('应支持 eventType 筛选', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([]);
      mockPrisma.approvalFlow.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortOrder: 'desc' as const,
        eventType: ['leave_request'],
      } as unknown as Parameters<typeof service.findAll>[0]);

      expect(mockPrisma.approvalFlow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ eventType: { in: ['leave_request'] } }),
        })
      );
    });

    it('不传 status 时默认排除 deleted（active + inactive 都显示）', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([]);
      mockPrisma.approvalFlow.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10 } as Parameters<typeof service.findAll>[0]);

      expect(mockPrisma.approvalFlow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { not: 'deleted' },
            deletedAt: null,
          }),
        })
      );
    });

    it('显式传入 status 时应使用指定值筛选', async () => {
      mockPrisma.approvalFlow.findMany.mockResolvedValue([]);
      mockPrisma.approvalFlow.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        status: 'inactive',
      } as Parameters<typeof service.findAll>[0]);

      expect(mockPrisma.approvalFlow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'inactive' }),
        })
      );
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('应返回包含 nodes 的流程详情', async () => {
      const flow = buildFlowWithNodes({ id: 'flow-1' });
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(flow);

      const result = await service.findOne('flow-1');

      expect(result).toBeDefined();
      expect(mockPrisma.approvalFlow.findFirst).toHaveBeenCalledWith({
        where: { id: 'flow-1', deletedAt: null },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });
    });

    it('流程不存在时应抛出 NotFoundException', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findActiveByEventType ───────────────────────────────────────────

  describe('findActiveByEventType', () => {
    it('应返回该事件类型的激活流程', async () => {
      const flow = buildFlowWithNodes({ status: 'active', eventType: 'leave_request' });
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(flow);

      const result = await service.findActiveByEventType('leave_request');

      expect(result).toBeDefined();
      expect(mockPrisma.approvalFlow.findFirst).toHaveBeenCalledWith({
        where: { eventType: 'leave_request', status: 'active' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });
    });

    it('无激活流程时应返回 null', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(null);

      const result = await service.findActiveByEventType('leave_request');

      expect(result).toBeNull();
    });
  });

  // ─── findVersionHistory ──────────────────────────────────────────────

  describe('findVersionHistory', () => {
    it('应返回同 groupId 的所有版本，按版本降序', async () => {
      const v2 = buildFlowWithNodes({ groupId: 'grp-1', version: 2 });
      const v1 = buildFlowWithNodes({ groupId: 'grp-1', version: 1 });
      mockPrisma.approvalFlow.findMany.mockResolvedValue([v2, v1]);

      const result = await service.findVersionHistory('grp-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.approvalFlow.findMany).toHaveBeenCalledWith({
        where: {
          groupId: 'grp-1',
          deletedAt: null,
          status: { not: 'deleted' },
        },
        orderBy: { version: 'desc' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });
    });
  });

  // ─── remove ──────────────────────────────────────────────────────────

  describe('remove', () => {
    it('应软删除流程（设置 status=deleted 和 deletedAt）', async () => {
      const flow = { ...buildFlow({ id: 'flow-1', status: 'inactive' }), instances: [] };
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);
      mockPrisma.approvalFlow.update.mockResolvedValue(flow);

      const result = await service.remove('flow-1', {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.approvalFlow.update).toHaveBeenCalledWith({
        where: { id: 'flow-1' },
        data: {
          status: 'deleted',
          deletedAt: expect.any(Date),
          updaterEmployeeId: 'emp-user-1',
        },
      });
    });

    it('流程不存在时应抛出 NotFoundException', async () => {
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });

    it('有活跃实例的激活流程应抛出 BadRequestException', async () => {
      const flow = {
        ...buildFlow({ id: 'flow-1', status: 'active' }),
        instances: [{ id: 'inst-1' }],
      };
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);

      await expect(
        service.remove('flow-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.approvalFlow.update).not.toHaveBeenCalled();
    });
  });

  // ─── enableModule ────────────────────────────────────────────────────

  describe('enableModule', () => {
    it('应激活该事件类型的最新版本流程', async () => {
      const latestFlow = buildFlow({ id: 'latest', version: 3, status: 'inactive' });
      const activatedFlow = buildFlowWithNodes({ id: 'latest', version: 3, status: 'active' });

      mockPrisma.approvalFlow.findFirst.mockResolvedValue(latestFlow);
      mockPrisma.approvalFlow.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.approvalFlow.update.mockResolvedValue(activatedFlow);

      const result = await service.enableModule('leave_request');

      expect(result.enabled).toBe(true);
      expect(result.hasFlow).toBe(true);
      expect(result.flow).toBeDefined();
      // 验证先停用所有激活的
      expect(mockPrisma.approvalFlow.updateMany).toHaveBeenCalledWith({
        where: { eventType: 'leave_request', status: 'active' },
        data: { status: 'inactive' },
      });
      // 验证激活指定流程
      expect(mockPrisma.approvalFlow.update).toHaveBeenCalledWith({
        where: { id: 'latest' },
        data: { status: 'active' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });
    });

    it('无流程时应返回 enabled:false, hasFlow:false', async () => {
      mockPrisma.approvalFlow.findFirst.mockResolvedValue(null);

      const result = await service.enableModule('leave_request');

      expect(result).toEqual({ enabled: false, hasFlow: false });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── disableModule ───────────────────────────────────────────────────

  describe('disableModule', () => {
    it('应停用所有 active 流程并返回影响数量', async () => {
      mockPrisma.approvalFlow.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.disableModule('leave_request');

      expect(result).toEqual({ disabled: true, count: 2 });
      expect(mockPrisma.approvalFlow.updateMany).toHaveBeenCalledWith({
        where: { eventType: 'leave_request', status: 'active' },
        data: { status: 'inactive' },
      });
    });
  });

  // ─── deactivateFlow ──────────────────────────────────────────────────

  describe('deactivateFlow', () => {
    const currentUser = { id: 'user-x', employeeId: 'emp-x' };

    it('应把 active 流程改为 inactive', async () => {
      const flow = buildFlow({ id: 'flow-active', status: 'active' });
      const deactivated = buildFlowWithNodes({ id: 'flow-active', status: 'inactive' });

      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);
      mockPrisma.approvalFlow.update.mockResolvedValue(deactivated);

      const result = await service.deactivateFlow('flow-active', currentUser);

      expect(result).toBeDefined();
      expect(mockPrisma.approvalFlow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'flow-active' },
          data: expect.objectContaining({ status: 'inactive' }),
        })
      );
    });

    it('inactive 流程幂等返回，不再写库', async () => {
      const flow = buildFlow({ id: 'flow-inactive', status: 'inactive' });
      const flowWithNodes = buildFlowWithNodes({ id: 'flow-inactive', status: 'inactive' });

      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);
      (
        mockPrisma.approvalFlow as Record<string, ReturnType<typeof vi.fn>>
      ).findUniqueOrThrow!.mockResolvedValue(flowWithNodes);

      const result = await service.deactivateFlow('flow-inactive', currentUser);

      expect(result).toBeDefined();
      expect(mockPrisma.approvalFlow.update).not.toHaveBeenCalled();
    });

    it('流程不存在时应抛出 NotFoundException', async () => {
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(null);

      await expect(service.deactivateFlow('non-exist', currentUser)).rejects.toThrow(
        NotFoundException
      );
    });

    it('已删除的流程应抛出 BadRequestException', async () => {
      const flow = buildFlow({ id: 'flow-del', status: 'deleted' });
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);

      await expect(service.deactivateFlow('flow-del', currentUser)).rejects.toThrow(
        BadRequestException
      );
      expect(mockPrisma.approvalFlow.update).not.toHaveBeenCalled();
    });
  });

  // ─── activateVersion ─────────────────────────────────────────────────

  describe('activateVersion', () => {
    it('应激活指定版本并停用同类型其他版本', async () => {
      const flow = buildFlow({ id: 'flow-v2', status: 'inactive', eventType: 'leave_request' });
      const activatedFlow = buildFlowWithNodes({ id: 'flow-v2', status: 'active' });

      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);
      mockPrisma.approvalFlow.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.approvalFlow.update.mockResolvedValue(activatedFlow);

      const result = await service.activateVersion('flow-v2');

      expect(result).toBeDefined();
      // 验证停用同事件类型的其他激活流程
      expect(mockPrisma.approvalFlow.updateMany).toHaveBeenCalledWith({
        where: { eventType: 'leave_request', status: 'active' },
        data: { status: 'inactive' },
      });
      // 验证激活指定流程
      expect(mockPrisma.approvalFlow.update).toHaveBeenCalledWith({
        where: { id: 'flow-v2' },
        data: { status: 'active' },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      });
    });

    it('流程不存在时应抛出 NotFoundException', async () => {
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(null);

      await expect(service.activateVersion('non-exist')).rejects.toThrow(NotFoundException);
    });

    it('已删除的流程应抛出 BadRequestException', async () => {
      const flow = buildFlow({ id: 'flow-del', status: 'deleted' });
      mockPrisma.approvalFlow.findUnique.mockResolvedValue(flow);

      await expect(service.activateVersion('flow-del')).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
