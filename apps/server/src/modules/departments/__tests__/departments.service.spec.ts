import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildDepartment, buildEmployee } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { DepartmentsService } from '../departments.service';

/** Helper: build a department with relations (parent, manager, _count) for findOne / create mocks */
function buildDeptWithRelations(
  overrides: Parameters<typeof buildDepartment>[0] = {},
  relations: {
    parent?: ReturnType<typeof buildDepartment> | null;
    manager?: ReturnType<typeof buildEmployee> | null;
    employeeCount?: number;
    childrenCount?: number;
  } = {}
) {
  return {
    ...buildDepartment(overrides),
    parent: relations.parent ?? null,
    manager: relations.manager ?? null,
    _count: {
      employees: relations.employeeCount ?? 0,
      children: relations.childrenCount ?? 0,
    },
  };
}

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    // DepartmentsService.findAll 的 baseWhere 会带 parentId；为了让 parentId 测试生效，
    // mockBuildWhere 把传入的 baseWhere 透传回来——这是简化实现，足以让测试观测关键字段。
    mockFilterApplier = {
      buildWhere: vi.fn(async ({ baseWhere }) => baseWhere),
    };
    service = new DepartmentsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------
  describe('create', () => {
    it('should create a department with parentId and managerId', async () => {
      const parentDept = buildDepartment({ id: 'parent-1' });
      const manager = buildEmployee({ id: 'mgr-1' });
      const created = buildDeptWithRelations(
        { id: 'new-dept', parentId: 'parent-1', managerId: 'mgr-1' },
        { parent: parentDept, manager }
      );

      mockPrisma.department.findFirst.mockResolvedValueOnce(parentDept); // validate parent
      mockPrisma.employee.findFirst.mockResolvedValueOnce(manager); // validate manager
      mockPrisma.department.create.mockResolvedValue(created);

      const result = await service.create(
        { name: '新部门', parentId: 'parent-1', managerId: 'mgr-1' },
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.id).toBe('new-dept');
      expect(result.parent).not.toBeNull();
      expect(result.manager).not.toBeNull();
      expect(mockPrisma.department.create).toHaveBeenCalledOnce();
    });

    it('should throw BadRequestException when parent department does not exist', async () => {
      mockPrisma.department.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create(
          { name: '新部门', parentId: 'non-existent' },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a top-level department when parentId is not provided', async () => {
      const created = buildDeptWithRelations({ id: 'top-dept' });
      mockPrisma.department.create.mockResolvedValue(created);

      const result = await service.create(
        { name: '顶级部门' },
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.parentId).toBeNull();
      // No findFirst call for parent validation
      expect(mockPrisma.department.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getTree
  // ---------------------------------------------------------------------------
  describe('getTree', () => {
    it('should build a nested tree structure', async () => {
      const root = {
        ...buildDepartment({ id: 'root', parentId: null }),
        manager: null,
        _count: { employees: 3 },
      };
      const child = {
        ...buildDepartment({ id: 'child', parentId: 'root' }),
        manager: null,
        _count: { employees: 1 },
      };
      const grandchild = {
        ...buildDepartment({ id: 'grandchild', parentId: 'child' }),
        manager: null,
        _count: { employees: 0 },
      };

      mockPrisma.department.findMany.mockResolvedValue([root, child, grandchild]);

      const tree = await service.getTree();

      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe('root');
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.id).toBe('child');
      expect(tree[0]!.children[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.children[0]!.id).toBe('grandchild');
      expect(tree[0]!.employeeCount).toBe(3);
    });

    it('should return empty array for empty tree', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);

      const tree = await service.getTree();

      expect(tree).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findAllForSelection
  // ---------------------------------------------------------------------------
  describe('findAllForSelection', () => {
    it('should return selection data', async () => {
      const items = [{ id: 'd1', name: '部门A', parentId: null }];
      mockPrisma.department.findMany.mockResolvedValue(items);

      const result = await service.findAllForSelection();

      expect(result).toEqual(items);
      expect(mockPrisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });

    it('should filter by keyword', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);

      await service.findAllForSelection('技术');

      expect(mockPrisma.department.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: { contains: '技术', mode: 'insensitive' },
          }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    it('should return paginated results with default params', async () => {
      const items = [buildDeptWithRelations()];
      mockPrisma.department.findMany.mockResolvedValue(items);
      mockPrisma.department.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.findAll({ keyword: '研发', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '研发' })
      );
    });

    it('should apply parentId in baseWhere (including null for root departments)', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.findAll({
        parentId: null as unknown as string,
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          baseWhere: expect.objectContaining({ parentId: null }),
        })
      );
    });

    it('should forward status to FilterApplier (legacyFilters)', async () => {
      mockPrisma.department.findMany.mockResolvedValue([]);
      mockPrisma.department.count.mockResolvedValue(0);

      await service.findAll({
        status: 'inactive',
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ status: 'inactive' }),
        })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------
  describe('findOne', () => {
    it('should return department with parent, manager, and _count', async () => {
      const parent = buildDepartment({ id: 'parent-1' });
      const manager = buildEmployee({ id: 'mgr-1' });
      const dept = buildDeptWithRelations(
        { id: 'dept-1', parentId: 'parent-1', managerId: 'mgr-1' },
        { parent, manager, employeeCount: 5, childrenCount: 2 }
      );
      mockPrisma.department.findFirst.mockResolvedValue(dept);

      const result = await service.findOne('dept-1');

      expect(result.id).toBe('dept-1');
      expect(result.parent).toEqual({
        id: 'parent-1',
        name: parent.name,
        parentId: parent.parentId ?? null,
      });
      expect(result.manager).toEqual({ id: 'mgr-1', name: manager.name });
      expect(result.employeeCount).toBe(5);
      expect(result.childrenCount).toBe(2);
    });

    it('should throw NotFoundException when department does not exist', async () => {
      mockPrisma.department.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findChildren
  // ---------------------------------------------------------------------------
  describe('findChildren', () => {
    it('should return child departments', async () => {
      const parent = buildDeptWithRelations({ id: 'parent-1' });
      const child = buildDeptWithRelations({ id: 'child-1', parentId: 'parent-1' });

      // findOne call
      mockPrisma.department.findFirst.mockResolvedValueOnce(parent);
      // findMany for children
      mockPrisma.department.findMany.mockResolvedValue([child]);

      const result = await service.findChildren('parent-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('child-1');
    });

    it('should throw NotFoundException when parent does not exist', async () => {
      mockPrisma.department.findFirst.mockResolvedValueOnce(null);

      await expect(service.findChildren('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // findEmployees
  // ---------------------------------------------------------------------------
  describe('findEmployees', () => {
    it('should return paginated employee list', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });
      const edRecord = {
        id: 'ed-1',
        departmentId: 'dept-1',
        employeeId: 'emp-1',
        isPrimary: true,
        sortOrder: 0,
        createdBy: null,
        employee: emp,
      };

      mockPrisma.department.findFirst.mockResolvedValueOnce(dept); // findOne
      mockPrisma.employeeDepartment.findMany.mockResolvedValue([edRecord]);
      mockPrisma.employeeDepartment.count.mockResolvedValue(1);

      const result = await service.findEmployees('dept-1', 1, 10);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe('emp-1');
      expect(result.items[0]!.isPrimary).toBe(true);
      expect(result.total).toBe(1);
    });

    it('should throw NotFoundException when department does not exist', async () => {
      mockPrisma.department.findFirst.mockResolvedValueOnce(null);

      await expect(service.findEmployees('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------
  describe('update', () => {
    it('should update department with optimistic locking', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1', name: '旧名称' });
      const updated = buildDeptWithRelations({ id: 'dept-1', name: '新名称', version: 2 });

      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne
      mockPrisma.department.update.mockResolvedValue(updated);

      const result = await service.update(
        'dept-1',
        { name: '新名称', version: 1 },
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.name).toBe('新名称');
      expect(mockPrisma.department.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dept-1', version: 1 },
          data: expect.objectContaining({ version: { increment: 1 } }),
        })
      );
    });

    it('should throw BadRequestException when setting department as its own child', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne

      await expect(
        service.update(
          'dept-1',
          { parentId: 'dept-1', version: 1 },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when setting department as descendant child', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne

      // isDescendant: first call returns children of 'dept-1'
      mockPrisma.department.findMany.mockResolvedValueOnce([{ id: 'child-1' }]);
      // isDescendant: recursive call returns children of 'child-1', which includes the target
      mockPrisma.department.findMany.mockResolvedValueOnce([{ id: 'grandchild-1' }]);
      // No more children for grandchild-1
      mockPrisma.department.findMany.mockResolvedValueOnce([]);

      await expect(
        service.update(
          'dept-1',
          { parentId: 'grandchild-1', version: 1 },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when parent does not exist', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne

      // isDescendant returns no children (not a descendant)
      mockPrisma.department.findMany.mockResolvedValueOnce([]);

      // parent validation: not found
      mockPrisma.department.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update(
          'dept-1',
          { parentId: 'non-existent', version: 1 },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException on P2025 (version mismatch)', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne

      const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });
      mockPrisma.department.update.mockRejectedValue(p2025);

      await expect(
        service.update(
          'dept-1',
          { name: '新名称', version: 99 },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------
  describe('remove', () => {
    it('should soft-delete a department', async () => {
      const dept = {
        ...buildDepartment({ id: 'dept-1' }),
        _count: { children: 0, employees: 0 },
      };
      mockPrisma.department.findFirst.mockResolvedValueOnce(dept);
      mockPrisma.department.update.mockResolvedValue(dept);

      const result = await service.remove('dept-1', {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result.message).toBe('删除成功');
      expect(mockPrisma.department.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'dept-1' },
          data: expect.objectContaining({ updaterEmployeeId: 'emp-user-1' }),
        })
      );
    });

    it('should throw NotFoundException when department does not exist', async () => {
      mockPrisma.department.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.remove('non-existent', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when department has children', async () => {
      const dept = {
        ...buildDepartment({ id: 'dept-1' }),
        _count: { children: 3, employees: 0 },
      };
      mockPrisma.department.findFirst.mockResolvedValueOnce(dept);

      await expect(
        service.remove('dept-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when department has employees', async () => {
      const dept = {
        ...buildDepartment({ id: 'dept-1' }),
        _count: { children: 0, employees: 5 },
      };
      mockPrisma.department.findFirst.mockResolvedValueOnce(dept);

      await expect(
        service.remove('dept-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // setManagers
  // ---------------------------------------------------------------------------
  describe('setManagers', () => {
    it('should set department manager', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      const manager = buildEmployee({ id: 'mgr-1' });
      const updated = buildDeptWithRelations({ id: 'dept-1', managerId: 'mgr-1' }, { manager });

      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne
      mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'mgr-1' }); // validate employee
      mockPrisma.department.update.mockResolvedValue(updated);

      const result = await service.setManagers(
        'dept-1',
        { managerId: 'mgr-1', version: 1 },
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.manager).not.toBeNull();
      expect(result.manager!.id).toBe('mgr-1');
    });

    it('should throw BadRequestException when employee does not exist', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne
      mockPrisma.employee.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.setManagers(
          'dept-1',
          { managerId: 'non-existent', version: 1 },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException on P2025 (version mismatch)', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1' });
      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne
      mockPrisma.employee.findFirst.mockResolvedValueOnce({ id: 'mgr-1' }); // validate employee

      const p2025 = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });
      mockPrisma.department.update.mockRejectedValue(p2025);

      await expect(
        service.setManagers(
          'dept-1',
          { managerId: 'mgr-1', version: 99 },
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should clear manager when managerId is null', async () => {
      const existing = buildDeptWithRelations({ id: 'dept-1', managerId: 'mgr-1' });
      const updated = buildDeptWithRelations({ id: 'dept-1', managerId: null });

      mockPrisma.department.findFirst.mockResolvedValueOnce(existing); // findOne
      mockPrisma.department.update.mockResolvedValue(updated);

      const result = await service.setManagers(
        'dept-1',
        { managerId: null, version: 1 },
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result.manager).toBeNull();
      // Should not validate employee when managerId is null
      expect(mockPrisma.employee.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // addEmployee
  // ---------------------------------------------------------------------------
  describe('addEmployee', () => {
    it('should make the first relation primary even when isPrimary is false', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });

      mockPrisma.department.findFirst.mockResolvedValueOnce(dept);
      mockPrisma.employee.findFirst.mockResolvedValueOnce(emp);
      mockPrisma.employeeDepartment.findFirst
        .mockResolvedValueOnce(null) // check duplicate
        .mockResolvedValueOnce(null) // no current primary
        .mockResolvedValueOnce({ sortOrder: 5 }); // max sortOrder in target department
      mockPrisma.employeeDepartment.create.mockResolvedValue({});

      const result = await service.addEmployee('dept-1', 'emp-1', false, {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result.message).toBe('添加成功');
      expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-1'
      );
      expect(mockPrisma.employeeDepartment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            departmentId: 'dept-1',
            employeeId: 'emp-1',
            isPrimary: true,
            sortOrder: 6,
          }),
        })
      );
    });

    it('should keep a later non-primary addition non-primary when a primary exists', async () => {
      mockPrisma.department.findFirst.mockResolvedValueOnce(
        buildDeptWithRelations({ id: 'dept-2' })
      );
      mockPrisma.employee.findFirst.mockResolvedValueOnce(buildEmployee({ id: 'emp-1' }));
      mockPrisma.employeeDepartment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'ed-primary' })
        .mockResolvedValueOnce(null);
      mockPrisma.employeeDepartment.create.mockResolvedValue({});

      await service.addEmployee('dept-2', 'emp-1', false);

      expect(mockPrisma.employeeDepartment.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.employeeDepartment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isPrimary: false }) })
      );
    });

    it('should throw BadRequestException when employee already in department', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });

      mockPrisma.department.findFirst.mockResolvedValueOnce(dept); // findOne
      mockPrisma.employee.findFirst.mockResolvedValueOnce(emp); // validate employee
      mockPrisma.employeeDepartment.findFirst.mockResolvedValueOnce({ id: 'ed-1' }); // duplicate

      await expect(service.addEmployee('dept-1', 'emp-1')).rejects.toThrow(BadRequestException);
    });

    it('should lock by employee and keep primary clear plus create on the same tx', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });
      const tx = createMockPrismaService();

      mockPrisma.$transaction.mockImplementationOnce(
        async (callback: (client: MockPrismaService) => Promise<unknown>) => callback(tx)
      );
      tx.department.findFirst.mockResolvedValueOnce(dept);
      tx.employee.findFirst.mockResolvedValueOnce(emp);
      tx.employeeDepartment.findFirst
        .mockResolvedValueOnce(null) // check duplicate
        .mockResolvedValueOnce({ id: 'old-primary' }) // current primary
        .mockResolvedValueOnce(null); // max sortOrder (none)
      tx.employeeDepartment.updateMany.mockResolvedValue({ count: 1 });
      tx.employeeDepartment.create.mockResolvedValue({});

      await service.addEmployee('dept-1', 'emp-1', true, {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(tx.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-1'
      );
      expect(tx.department.findFirst).toHaveBeenCalledWith({
        where: { id: 'dept-1', deletedAt: null },
        select: { id: true },
      });
      expect(tx.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'emp-1', deletedAt: null },
        select: { id: true },
      });
      expect(tx.employeeDepartment.findFirst).toHaveBeenNthCalledWith(1, {
        where: { departmentId: 'dept-1', employeeId: 'emp-1' },
        select: { id: true },
      });
      expect(tx.employeeDepartment.findFirst).toHaveBeenNthCalledWith(2, {
        where: { employeeId: 'emp-1', isPrimary: true },
        select: { id: true },
      });
      expect(tx.employeeDepartment.findFirst).toHaveBeenNthCalledWith(3, {
        where: { departmentId: 'dept-1' },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      expect(tx.employeeDepartment.updateMany).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', isPrimary: true },
        data: { isPrimary: false },
      });
      expect(tx.employeeDepartment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPrimary: true, sortOrder: 0 }),
        })
      );
      expect(mockPrisma.department.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.employeeDepartment.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.employeeDepartment.create).not.toHaveBeenCalled();
    });

    it('should roll primary clearing back when relation creation fails', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });
      const tx = createMockPrismaService();
      const createError = new Error('relation insert failed');
      let oldPrimary = true;
      let transactionRolledBack = false;

      mockPrisma.$transaction.mockImplementationOnce(
        async (callback: (client: MockPrismaService) => Promise<unknown>) => {
          const snapshot = oldPrimary;
          try {
            return await callback(tx);
          } catch (error) {
            oldPrimary = snapshot;
            transactionRolledBack = true;
            throw error;
          }
        }
      );
      tx.department.findFirst.mockResolvedValueOnce(dept);
      tx.employee.findFirst.mockResolvedValueOnce(emp);
      tx.employeeDepartment.findFirst
        .mockResolvedValueOnce(null) // check duplicate
        .mockResolvedValueOnce({ id: 'old-primary' }) // current primary
        .mockResolvedValueOnce(null); // max sortOrder (none)
      tx.employeeDepartment.updateMany.mockImplementationOnce(async () => {
        oldPrimary = false;
        return { count: 1 };
      });
      tx.employeeDepartment.create.mockRejectedValueOnce(createError);

      await expect(service.addEmployee('dept-1', 'emp-1', true)).rejects.toBe(createError);

      expect(tx.employeeDepartment.updateMany).toHaveBeenCalledOnce();
      expect(tx.employeeDepartment.create).toHaveBeenCalledOnce();
      expect(transactionRolledBack).toBe(true);
      expect(oldPrimary).toBe(true);
    });

    it('should map a primary unique-index race to a readable conflict', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });
      const uniqueConflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: '6.19.2',
        meta: { target: ['employeeId'] },
      });

      mockPrisma.department.findFirst.mockResolvedValueOnce(dept);
      mockPrisma.employee.findFirst.mockResolvedValueOnce(emp);
      mockPrisma.employeeDepartment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'old-primary' })
        .mockResolvedValueOnce(null);
      mockPrisma.employeeDepartment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.employeeDepartment.create.mockRejectedValueOnce(uniqueConflict);

      await expect(service.addEmployee('dept-1', 'emp-1', true)).rejects.toThrow(
        '该员工的主部门已被并发修改，请刷新后重试'
      );
    });

    it('should request the same employee advisory lock for concurrent primary additions', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });
      const emp = buildEmployee({ id: 'emp-1' });

      mockPrisma.department.findFirst.mockResolvedValue(dept);
      mockPrisma.employee.findFirst.mockResolvedValue(emp);
      mockPrisma.employeeDepartment.findFirst.mockResolvedValue(null);
      mockPrisma.employeeDepartment.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.employeeDepartment.create.mockResolvedValue({});

      await Promise.all([
        service.addEmployee('dept-1', 'emp-1', true),
        service.addEmployee('dept-2', 'emp-1', true),
      ]);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);
      for (const [, lockKey] of mockPrisma.$executeRaw.mock.calls) {
        expect(lockKey).toBe('employee_primary_department:emp-1');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // removeEmployee
  // ---------------------------------------------------------------------------
  describe('removeEmployee', () => {
    it('should remove employee from department', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });

      mockPrisma.department.findFirst.mockResolvedValueOnce(dept); // findOne
      mockPrisma.employeeDepartment.findFirst.mockResolvedValueOnce({
        id: 'ed-1',
        departmentId: 'dept-1',
        employeeId: 'emp-1',
      });
      mockPrisma.employeeDepartment.delete.mockResolvedValue({});

      const result = await service.removeEmployee('dept-1', 'emp-1');

      expect(result.message).toBe('移除成功');
      expect(mockPrisma.$executeRaw).toHaveBeenCalledWith(
        expect.anything(),
        'employee_primary_department:emp-1'
      );
      expect(mockPrisma.employeeDepartment.delete).toHaveBeenCalledWith({
        where: { id: 'ed-1' },
      });
    });

    it('should promote the stable first remaining relation when removing the primary', async () => {
      mockPrisma.department.findFirst.mockResolvedValueOnce(
        buildDeptWithRelations({ id: 'dept-1' })
      );
      mockPrisma.employeeDepartment.findFirst
        .mockResolvedValueOnce({ id: 'ed-primary', isPrimary: true })
        .mockResolvedValueOnce({ id: 'ed-next' });
      mockPrisma.employeeDepartment.delete.mockResolvedValue({});
      mockPrisma.employeeDepartment.update.mockResolvedValue({});

      await service.removeEmployee('dept-1', 'emp-1');

      expect(mockPrisma.employeeDepartment.findFirst).toHaveBeenNthCalledWith(2, {
        where: { employeeId: 'emp-1' },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      expect(mockPrisma.employeeDepartment.update).toHaveBeenCalledWith({
        where: { id: 'ed-next' },
        data: { isPrimary: true },
      });
      expect(mockPrisma.employeeDepartment.delete.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.employeeDepartment.update.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
    });

    it('should throw BadRequestException when relation does not exist', async () => {
      const dept = buildDeptWithRelations({ id: 'dept-1' });

      mockPrisma.department.findFirst.mockResolvedValueOnce(dept); // findOne
      mockPrisma.employeeDepartment.findFirst.mockResolvedValueOnce(null);

      await expect(service.removeEmployee('dept-1', 'emp-1')).rejects.toThrow(BadRequestException);
    });
  });
});
