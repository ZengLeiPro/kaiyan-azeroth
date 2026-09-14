import { APPROVER_TYPE } from '@ky-azeroth/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { ApproverResolverService } from '../approver-resolver.service';

/**
 * push 6: ApproverResolverService 已切到 employee 维度（user 表已删）。
 * spec 中 mockPrisma.user.* → mockPrisma.employee.*
 */
describe('ApproverResolverService', () => {
  let service: ApproverResolverService;
  let mockPrisma: MockPrismaService;

  const initiatorUserId = 'initiator-emp-001';

  function makeNode(overrides: Record<string, unknown> = {}) {
    return {
      approverType: APPROVER_TYPE.MEMBER,
      approverUserIds: [] as string[],
      approverRoleId: null as string | null,
      managerLevel: 1,
      multiType: 'or',
      ...overrides,
    };
  }

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new ApproverResolverService(asPrismaService(mockPrisma));
  });

  describe('resolveApprovers - MEMBER', () => {
    it('返回指定员工列表', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'u1', name: '张三', username: 'alice' },
        { id: 'u2', name: '李四', username: 'bob' },
      ]);

      const node = makeNode({ approverUserIds: ['u1', 'u2'], multiType: 'or' });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        approverId: 'u1',
        approverName: '张三',
        approverType: APPROVER_TYPE.MEMBER,
        sequence: 0,
      });
    });

    it('multiType为sequence时sequence递增', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'u1', name: '张三', username: 'alice' },
        { id: 'u2', name: '李四', username: 'bob' },
        { id: 'u3', name: '王五', username: 'charlie' },
      ]);

      const node = makeNode({
        approverUserIds: ['u1', 'u2', 'u3'],
        multiType: 'sequence',
      });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result[0]!.sequence).toBe(1);
      expect(result[1]!.sequence).toBe(2);
      expect(result[2]!.sequence).toBe(3);
    });

    it('multiType为or时sequence为0', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'u1', name: '张三', username: 'alice' },
        { id: 'u2', name: '李四', username: 'bob' },
      ]);

      const node = makeNode({ approverUserIds: ['u1', 'u2'], multiType: 'or' });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result[0]!.sequence).toBe(0);
      expect(result[1]!.sequence).toBe(0);
    });

    it('空approverUserIds返回空数组', async () => {
      const node = makeNode({ approverUserIds: [] });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toEqual([]);
      expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('resolveApprovers - MANAGER', () => {
    it('返回主部门负责人', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: initiatorUserId,
        departments: [
          {
            isPrimary: true,
            department: { manager: { id: 'manager-001', name: '赵六' } },
          },
        ],
      });

      const node = makeNode({ approverType: APPROVER_TYPE.MANAGER });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        approverId: 'manager-001',
        approverName: '赵六',
        approverType: APPROVER_TYPE.MANAGER,
        sequence: 0,
      });
    });

    it('负责人即发起人时也返回该 approver（由审批引擎 autoPassSelfTasksAndAdvance 自动通过）', async () => {
      // 2026-06 改造前 resolver 主动剔除 manager==initiator，导致 CEO/部门顶端
      // 自己提单跑不通；改造后 resolver 把发起人本人也放进 approvers 列表，
      // 由 approvals.service 的"申请人=审批人自动通过"层统一处理。
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: initiatorUserId,
        departments: [
          {
            isPrimary: true,
            department: { manager: { id: initiatorUserId, name: '发起人本人' } },
          },
        ],
      });

      const node = makeNode({ approverType: APPROVER_TYPE.MANAGER });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toEqual([
        {
          approverId: initiatorUserId,
          approverName: '发起人本人',
          approverType: APPROVER_TYPE.MANAGER,
          sequence: 0,
        },
      ]);
    });

    it('无负责人时返回空数组', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({
        id: initiatorUserId,
        departments: [{ isPrimary: true, department: { manager: null } }],
      });

      const node = makeNode({ approverType: APPROVER_TYPE.MANAGER });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toEqual([]);
    });
  });

  describe('resolveApprovers - ROLE', () => {
    it('返回指定角色员工', async () => {
      mockPrisma.userRole.findMany.mockResolvedValue([
        { employeeId: 'u1', employee: { id: 'u1', name: '张三', username: 'alice' } },
        { employeeId: 'u2', employee: { id: 'u2', name: '李四', username: 'bob' } },
      ]);

      const node = makeNode({
        approverType: APPROVER_TYPE.ROLE,
        approverRoleId: 'role-001',
        multiType: 'or',
      });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toHaveLength(2);
      expect(result[0]!.approverId).toBe('u1');
      expect(result[0]!.approverName).toBe('张三');
    });

    it('approverRoleId为空时返回空数组', async () => {
      const node = makeNode({ approverType: APPROVER_TYPE.ROLE, approverRoleId: null });

      const result = await service.resolveApprovers(node, initiatorUserId);

      expect(result).toEqual([]);
      expect(mockPrisma.userRole.findMany).not.toHaveBeenCalled();
    });
  });

  describe('validateNodeConfig', () => {
    it('有审批人时返回true', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'u1', name: '张三', username: 'alice' },
      ]);

      const node = makeNode({ approverUserIds: ['u1'] });

      const result = await service.validateNodeConfig(node, initiatorUserId);

      expect(result).toBe(true);
    });

    it('无审批人时返回false', async () => {
      const node = makeNode({ approverUserIds: [] });

      const result = await service.validateNodeConfig(node, initiatorUserId);

      expect(result).toBe(false);
    });
  });

  describe('getUserInfo', () => {
    it('返回员工姓名', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ name: '张三', username: 'alice' });

      const result = await service.getUserInfo('u1');

      expect(result).toEqual({ name: '张三' });
    });

    it('员工不存在时返回null', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue(null);

      const result = await service.getUserInfo('non-existent');

      expect(result).toBeNull();
    });

    it('无 name 时返回 username', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ name: null, username: 'alice' });

      const result = await service.getUserInfo('u1');

      expect(result).toEqual({ name: 'alice' });
    });
  });
});
