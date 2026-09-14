import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { vi } from 'vitest';

import { EmployeePermissionCacheService } from '../../../common/services/employee-permission-cache.service';
import { buildRole, buildUser } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { SessionsService } from '../../sessions/sessions.service';
import { UsersService } from '../users.service';

vi.mock('bcryptjs', () => ({
  hash: vi.fn().mockResolvedValue('hashed-password'),
  compare: vi.fn().mockResolvedValue(true),
}));

/**
 * push 6: UsersService 已重构为 employee-with-login 视图。
 * spec 把所有 mockPrisma.user.* 改成 mockPrisma.employee.*；返回的 employee 数据带
 * username/loginStatus/userRoles 字段。
 */
type EmployeeLoginOverrides = {
  canLogin?: boolean;
  loginStatus?: string;
  loginFailCount?: number;
  lockUntil?: Date | null;
};

function buildEmployeeWithRoles(
  overrides: Parameters<typeof buildUser>[0] & EmployeeLoginOverrides = {}
) {
  const { canLogin, loginStatus, loginFailCount, lockUntil, ...userOverrides } = overrides;
  const base = buildUser(userOverrides);
  const role = buildRole();
  return {
    id: base.id,
    serialNumber: `EMP_${base.id}`,
    name: base.username,
    username: base.username,
    phone: base.phone,
    email: base.email,
    avatar: base.avatar,
    password: base.password,
    canLogin: canLogin ?? true,
    loginStatus: loginStatus ?? base.status,
    lastLoginAt: null,
    lastLoginIp: null,
    loginFailCount: loginFailCount ?? 0,
    lockUntil: lockUntil ?? null,
    tokenInvalidAfter: null,
    deletedAt: base.deletedAt,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    version: base.version,
    isAdmin: false,
    isBoss: false,
    isLeader: false,
    dingtalkActive: true,
    dingtalkUserId: null,
    userRoles: [{ role: { ...role, permissions: [] }, roleId: role.id }],
  };
}

describe('UsersService', () => {
  const protectedEmployeeId = '9f1f2538-86b0-4b69-901d-fb6cc9d38d9a';
  let service: UsersService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    process.env.SUPER_ADMIN_EMPLOYEE_ID = protectedEmployeeId;
    mockPrisma = createMockPrismaService();
    mockPrisma.employee.findMany.mockResolvedValue([]);
    mockPrisma.employee.findUnique.mockResolvedValue({ userRoles: [] });
    mockPrisma.userRole.findFirst.mockResolvedValue(null);
    mockPrisma.role.findMany.mockImplementation(async (args) => {
      const ids = (args?.where?.id?.in ?? []) as string[];
      return ids.map((id) => ({ id, code: `ROLE_${id}`, permissions: [] }));
    });
    const mockSessionsService = {
      deleteAllByUserId: vi.fn().mockResolvedValue({ count: 0 }),
      lockEmployeeForCredentials: vi
        .fn()
        .mockResolvedValue({ id: 'emp-1', tokenInvalidAfter: null, deletedAt: null }),
      lockEmployeesForCredentials: vi.fn(
        async (_tx, employeeIds: readonly string[]) =>
          new Map(
            [...new Set(employeeIds)].map((employeeId) => [
              employeeId,
              { id: employeeId, tokenInvalidAfter: null, deletedAt: null },
            ])
          )
      ),
      revokeAllCredentials: vi.fn(
        async (
          employeeId: string,
          mutate?: (
            tx: MockPrismaService,
            locked: { id: string; tokenInvalidAfter: null; deletedAt: null }
          ) => Promise<unknown>,
          _relatedEmployeeIds: readonly string[] = [],
          beforeEmployeeLock?: (tx: MockPrismaService) => Promise<void>
        ) => {
          if (beforeEmployeeLock) await beforeEmployeeLock(mockPrisma);
          return {
            value: mutate
              ? await mutate(mockPrisma, {
                  id: employeeId,
                  tokenInvalidAfter: null,
                  deletedAt: null,
                })
              : undefined,
            tokenInvalidAfter: new Date(),
            revokedSessions: 1,
            revokedPats: 1,
          };
        }
      ),
    } as unknown as SessionsService;
    service = new UsersService(
      asPrismaService(mockPrisma),
      mockSessionsService,
      new EmployeePermissionCacheService()
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('普通管理员不能授予超出自身权限的角色', async () => {
      mockPrisma.role.findMany.mockResolvedValueOnce([
        {
          id: 'finance-role',
          code: 'FINANCE',
          permissions: [
            {
              module: 'finance',
              menu: 'ledger',
              view: true,
              create: false,
              edit: false,
              delete: false,
              export: false,
              approve: false,
              viewScope: 'SELF',
            },
          ],
        },
      ]);
      await expect(
        service.create(
          {
            username: 'target',
            password: 'Test@123',
            employeeId: 'emp-target',
            roleIds: ['finance-role'],
          } as Parameters<typeof service.create>[0],
          { id: 'actor', employeeId: 'actor' }
        )
      ).rejects.toThrow('不能分配超出当前账号权限范围的角色');
    });

    it('rejects the protected Employee ID and reserves username admin for it', async () => {
      await expect(
        service.create(
          {
            username: 'renamed',
            password: 'Test@123',
            employeeId: protectedEmployeeId,
            roleIds: [],
          } as Parameters<typeof service.create>[0],
          { id: 'actor', employeeId: 'actor' }
        )
      ).rejects.toThrow('受保护账号');

      await expect(
        service.create(
          {
            username: 'AdMiN',
            password: 'Test@123',
            employeeId: 'emp-target',
            roleIds: [],
          } as Parameters<typeof service.create>[0],
          { id: 'actor', employeeId: 'actor' }
        )
      ).rejects.toThrow('保留用户名');
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('rejects creating login credentials for a soft-deleted Employee owner', async () => {
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      vi.mocked(sessionsService.revokeAllCredentials).mockImplementationOnce(
        async (employeeId, mutate) => ({
          value: await mutate?.(mockPrisma as never, {
            id: employeeId,
            tokenInvalidAfter: null,
            deletedAt: new Date(),
          }),
          tokenInvalidAfter: new Date(),
          revokedSessions: 0,
          revokedPats: 0,
        })
      );

      await expect(
        service.create(
          {
            username: 'historical-owner',
            password: 'Test@123',
            employeeId: 'emp-deleted',
            roleIds: [],
          } as Parameters<typeof service.create>[0],
          { id: 'actor', employeeId: 'actor' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should hash password and update employee with login fields + roles', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-admin-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(null); // 重名校验通过
      mockPrisma.employee.update.mockResolvedValue(emp);

      await service.create(
        {
          username: 'newuser',
          password: 'Test@123',
          phone: '13800001111',
          employeeId: 'emp-admin-1',
          roleIds: [emp.userRoles[0]!.roleId],
        } as Parameters<typeof service.create>[0],
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-admin-1', deletedAt: null },
          data: expect.objectContaining({
            username: 'newuser',
            password: 'hashed-password',
            phone: '13800001111',
            canLogin: true,
            loginStatus: 'active',
          }),
        })
      );
      const auditCall = mockPrisma.operationLog.create.mock.calls[0]?.[0];
      expect(auditCall).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            module: 'security',
            action: 'create',
            target: 'emp-admin-1',
          }),
        })
      );
      expect(JSON.stringify(auditCall?.data.details)).not.toMatch(/password|hash|token/i);
    });

    it('fails the credential write when its in-transaction audit write fails', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-audit-fail' });
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.employee.update.mockResolvedValue(emp);
      mockPrisma.operationLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(
        service.create(
          {
            username: 'newuser',
            password: 'Test@123',
            employeeId: 'emp-audit-fail',
            roleIds: [],
          } as Parameters<typeof service.create>[0],
          { id: 'actor', employeeId: 'actor' }
        )
      ).rejects.toThrow('audit unavailable');
      expect(mockPrisma.employee.update).toHaveBeenCalledOnce();
    });

    it('should throw ConflictException when username already exists on another employee', async () => {
      const existing = buildEmployeeWithRoles({ username: 'duplicate' });
      mockPrisma.employee.findMany.mockResolvedValue([existing]);

      await expect(
        service.create(
          {
            username: 'duplicate',
            password: 'Test@123',
            employeeId: 'emp-target',
            roleIds: ['role-1'],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when phone already exists', async () => {
      const existing = buildEmployeeWithRoles({ username: 'other', phone: '13800001111' });
      mockPrisma.employee.findMany.mockResolvedValue([existing]);

      await expect(
        service.create(
          {
            username: 'newuser',
            password: 'Test@123',
            phone: '13800001111',
            employeeId: 'emp-target',
            roleIds: ['role-1'],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('rejects create when the new username matches another Employee phone, including soft-deleted history', async () => {
      const historicalOwner = buildEmployeeWithRoles({
        id: 'emp-history',
        username: 'old-user',
        phone: 'crosscolumn',
        deletedAt: new Date(),
      });
      mockPrisma.employee.findMany.mockResolvedValue([historicalOwner]);

      await expect(
        service.create(
          {
            username: 'crosscolumn',
            password: 'Test@123',
            employeeId: 'emp-target',
            roleIds: ['role-1'],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: 'emp-target' },
            OR: [{ username: 'crosscolumn' }, { phone: 'crosscolumn' }],
          }),
        })
      );
    });

    it('should not include password in the returned result', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.employee.update.mockResolvedValue(emp);

      const result = await service.create(
        {
          username: 'newuser',
          password: 'Test@123',
          employeeId: 'emp-1',
          roleIds: [emp.userRoles[0]!.roleId],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(result).not.toHaveProperty('password');
    });

    it('should flatten roles structure correctly', async () => {
      const role = buildRole({ id: 'role-1', name: '管理员', code: 'ADMIN' });
      const emp = {
        ...buildEmployeeWithRoles(),
        userRoles: [{ role: { ...role, permissions: [] }, roleId: role.id }],
      };
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      mockPrisma.employee.update.mockResolvedValue(emp);

      const result = await service.create(
        {
          username: 'newuser',
          password: 'Test@123',
          employeeId: 'emp-1',
          roleIds: ['role-1'],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(result.roles).toEqual([
        expect.objectContaining({ id: 'role-1', name: '管理员', code: 'ADMIN' }),
      ]);
    });
  });

  describe('findAll', () => {
    it('should return paginated employees with login', async () => {
      const employees = [buildEmployeeWithRoles(), buildEmployeeWithRoles()];
      mockPrisma.employee.findMany.mockResolvedValue(employees);
      mockPrisma.employee.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          where: expect.objectContaining({ deletedAt: null, username: { not: null } }),
        })
      );
    });

    it('should filter by keyword (OR on username, phone, email)', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.findAll({ keyword: '测试', page: 1, pageSize: 10 });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { username: { contains: '测试', mode: 'insensitive' } },
              { phone: { contains: '测试' } },
              { email: { contains: '测试', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });

    it('should filter by status (loginStatus)', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.findAll({ status: ['active'], page: 1, pageSize: 10 });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ loginStatus: { in: ['active'] } }),
        })
      );
    });

    it('should filter by roleId', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.findAll({ roleId: ['role-1'], page: 1, pageSize: 10 });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userRoles: { some: { roleId: { in: ['role-1'] } } },
          }),
        })
      );
    });

    it('should not include password in list results', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([buildEmployeeWithRoles()]);
      mockPrisma.employee.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10 });

      for (const item of result.items) {
        expect(item).not.toHaveProperty('password');
      }
    });

    it('should calculate pagination correctly for page 2', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, pageSize: 10 });

      expect(result.totalPages).toBe(3);
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
    });
  });

  describe('findAllForSelection', () => {
    it('should return slim fields for selection', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: 'e1', username: 'admin', phone: '138', name: '张三' },
      ]);

      const result = await service.findAllForSelection({});

      expect(result).toEqual([{ id: 'e1', username: 'admin', phone: '138', employeeName: '张三' }]);
    });
  });

  describe('findOne', () => {
    it('should return employee with role permissions', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      const result = await service.findOne('emp-1');

      expect(result).toBeDefined();
      expect(result.roles).toEqual([expect.objectContaining({ permissions: [] })]);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });

    it('should not include password in result', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      const result = await service.findOne('emp-1');
      expect(result).not.toHaveProperty('password');
    });
  });

  describe('findByUsername', () => {
    it('should find by username or phone', async () => {
      const emp = buildEmployeeWithRoles({ username: 'admin', phone: '13800001111' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      await service.findByUsername('admin');

      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: 'admin' }, { phone: 'admin' }],
          deletedAt: null,
        },
        include: { userRoles: { include: { role: { include: { permissions: true } } } } },
      });
    });
  });

  describe('update', () => {
    it('rejects a low-RBAC actor changing the protected employee', async () => {
      await expect(
        service.update(
          protectedEmployeeId,
          { username: 'changed', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'ordinary-actor', employeeId: 'ordinary-actor' }
        )
      ).rejects.toThrow('受保护账号');
      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('rejects renaming another account to admin', async () => {
      await expect(
        service.update(
          'emp-target',
          { username: ' admin ', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'ordinary-actor', employeeId: 'ordinary-actor' }
        )
      ).rejects.toThrow('保留用户名');
      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it('should update with optimistic lock (version where + increment)', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst
        .mockResolvedValueOnce(emp) // findOne check
        .mockResolvedValueOnce(null); // 唯一性校验通过
      mockPrisma.employee.update.mockResolvedValue({ ...emp, version: 2 });

      await service.update(
        'emp-1',
        { username: 'updated', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1', deletedAt: null, version: 1 },
          data: expect.objectContaining({
            username: 'updated',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('rejects identifier changes when the locked Employee was concurrently soft-deleted', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      vi.mocked(sessionsService.lockEmployeesForCredentials).mockResolvedValueOnce(
        new Map([
          ['emp-1', { id: 'emp-1', tokenInvalidAfter: null, deletedAt: new Date() }],
          ['emp-admin-1', { id: 'emp-admin-1', tokenInvalidAfter: null, deletedAt: null }],
        ])
      );

      await expect(
        service.update(
          'emp-1',
          { username: 'released-name', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'admin-1', employeeId: 'emp-admin-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should check username uniqueness excluding self', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      const conflicting = buildEmployeeWithRoles({ id: 'emp-2', username: 'taken' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.findMany.mockResolvedValue([conflicting]);

      await expect(
        service.update('emp-1', { username: 'taken' } as Parameters<typeof service.update>[1], {
          id: 'emp-1',
          employeeId: 'emp-1',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('rejects update when the new phone matches another Employee username', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      const conflicting = buildEmployeeWithRoles({ id: 'emp-2', username: '13800001111' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.findMany.mockResolvedValue([conflicting]);

      await expect(
        service.update(
          'emp-1',
          { phone: '13800001111', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'admin-1', employeeId: 'emp-admin-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should reset roles when roleIds provided (deleteMany + create)', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);

      await service.update(
        'emp-1',
        { roleIds: ['role-a', 'role-b'], version: 1 } as Parameters<typeof service.update>[1],
        { id: 'emp-1', employeeId: 'emp-1' }
      );

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userRoles: {
              deleteMany: {},
              create: [{ roleId: 'role-a' }, { roleId: 'role-b' }],
            },
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      const prismaError = new PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.employee.update.mockRejectedValue(prismaError);

      await expect(
        service.update('emp-1', { version: 1 } as Parameters<typeof service.update>[1], {
          id: 'emp-1',
          employeeId: 'emp-1',
        })
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update('emp-1', { version: 1 } as Parameters<typeof service.update>[1], {
          id: 'emp-1',
          employeeId: 'emp-1',
        })
      ).rejects.toThrow('DB connection lost');
    });

    // admin 在「系统-用户管理」编辑表单中重置他人密码的路径
    // 与 changePassword() 副作用对齐：bcrypt hash + tokenInvalidAfter + 吊销所有 sessions
    it('should hash password and write tokenInvalidAfter when admin resets password', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);

      await service.update(
        'emp-1',
        { password: 'NewPass@123', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ password: 'hashed-password' }),
        })
      );
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      expect(sessionsService.revokeAllCredentials).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Function),
        ['emp-admin-1']
      );
    });

    it('should NOT touch password when admin omits it from edit form', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst
        .mockResolvedValueOnce(emp) // findOne
        .mockResolvedValueOnce(null); // 唯一性
      mockPrisma.employee.update.mockResolvedValue(emp);

      await service.update(
        'emp-1',
        { username: 'edited-only', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      const updateCall = mockPrisma.employee.update.mock.calls[0]?.[0];
      expect(updateCall?.data).not.toHaveProperty('password');
      expect(updateCall?.data).not.toHaveProperty('tokenInvalidAfter');
    });

    it('should clear lock fields when admin activates user from edit form', async () => {
      const emp = buildEmployeeWithRoles({
        id: 'emp-1',
        loginStatus: 'locked',
        loginFailCount: 5,
        lockUntil: new Date(Date.now() + 30 * 60 * 1000),
      });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue({ ...emp, loginStatus: 'active' });

      await service.update(
        'emp-1',
        { status: 'active', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            loginStatus: 'active',
            canLogin: true,
            loginFailCount: 0,
            lockUntil: null,
          }),
        })
      );
    });

    it('should revoke all sessions when admin resets password', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      const revokeSpy = vi.spyOn(sessionsService, 'revokeAllCredentials');

      await service.update(
        'emp-1',
        { password: 'NewPass@123', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'admin-1', employeeId: 'emp-admin-1' }
      );

      expect(revokeSpy).toHaveBeenCalledWith('emp-1', expect.any(Function), ['emp-admin-1']);
    });
  });

  describe('remove', () => {
    it('rejects removal of the protected employee', async () => {
      await expect(
        service.remove(protectedEmployeeId, {
          id: 'ordinary-actor',
          employeeId: 'ordinary-actor',
        })
      ).rejects.toThrow('受保护账号');
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should soft delete by setting deletedAt, disabling login and revoking tokens', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);

      await service.remove('emp-1', { id: 'admin-1', employeeId: 'emp-admin-1' });

      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1', deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          canLogin: false,
          loginStatus: 'disabled',
          version: { increment: 1 },
        }),
      });
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      expect(sessionsService.revokeAllCredentials).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Function),
        ['emp-admin-1'],
        expect.any(Function)
      );
      expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-1'
      );
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employee.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('rejects status changes for the protected employee', async () => {
      await expect(
        service.updateStatus(protectedEmployeeId, 'disabled', {
          id: 'ordinary-actor',
          employeeId: 'ordinary-actor',
        })
      ).rejects.toThrow('受保护账号');
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('rejects reactivating an Employee that was soft-deleted after the preflight read', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      vi.mocked(sessionsService.lockEmployeesForCredentials).mockResolvedValueOnce(
        new Map([
          ['emp-1', { id: 'emp-1', tokenInvalidAfter: null, deletedAt: new Date() }],
          ['emp-admin-1', { id: 'emp-admin-1', tokenInvalidAfter: null, deletedAt: null }],
        ])
      );

      await expect(
        service.updateStatus('emp-1', 'active', {
          id: 'admin-1',
          employeeId: 'emp-admin-1',
        })
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should write tokenInvalidAfter when disabling user', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);

      await service.updateStatus('emp-1', 'disabled', {
        id: 'admin-1',
        employeeId: 'emp-admin-1',
      });

      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1', deletedAt: null },
        data: expect.objectContaining({
          loginStatus: 'disabled',
          canLogin: false,
        }),
      });
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      expect(sessionsService.revokeAllCredentials).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Function),
        ['emp-admin-1']
      );
    });

    it('should NOT write tokenInvalidAfter when activating user', async () => {
      const emp = buildEmployeeWithRoles({
        id: 'emp-1',
        loginStatus: 'locked',
        loginFailCount: 5,
        lockUntil: new Date(Date.now() + 30 * 60 * 1000),
      });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue({ ...emp, loginStatus: 'active' });

      await service.updateStatus('emp-1', 'active', {
        id: 'admin-1',
        employeeId: 'emp-admin-1',
      });

      const updateCall = mockPrisma.employee.update.mock.calls[0]?.[0];
      expect(updateCall?.data).toEqual(
        expect.objectContaining({
          loginStatus: 'active',
          canLogin: true,
          loginFailCount: 0,
          lockUntil: null,
        })
      );
      // 启用账号不应该踢掉正在使用的合法 token
      expect(updateCall?.data).not.toHaveProperty('tokenInvalidAfter');
    });
  });

  describe('changePassword', () => {
    it('rejects password changes when the locked Employee was already soft-deleted', async () => {
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      vi.mocked(sessionsService.revokeAllCredentials).mockImplementationOnce(
        async (employeeId, mutate) => ({
          value: await mutate?.(mockPrisma as never, {
            id: employeeId,
            tokenInvalidAfter: null,
            deletedAt: new Date(),
          }),
          tokenInvalidAfter: new Date(),
          revokedSessions: 0,
          revokedPats: 0,
        })
      );

      await expect(service.changePassword('emp-1', 'old', 'new')).rejects.toThrow(
        NotFoundException
      );
      expect(mockPrisma.employee.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should update password and write tokenInvalidAfter when current password is correct', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findUnique.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);

      const result = await service.changePassword('emp-1', 'OldPass@123', 'NewPass@123');

      expect(result).toEqual({ success: true });
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1', deletedAt: null },
        data: { password: 'hashed-password', version: { increment: 1 } },
      });
      const sessionsService = (service as unknown as { sessionsService: SessionsService })
        .sessionsService;
      expect(sessionsService.revokeAllCredentials).toHaveBeenCalledWith(
        'emp-1',
        expect.any(Function)
      );
    });

    it('should invalidate auth cache after password change', async () => {
      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findUnique.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);
      const spy = vi.spyOn(
        service as unknown as { invalidateAuthCache: (id: string) => void },
        'invalidateAuthCache'
      );

      await service.changePassword('emp-1', 'OldPass@123', 'NewPass@123');

      expect(spy).toHaveBeenCalledWith('emp-1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue(null);

      await expect(service.changePassword('non-exist', 'old', 'new')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw ConflictException when current password is wrong', async () => {
      const { compare } = await import('bcryptjs');
      (compare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const emp = buildEmployeeWithRoles({ id: 'emp-1' });
      mockPrisma.employee.findUnique.mockResolvedValue(emp);

      await expect(service.changePassword('emp-1', 'WrongPass', 'NewPass@123')).rejects.toThrow(
        ConflictException
      );
    });
  });
});
