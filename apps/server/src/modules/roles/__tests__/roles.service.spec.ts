import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { EmployeePermissionCacheService } from '../../../common/services/employee-permission-cache.service';
import { buildRole } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { RolesService } from '../roles.service';

describe('RolesService', () => {
  let service: RolesService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    mockPrisma.userRole.findMany.mockResolvedValue([]);
    mockPrisma.employee.findUnique.mockResolvedValue({
      userRoles: [
        {
          role: {
            permissions: [
              {
                module: 'customers',
                menu: 'customers',
                view: true,
                create: true,
                edit: true,
                delete: true,
                export: true,
                approve: true,
                viewScope: 'ALL',
              },
              {
                module: 'orders',
                menu: 'orders',
                view: true,
                create: true,
                edit: true,
                delete: true,
                export: true,
                approve: true,
                viewScope: 'ALL',
              },
            ],
          },
        },
      ],
    });
    service = new RolesService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService,
      new EmployeePermissionCacheService()
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a role with permission associations', async () => {
      const permissions = [
        {
          module: 'customers',
          menu: 'customers',
          view: true,
          create: true,
          edit: false,
          delete: false,
          export: false,
          approve: false,
        },
        {
          module: 'customers',
          menu: 'customers',
          view: true,
          create: false,
          edit: true,
          delete: false,
          export: false,
          approve: false,
        },
      ];
      const role = buildRole({ code: 'ADMIN' });
      mockPrisma.role.findUnique.mockResolvedValue(null);
      mockPrisma.role.create.mockResolvedValue({ ...role, permissions });

      const result = await service.create(
        { name: '管理员', code: 'ADMIN', permissions } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(mockPrisma.role.findUnique).toHaveBeenCalledWith({ where: { code: 'ADMIN' } });
      expect(mockPrisma.role.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          code: 'ADMIN',
          permissions: { create: permissions },
        }),
        include: {
          permissions: true,
          users: {
            where: { employee: { deletedAt: null, loginStatus: 'active', canLogin: true } },
            select: { employeeId: true },
          },
        },
      });
    });

    it('should throw ConflictException when code already exists', async () => {
      const existing = buildRole({ code: 'ADMIN' });
      mockPrisma.role.findUnique.mockResolvedValue(existing);

      await expect(
        service.create(
          { name: '管理员', code: 'ADMIN', permissions: [] } as Parameters<
            typeof service.create
          >[0],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.role.create).not.toHaveBeenCalled();
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated roles with userCount', async () => {
      const rolesWithCount = [
        {
          ...buildRole(),
          permissions: [],
          users: [{ employeeId: 'emp-1' }, { employeeId: 'emp-2' }, { employeeId: 'emp-3' }],
        },
        { ...buildRole(), permissions: [], users: [] },
      ];
      mockPrisma.role.findMany.mockResolvedValue(rolesWithCount);
      mockPrisma.role.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 10 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0]!.userCount).toBe(3);
      expect(result.items[1]!.userCount).toBe(0);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            permissions: true,
            users: {
              where: { employee: { deletedAt: null, loginStatus: 'active', canLogin: true } },
              select: { employeeId: true },
            },
          },
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.findAll({ keyword: 'admin', page: 1, pageSize: 10 });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: 'admin' })
      );
    });

    it('should forward status to FilterApplier (legacyFilters)', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.findAll({ status: 'active', page: 1, pageSize: 10 });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ status: 'active' }),
        })
      );
    });

    it('should exclude soft-deleted records', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10 });

      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        })
      );
      expect(mockPrisma.role.count).toHaveBeenCalledWith({
        where: expect.objectContaining({ deletedAt: null }),
      });
    });
  });

  // ─── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return role with permissions', async () => {
      const role = buildRole({ id: 'role-1' });
      const permissions = [{ id: 'perm-1', resource: 'customers', action: 'read' }];
      mockPrisma.role.findFirst.mockResolvedValue({ ...role, permissions });

      const result = await service.findOne('role-1');

      expect(result).toBeDefined();
      expect(mockPrisma.role.findFirst).toHaveBeenCalledWith({
        where: { id: 'role-1', deletedAt: null },
        include: {
          permissions: true,
          users: {
            where: { employee: { deletedAt: null, loginStatus: 'active', canLogin: true } },
            select: { employeeId: true },
          },
        },
      });
    });

    it('should throw NotFoundException when role does not exist', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update role with optimistic lock (version where + increment)', async () => {
      const existing = buildRole({ id: 'role-1', version: 2 });
      mockPrisma.role.findFirst.mockResolvedValue({ ...existing, permissions: [] });
      mockPrisma.role.update.mockResolvedValue({ ...existing, version: 3, permissions: [] });

      await service.update(
        'role-1',
        { name: '新名称', version: 2 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.role.update).toHaveBeenCalledWith({
        where: { id: 'role-1', version: 2 },
        data: expect.objectContaining({
          name: '新名称',
          version: { increment: 1 },
        }),
        include: {
          permissions: true,
          users: {
            where: { employee: { deletedAt: null, loginStatus: 'active', canLogin: true } },
            select: { employeeId: true },
          },
        },
      });
    });

    it('should throw ConflictException when code is used by another role', async () => {
      const existing = buildRole({ id: 'role-1' });
      const conflicting = buildRole({ id: 'role-2', code: 'TAKEN' });
      mockPrisma.role.findFirst
        .mockResolvedValueOnce({ ...existing, permissions: [] }) // findOne
        .mockResolvedValueOnce(conflicting); // code uniqueness check

      await expect(
        service.update(
          'role-1',
          { code: 'TAKEN', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.role.update).not.toHaveBeenCalled();
    });

    it('should reset permissions with deleteMany + create', async () => {
      const existing = buildRole({ id: 'role-1' });
      const newPermissions = [
        {
          module: 'orders',
          menu: 'orders',
          view: true,
          create: false,
          edit: false,
          delete: false,
          export: false,
          approve: false,
        },
      ];
      mockPrisma.role.findFirst.mockResolvedValue({ ...existing, permissions: [] });
      mockPrisma.role.update.mockResolvedValue({
        ...existing,
        permissions: newPermissions,
      });

      await service.update(
        'role-1',
        { permissions: newPermissions, version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.role.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            permissions: { deleteMany: {}, create: newPermissions },
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const existing = buildRole({ id: 'role-1', version: 1 });
      mockPrisma.role.findFirst.mockResolvedValue({ ...existing, permissions: [] });

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.role.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'role-1',
          { name: '更新', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildRole({ id: 'role-1' });
      mockPrisma.role.findFirst.mockResolvedValue({ ...existing, permissions: [] });
      mockPrisma.role.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update('role-1', { name: '更新' } as Parameters<typeof service.update>[1], {
          id: 'user-1',
          employeeId: 'emp-' + 'user-1',
        })
      ).rejects.toThrow('DB connection lost');
    });
  });

  // ─── remove ────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should soft delete by setting deletedAt', async () => {
      const role = buildRole({ id: 'role-1' });
      mockPrisma.role.findFirst.mockResolvedValue({ ...role, permissions: [] });
      mockPrisma.userRole.count.mockResolvedValue(0);
      mockPrisma.role.update.mockResolvedValue(role);

      const result = await service.remove('role-1', {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.role.update).toHaveBeenCalledWith({
        where: { id: 'role-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException when role does not exist', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when role has associated users', async () => {
      const role = buildRole({ id: 'role-1' });
      mockPrisma.role.findFirst.mockResolvedValue({ ...role, permissions: [] });
      mockPrisma.userRole.count.mockResolvedValue(5);

      await expect(
        service.remove('role-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.role.update).not.toHaveBeenCalled();
    });
  });
});
