import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { EmployeePermissionCacheService } from '../../../common/services/employee-permission-cache.service';
import { buildDepartment, buildEmployee } from '../../../test/factories';
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
import { SessionsService } from '../../sessions/sessions.service';
import { EmployeesService } from '../employees.service';

function buildEmployeeWithDepts(
  overrides = {},
  departments: Array<{ id: string; name: string; isPrimary: boolean }> = []
) {
  const emp = buildEmployee(overrides);
  return {
    ...emp,
    user: null,
    departments: departments.map((d, i) => ({
      id: `ed-${i}`,
      employeeId: emp.id,
      departmentId: d.id,
      isPrimary: d.isPrimary,
      sortOrder: i,
      createdBy: null,
      department: { id: d.id, name: d.name },
    })),
  };
}

describe('EmployeesService', () => {
  let service: EmployeesService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };
  let authCache: EmployeePermissionCacheService;
  let sessionsService: SessionsService;

  beforeEach(() => {
    process.env.SUPER_ADMIN_EMPLOYEE_ID = '9f1f2538-86b0-4b69-901d-fb6cc9d38d9a';
    mockPrisma = createMockPrismaService();
    mockPrisma.employee.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: 'emp-1', tokenInvalidAfter: null, deletedAt: null },
    ]);
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.personalAccessToken.updateMany.mockResolvedValue({ count: 0 });
    mockSerialNumber = createMockSerialNumberService('YG');

    mockFilterApplier = {
      // 透传 baseWhere 以便 departmentId 等 baseWhere 字段能被 findMany 观察到
      buildWhere: vi.fn(async ({ baseWhere }) => baseWhere),
    };

    authCache = new EmployeePermissionCacheService();
    vi.spyOn(authCache, 'invalidateMany');
    vi.spyOn(authCache, 'invalidateByPrefix');
    sessionsService = new SessionsService(asPrismaService(mockPrisma));

    service = new EmployeesService(
      asPrismaService(mockPrisma),
      asSerialNumberService(mockSerialNumber),
      mockFilterApplier as unknown as FilterApplierService,
      authCache,
      sessionsService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated employees', async () => {
      const items = [buildEmployeeWithDepts()];
      mockPrisma.employee.findMany.mockResolvedValue(items);
      mockPrisma.employee.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.findAll({ keyword: '张三', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '张三' })
      );
    });

    it('should apply departmentId in baseWhere via M2M relation', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.findAll({ departmentId: 'dept-1', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          baseWhere: expect.objectContaining({
            departments: { some: { departmentId: 'dept-1' } },
          }),
        })
      );
    });

    it('should forward status to FilterApplier (legacyFilters)', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.count.mockResolvedValue(0);

      await service.findAll({ status: ['active'], page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ status: ['active'] }),
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return employee with departments', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1' }, [
        { id: 'dept-1', name: '技术部', isPrimary: true },
      ]);
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      const result = await service.findOne('emp-1');

      expect(result).toBeDefined();
      expect(result.departments).toHaveLength(1);
      expect(result.primaryDepartment).toBeDefined();
      expect(result.primaryDepartment?.departmentName).toBe('技术部');
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create employee with serial number', async () => {
      const emp = buildEmployeeWithDepts();
      mockPrisma.employee.create.mockResolvedValue(emp);
      // create 现在事务内 create(select id)，事务外统一 findOne 重查返回完整 DTO
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      const result = await service.create(
        { name: '新员工' } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.employee.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: '新员工',
          }),
        })
      );
    });

    it('rejects create when phone matches another Employee username across columns', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        buildEmployeeWithDepts({ id: 'emp-owner', username: '13800001111', phone: null }),
      ]);

      await expect(
        service.create(
          { name: '新员工', phone: '13800001111' } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.employee.create).not.toHaveBeenCalled();
    });

    it('should sync departments when departmentIds provided', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-new' });
      mockPrisma.employee.create.mockResolvedValue(emp);

      // syncEmployeeDepartments 内部调用
      mockPrisma.employeeDepartment.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.department.findMany.mockResolvedValue([
        buildDepartment({ id: 'dept-1' }),
        buildDepartment({ id: 'dept-2' }),
      ]);
      mockPrisma.employeeDepartment.createMany.mockResolvedValue({ count: 2 });

      // findOne 重新查询
      mockPrisma.employee.findFirst.mockResolvedValue(
        buildEmployeeWithDepts({ id: 'emp-new' }, [
          { id: 'dept-1', name: '部门1', isPrimary: true },
          { id: 'dept-2', name: '部门2', isPrimary: false },
        ])
      );

      const result = await service.create(
        {
          name: '新员工',
          departmentIds: ['dept-1', 'dept-2'],
          primaryDepartmentId: 'dept-1',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.departments).toHaveLength(2);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-new'
      );
      expect(mockPrisma.employeeDepartment.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.employeeDepartment.createMany).toHaveBeenCalled();
    });
  });

  describe('syncEmployeeDepartments (via create/update)', () => {
    it('should throw BadRequestException when some departments do not exist', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1' });
      mockPrisma.employee.create.mockResolvedValue(emp);
      mockPrisma.employeeDepartment.deleteMany.mockResolvedValue({ count: 0 });

      // 只找到 1 个部门，但传了 2 个 ID
      mockPrisma.department.findMany.mockResolvedValue([buildDepartment({ id: 'dept-1' })]);

      await expect(
        service.create(
          {
            name: '员工',
            departmentIds: ['dept-1', 'dept-not-exist'],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should default primary to first department if primaryDepartmentId not in list', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1' });
      mockPrisma.employee.create.mockResolvedValue(emp);
      mockPrisma.employeeDepartment.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.department.findMany.mockResolvedValue([buildDepartment({ id: 'dept-1' })]);
      mockPrisma.employeeDepartment.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(
        buildEmployeeWithDepts({ id: 'emp-1' }, [{ id: 'dept-1', name: '部门1', isPrimary: true }])
      );

      await service.create(
        {
          name: '员工',
          departmentIds: ['dept-1'],
          primaryDepartmentId: 'dept-not-in-list',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.employeeDepartment.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ departmentId: 'dept-1', isPrimary: true }),
        ]),
      });
    });
  });

  describe('update', () => {
    it('rejects the protected employee even when the service is called directly', async () => {
      const protectedId = process.env.SUPER_ADMIN_EMPLOYEE_ID as string;

      await expect(
        service.update(
          protectedId,
          { name: '不得修改', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should update employee with version check', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue({ ...emp, version: 2 });

      await service.update(
        'emp-1',
        { name: '更新名称', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp-1', deletedAt: null, version: 1 },
          data: expect.objectContaining({
            name: '更新名称',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('locks the Employee row, then rejects phone matching another Employee username', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.findMany.mockResolvedValue([
        buildEmployeeWithDepts({ id: 'emp-owner', username: '13800001111', phone: null }),
      ]);

      await expect(
        service.update(
          'emp-1',
          { phone: '13800001111', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPrisma.$executeRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employee.findMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('should lock before rebuilding departments and keep one fallback primary', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue({ ...emp, version: 2 });
      mockPrisma.department.findMany.mockResolvedValue([
        buildDepartment({ id: 'dept-2' }),
        buildDepartment({ id: 'dept-1' }),
      ]);
      mockPrisma.employeeDepartment.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.employeeDepartment.createMany.mockResolvedValue({ count: 2 });

      await service.update(
        'emp-1',
        {
          departmentIds: ['dept-2', 'dept-1'],
          primaryDepartmentId: 'missing-primary',
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-1'
      );
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.employeeDepartment.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ departmentId: 'dept-2', isPrimary: true, sortOrder: 0 }),
          expect.objectContaining({ departmentId: 'dept-1', isPrimary: false, sortOrder: 1 }),
        ],
      });
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employee.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employeeDepartment.deleteMany.mock.invocationCallOrder[0] ??
          Number.POSITIVE_INFINITY
      );
    });

    it('should allow an empty department list and leave zero relations', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue({ ...emp, version: 2 });
      mockPrisma.employeeDepartment.deleteMany.mockResolvedValue({ count: 2 });

      await service.update(
        'emp-1',
        { departmentIds: [], version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalledOnce();
      expect(mockPrisma.employeeDepartment.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(mockPrisma.employeeDepartment.createMany).not.toHaveBeenCalled();
    });

    it('does not write DingTalk identity fields even if a direct caller bypasses DTO validation', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1', version: 1, dingtalkUserId: null });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue({ ...emp, version: 2 });

      await service.update(
        'emp-1',
        {
          name: '普通资料更新',
          dingtalkUserId: 'forbidden-user-id',
          dingtalkUnionId: 'forbidden-union-id',
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      const data = mockPrisma.employee.update.mock.calls[0]?.[0]?.data;
      expect(data).not.toHaveProperty('dingtalkUserId');
      expect(data).not.toHaveProperty('dingtalkUnionId');
    });

    it('should throw ConflictException on P2025', async () => {
      const emp = buildEmployeeWithDepts({ id: 'emp-1', version: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(emp);

      const prismaError = new PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.employee.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'emp-1',
          { name: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('DingTalk binding', () => {
    const actor = { id: 'employee-admin', employeeId: 'employee-admin' };
    const expectedBinding = {
      expectedDingtalkUserId: 'ding-user-old',
      expectedDingtalkUnionId: 'ding-union-old',
    };
    const bindBody = {
      version: 3,
      ...expectedBinding,
      dingtalkUserId: 'ding-user-new',
      dingtalkUnionId: 'ding-union-new',
    };
    const unbindBody = { version: 3, ...expectedBinding };

    function mockSuccessfulReplacement(overrides: Record<string, unknown>) {
      const responseEmployee = buildEmployeeWithDepts({
        id: 'emp-1',
        version: 4,
        ...overrides,
        tokenInvalidAfter: new Date('2026-08-24T06:00:00.000Z'),
      });
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.personalAccessToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.employee.findFirst.mockResolvedValue(responseEmployee);
      return responseEmployee;
    }

    it('binds a complete pair with expected-old CAS, audit, active=true, and version+1', async () => {
      mockSuccessfulReplacement({
        dingtalkUserId: bindBody.dingtalkUserId,
        dingtalkUnionId: bindBody.dingtalkUnionId,
        dingtalkActive: true,
      });

      const result = await service.bindDingtalk('emp-1', bindBody, actor);

      expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'emp-1',
          version: 3,
          deletedAt: null,
          dingtalkUserId: 'ding-user-old',
          dingtalkUnionId: 'ding-union-old',
        },
        data: {
          dingtalkUserId: 'ding-user-new',
          dingtalkUnionId: 'ding-union-new',
          dingtalkActive: true,
          tokenInvalidAfter: expect.any(Date),
          updaterEmployeeId: 'employee-admin',
          version: { increment: 1 },
        },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: 'emp-1',
          version: 4,
          dingtalkUserId: 'ding-user-new',
          dingtalkUnionId: 'ding-union-new',
          dingtalkActive: true,
        })
      );
      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({
        data: {
          employeeId: 'employee-admin',
          module: 'security',
          action: 'bind',
          target: 'emp-1',
          details: {
            oldPair: {
              dingtalkUserId: 'ding-user-old',
              dingtalkUnionId: 'ding-union-old',
            },
            newPair: {
              dingtalkUserId: 'ding-user-new',
              dingtalkUnionId: 'ding-union-new',
            },
            version: { from: 3, to: 4 },
          },
        },
      });
      expect(JSON.stringify(mockPrisma.operationLog.create.mock.calls[0]?.[0])).not.toMatch(
        /password|hash|token/i
      );
      expect(authCache.invalidateMany).toHaveBeenCalledOnce();
    });

    it('locks employeeId plus normalized old/new identity keys in fixed sorted order before checks', async () => {
      mockSuccessfulReplacement({
        dingtalkUserId: 'ding-user-new',
        dingtalkUnionId: 'ding-union-new',
        dingtalkActive: true,
      });

      await service.bindDingtalk(
        'emp-1',
        {
          ...bindBody,
          expectedDingtalkUserId: ' ding-user-old ',
          expectedDingtalkUnionId: ' ding-union-old ',
          dingtalkUserId: ' ding-user-new ',
          dingtalkUnionId: ' ding-union-new ',
        },
        actor
      );

      const lockKeys = mockPrisma.$executeRaw.mock.calls.map((call) => call[1]);
      expect(lockKeys).toEqual([
        'employee_dingtalk:employee:emp-1',
        'employee_dingtalk:union:ding-union-new',
        'employee_dingtalk:union:ding-union-old',
        'employee_dingtalk:user:ding-user-new',
        'employee_dingtalk:user:ding-user-old',
      ]);
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPrisma.employee.findMany.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('locks Employee after identity keys and advances the credential boundary monotonically', async () => {
      const previousBoundary = new Date(Date.now() + 60_000);
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'emp-1', tokenInvalidAfter: previousBoundary, deletedAt: null },
      ]);
      mockSuccessfulReplacement({
        dingtalkUserId: 'ding-user-new',
        dingtalkUnionId: 'ding-union-new',
        dingtalkActive: true,
      });

      await service.bindDingtalk('emp-1', bindBody, actor);

      const nextBoundary = new Date(previousBoundary.getTime() + 1);
      expect(mockPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { tokenInvalidAfter: nextBoundary },
      });
      expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tokenInvalidAfter: nextBoundary }),
        })
      );
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPrisma.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employee.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('unbinds only with the expected old pair and sets active=false', async () => {
      mockSuccessfulReplacement({
        dingtalkUserId: null,
        dingtalkUnionId: null,
        dingtalkActive: false,
      });

      const result = await service.unbindDingtalk('emp-1', unbindBody, actor);

      expect(mockPrisma.employee.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'emp-1',
            version: 3,
            dingtalkUserId: 'ding-user-old',
            dingtalkUnionId: 'ding-union-old',
          }),
          data: expect.objectContaining({
            dingtalkUserId: null,
            dingtalkUnionId: null,
            dingtalkActive: false,
            version: { increment: 1 },
          }),
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          dingtalkUserId: undefined,
          dingtalkUnionId: undefined,
          dingtalkActive: false,
        })
      );
    });

    it('maps a stale expected old pair to 409 and rolls back in-transaction credential revocation', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.employee.findUnique.mockResolvedValue({ version: 3, deletedAt: null });

      await expect(service.bindDingtalk('emp-1', bindBody, actor)).rejects.toThrow(
        ConflictException
      );
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(mockPrisma.personalAccessToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { employeeId: 'emp-1', revokedAt: null } })
      );
      expect(authCache.invalidateMany).not.toHaveBeenCalled();
    });

    it('rejects a userId occupied by another employee, including soft-deleted rows', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-deleted',
          name: '已删员工',
          deletedAt: new Date(),
          dingtalkActive: false,
          dingtalkUserId: 'ding-user-new',
          dingtalkUnionId: null,
        },
      ]);

      await expect(service.bindDingtalk('emp-1', bindBody, actor)).rejects.toThrow(
        '钉钉用户ID已被员工'
      );
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { not: 'emp-1' },
            OR: [{ dingtalkUserId: 'ding-user-new' }, { dingtalkUnionId: 'ding-union-new' }],
          },
        })
      );
      expect(mockPrisma.employee.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a unionId occupied by another employee', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-other',
          name: '其他员工',
          deletedAt: null,
          dingtalkActive: true,
          dingtalkUserId: null,
          dingtalkUnionId: 'ding-union-new',
        },
      ]);

      await expect(service.bindDingtalk('emp-1', bindBody, actor)).rejects.toThrow(
        '钉钉UnionId已被员工'
      );
      expect(mockPrisma.employee.updateMany).not.toHaveBeenCalled();
    });

    it.each(['P2002', 'P2025'] as const)('maps Prisma %s to 409', async (code) => {
      mockPrisma.employee.findMany.mockResolvedValue([]);
      mockPrisma.employee.updateMany.mockRejectedValue(
        new PrismaClientKnownRequestError('', { code, clientVersion: '0' })
      );

      await expect(service.bindDingtalk('emp-1', bindBody, actor)).rejects.toThrow(
        ConflictException
      );
      expect(authCache.invalidateMany).not.toHaveBeenCalled();
    });

    it('keeps identity, audit, and credential revocation in one transaction', async () => {
      mockSuccessfulReplacement({
        dingtalkUserId: 'ding-user-new',
        dingtalkUnionId: 'ding-union-new',
        dingtalkActive: true,
      });
      mockPrisma.session.deleteMany.mockRejectedValue(new Error('session revoke failed'));

      await expect(service.bindDingtalk('emp-1', bindBody, actor)).rejects.toThrow(
        'session revoke failed'
      );
      expect(mockPrisma.employee.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.personalAccessToken.updateMany).not.toHaveBeenCalled();
      expect(authCache.invalidateMany).not.toHaveBeenCalled();
    });

    it('rejects the binding when its transactional security audit write fails', async () => {
      mockSuccessfulReplacement({
        dingtalkUserId: 'ding-user-new',
        dingtalkUnionId: 'ding-union-new',
        dingtalkActive: true,
      });
      mockPrisma.operationLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(service.bindDingtalk('emp-1', bindBody, actor)).rejects.toThrow(
        'audit unavailable'
      );
      expect(mockPrisma.employee.updateMany).toHaveBeenCalledOnce();
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledOnce();
      expect(mockPrisma.personalAccessToken.updateMany).toHaveBeenCalledOnce();
      expect(authCache.invalidateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const actor = { id: 'user-1', employeeId: 'emp-user-1' };

    function mockCredentialLock(employeeId = 'emp-1') {
      mockPrisma.$queryRaw.mockResolvedValue([
        { id: employeeId, tokenInvalidAfter: new Date('2026-08-24T00:00:00.000Z') },
      ]);
    }

    it('rejects the protected employee even when the service is called directly', async () => {
      const protectedId = process.env.SUPER_ADMIN_EMPLOYEE_ID as string;

      await expect(service.remove(protectedId, actor)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });

    it('soft deletes, audits, and revokes Session/PAT credentials in the locked transaction', async () => {
      const emp = { ...buildEmployee({ id: 'emp-1', version: 4 }), user: null };
      mockCredentialLock();
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);
      mockPrisma.operationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.personalAccessToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.remove('emp-1', actor);

      expect(result).toEqual({ message: '删除成功' });
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-1'
      );
      expect(mockPrisma.employee.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'emp-1', deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          canLogin: false,
          loginStatus: 'disabled',
          updaterEmployeeId: 'emp-user-1',
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: 'emp-user-1',
          module: 'security',
          action: 'remove',
          target: 'emp-1',
          details: expect.objectContaining({
            status: 'disabled',
            version: { from: 4, to: 5 },
          }),
        }),
      });
      expect(mockPrisma.employee.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'emp-1' },
        data: { tokenInvalidAfter: expect.any(Date) },
      });
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
      });
      expect(mockPrisma.personalAccessToken.updateMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      const order = (mock: ReturnType<typeof vi.fn>, call = 0) =>
        mock.mock.invocationCallOrder[call] ?? Number.POSITIVE_INFINITY;
      expect(order(mockPrisma.$executeRaw)).toBeLessThan(order(mockPrisma.$queryRaw));
      expect(order(mockPrisma.$queryRaw, 1)).toBeLessThan(order(mockPrisma.employee.findFirst));
      expect(order(mockPrisma.employee.findFirst)).toBeLessThan(order(mockPrisma.employee.update));
      expect(order(mockPrisma.employee.update)).toBeLessThan(order(mockPrisma.operationLog.create));
      expect(order(mockPrisma.operationLog.create)).toBeLessThan(
        order(mockPrisma.employee.update, 1)
      );
      expect(order(mockPrisma.employee.update, 1)).toBeLessThan(
        order(mockPrisma.session.deleteMany)
      );
      expect(order(mockPrisma.employee.update, 1)).toBeLessThan(
        order(mockPrisma.personalAccessToken.updateMany)
      );
    });

    it('propagates an audit failure so the enclosing delete transaction rolls back', async () => {
      const emp = buildEmployee({ id: 'emp-1', version: 2 });
      mockCredentialLock();
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);
      mockPrisma.operationLog.create.mockRejectedValue(new Error('audit unavailable'));

      await expect(service.remove('emp-1', actor)).rejects.toThrow('audit unavailable');
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      expect(mockPrisma.employee.update).toHaveBeenCalledOnce();
      expect(mockPrisma.session.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.personalAccessToken.updateMany).not.toHaveBeenCalled();
      expect(authCache.invalidateMany).not.toHaveBeenCalled();
    });

    it('propagates credential revocation failure after audit so all writes roll back together', async () => {
      const emp = buildEmployee({ id: 'emp-1', version: 2 });
      mockCredentialLock();
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employee.update.mockResolvedValue(emp);
      mockPrisma.operationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.personalAccessToken.updateMany.mockRejectedValue(new Error('PAT revoke failed'));

      await expect(service.remove('emp-1', actor)).rejects.toThrow('PAT revoke failed');
      expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
      expect(mockPrisma.operationLog.create).toHaveBeenCalledOnce();
      expect(mockPrisma.employee.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.session.deleteMany).toHaveBeenCalledOnce();
      expect(mockPrisma.personalAccessToken.updateMany).toHaveBeenCalledOnce();
      expect(authCache.invalidateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException after the Employee lock when the target was already deleted', async () => {
      mockCredentialLock('non-exist');
      mockPrisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.remove('non-exist', actor)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.$queryRaw.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employee.findFirst.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    });
  });

  // push 6: linkUser/unlinkUser 已移除（user 表已删，登录字段直接挂在 employee 上）

  describe('findAllForSelection', () => {
    it('should return employees for dropdown with default active loginStatus', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([
        { id: '1', name: '员工A', serialNumber: 'YG001' },
      ]);

      const result = await service.findAllForSelection({});

      expect(result).toHaveLength(1);
      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ loginStatus: 'active' }),
        })
      );
    });

    it('should respect explicit loginStatus override', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ loginStatus: 'disabled' });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ loginStatus: 'disabled' }),
        })
      );
    });

    it('should filter by roleCodes when provided', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ roleCodes: ['PM', 'DEVELOPER'] });

      expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userRoles: { some: { role: { code: { in: ['PM', 'DEVELOPER'] } } } },
          }),
        })
      );
    });

    it('should NOT add roleCodes filter when array is empty', async () => {
      mockPrisma.employee.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ roleCodes: [] });

      const callArg = mockPrisma.employee.findMany.mock.calls[0]?.[0];
      expect(callArg?.where).not.toHaveProperty('userRoles');
    });
  });
});
