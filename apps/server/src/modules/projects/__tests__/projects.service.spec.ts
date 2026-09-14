import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { ProjectsService } from '../projects.service';

/** 构造项目 mock 数据 */
function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-1',
    name: '艾泽拉斯项目',
    description: '项目描述',
    status: 'active',
    logicalStatus: null,
    ownerId: 'user-1',
    ownerName: '张三',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    ...overrides,
  };
}

/** 构造项目（含成员与工作项关联） */
function buildProjectWithRelations(overrides: Record<string, unknown> = {}) {
  return {
    ...buildProject(overrides),
    customer: null,
    members: [],
    saleOrders: [],
  };
}

/** 构造项目成员 mock 数据 */
function buildProjectMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-1',
    projectId: 'proj-1',
    employeeId: 'user-2',
    userName: '李四',
    role: 'developer',
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProjectsService', () => {
  let service: ProjectsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();

    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };

    // 默认 totalHours 聚合返回空，避免每个 findAll 用例都要 stub。
    mockPrisma.effortRecord.groupBy.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockImplementation(async (query: unknown) => {
      const sql = Array.isArray(query) ? query.join('') : String(query);
      if (sql.includes('FROM "public"."sale_orders"')) {
        return [
          {
            id: 'order-1',
            customerId: 'cust-1',
            opportunityId: 'opp-1',
            chargerId: null,
            flowStatus: 'approved',
            deletedAt: null,
            version: 1,
          },
        ];
      }
      return [];
    });

    service = new ProjectsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a project', async () => {
      const project = buildProject({ id: 'proj-new' });
      mockPrisma.project.create.mockResolvedValue(project);

      const dto = {
        name: '新项目',
        description: '描述',
        status: 'active',
        ownerId: 'user-1',
        ownerName: '张三',
      } as Parameters<typeof service.create>[0];

      const result = await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(result).toBeDefined();
      expect(mockPrisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: '新项目',
            description: '描述',
          }),
        })
      );
    });

    it('should persist the selected opportunity and sale order when they belong together', async () => {
      const project = buildProject({
        id: 'proj-new',
        customerId: 'cust-1',
        opportunityId: 'opp-1',
        saleOrderId: 'order-1',
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-1',
        opportunityId: 'opp-1',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', customerId: 'cust-1' });
      mockPrisma.project.create.mockResolvedValue(project);

      await service.create(
        {
          name: '关联项目',
          customerId: 'cust-1',
          opportunityId: 'opp-1',
          saleOrderId: 'order-1',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            opportunityId: 'opp-1',
            saleOrderId: 'order-1',
          }),
        })
      );
    });

    it('should reject a sale order that does not belong to the selected opportunity', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-1',
        opportunityId: 'opp-other',
      });
      mockPrisma.$queryRaw.mockImplementation(async (query: unknown) => {
        const sql = Array.isArray(query) ? query.join('') : String(query);
        return sql.includes('FROM "public"."sale_orders"')
          ? [
              {
                id: 'order-1',
                customerId: 'cust-1',
                opportunityId: 'opp-other',
                chargerId: null,
                flowStatus: 'approved',
                deletedAt: null,
                version: 1,
              },
            ]
          : [];
      });

      await expect(
        service.create(
          {
            name: '错误关联项目',
            customerId: 'cust-1',
            opportunityId: 'opp-1',
            saleOrderId: 'order-1',
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.project.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated projects', async () => {
      const items = [buildProject()];
      mockPrisma.project.findMany.mockResolvedValue(items);
      mockPrisma.project.count.mockResolvedValue(1);
      // aggregateTotalHours 内部走 effortRecord.groupBy 聚合当页工时，
      // 测试场景下返回空数组（无工时数据），否则 for-of undefined 抛 "groups is not iterable"
      mockPrisma.effortRecord.groupBy.mockResolvedValue([]);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findAll({ keyword: '艾泽', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '艾泽' })
      );
    });

    it('should forward status to FilterApplier (legacyFilters)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findAll({ status: ['active'], page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ status: ['active'] }),
        })
      );
    });

    it('should forward ownerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findAll({ ownerId: 'user-1', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ ownerId: 'user-1' }),
        })
      );
    });

    it('should handle pagination correctly', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, pageSize: 10, sortOrder: 'desc' });

      expect(result.totalPages).toBe(3);
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });

    it('should merge totalHours from effortRecord.groupBy on path A', async () => {
      const items = [buildProject({ id: 'proj-1' }), buildProject({ id: 'proj-2' })];
      mockPrisma.project.findMany.mockResolvedValue(items);
      mockPrisma.project.count.mockResolvedValue(2);
      mockPrisma.effortRecord.groupBy.mockResolvedValue([
        { projectId: 'proj-1', _sum: { actualTime: 12.5 } },
        { projectId: 'proj-2', _sum: { actualTime: null } },
      ]);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.effortRecord.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['projectId'],
          where: expect.objectContaining({
            recordType: 'ACTUAL',
            deletedAt: null,
            projectId: { in: ['proj-1', 'proj-2'] },
          }),
          _sum: { actualTime: true },
        })
      );
      expect(result.items[0]).toMatchObject({ id: 'proj-1', totalHours: 12.5 });
      // groupBy 未返回 → 兜底 0
      expect(result.items[1]).toMatchObject({ id: 'proj-2', totalHours: 0 });
    });

    it('should apply whitelisted sortBy to Prisma orderBy on path A', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc' });

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } })
      );
    });

    it('should fall back to createdAt desc for non-whitelisted sortBy', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'description',
        sortOrder: 'asc',
      });

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } })
      );
    });

    it('should switch to aggregated path B when sortBy=totalHours', async () => {
      // ① 精简全量 ② groupBy ③ 二次 findMany 拿完整记录
      const now = new Date();
      const aggregateRows = [
        { id: 'proj-1', name: 'A', status: 'active', createdAt: now, updatedAt: now },
        { id: 'proj-2', name: 'B', status: 'active', createdAt: now, updatedAt: now },
        { id: 'proj-3', name: 'C', status: 'active', createdAt: now, updatedAt: now },
      ];
      mockPrisma.project.findMany
        .mockResolvedValueOnce(aggregateRows)
        .mockResolvedValueOnce([
          buildProject({ id: 'proj-3' }),
          buildProject({ id: 'proj-1' }),
          buildProject({ id: 'proj-2' }),
        ]);
      mockPrisma.effortRecord.groupBy.mockResolvedValue([
        { projectId: 'proj-1', _sum: { actualTime: 10 } },
        { projectId: 'proj-3', _sum: { actualTime: 30 } },
      ]);

      const result = await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'totalHours',
        sortOrder: 'desc',
      });

      // 路径 B 不调用 prisma.project.count
      expect(mockPrisma.project.count).not.toHaveBeenCalled();
      expect(result.total).toBe(3);
      expect(result.items.map((i) => i.id)).toEqual(['proj-3', 'proj-1', 'proj-2']);
      expect(result.items.map((i) => i.totalHours)).toEqual([30, 10, 0]);
    });

    it('should filter by totalHours min/max via path B', async () => {
      const now = new Date();
      const aggregateRows = [
        { id: 'proj-1', name: 'A', status: 'active', createdAt: now, updatedAt: now },
        { id: 'proj-2', name: 'B', status: 'active', createdAt: now, updatedAt: now },
        { id: 'proj-3', name: 'C', status: 'active', createdAt: now, updatedAt: now },
      ];
      mockPrisma.project.findMany
        .mockResolvedValueOnce(aggregateRows)
        .mockResolvedValueOnce([buildProject({ id: 'proj-2' })]);
      mockPrisma.effortRecord.groupBy.mockResolvedValue([
        { projectId: 'proj-1', _sum: { actualTime: 5 } },
        { projectId: 'proj-2', _sum: { actualTime: 25 } },
        { projectId: 'proj-3', _sum: { actualTime: 60 } },
      ]);

      // rawQuery 用扁平 bracket key（前端 axios 默认序列化产物）
      const result = await service.findAll(
        { page: 1, pageSize: 10, sortOrder: 'desc' },
        {
          'filters[totalHours][min]': '10',
          'filters[totalHours][max]': '50',
        }
      );

      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe('proj-2');
      expect(result.items[0]?.totalHours).toBe(25);
    });
  });

  describe('findOne', () => {
    it('should return project with members', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1' });
      mockPrisma.project.findFirst.mockResolvedValue(project);

      const result = await service.findOne('proj-1');

      expect(result).toBeDefined();
      expect(mockPrisma.project.findFirst).toHaveBeenCalledWith({
        where: { id: 'proj-1', deletedAt: null },
        include: expect.objectContaining({
          members: { where: { deletedAt: null, isActive: true } },
        }),
      });
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('joins the SaleOrder graph lock before the authoritative project reread', async () => {
      const events: string[] = [];
      const project = buildProjectWithRelations({
        id: 'proj-1',
        version: 1,
        customerId: 'cust-1',
        opportunityId: 'opp-1',
        saleOrderId: null,
      });
      let reads = 0;
      mockPrisma.project.findFirst.mockImplementation(async () => {
        reads += 1;
        if (reads > 1) events.push('project-reread');
        return project;
      });
      mockPrisma.$executeRaw.mockImplementation(async () => {
        events.push('advisory-lock');
        return 1;
      });
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', customerId: 'cust-1' });
      mockPrisma.project.update.mockResolvedValue({ ...project, version: 2 });

      await service.update(
        'proj-1',
        { name: '更新项目名', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(events.indexOf('advisory-lock')).toBeGreaterThanOrEqual(0);
      expect(events.indexOf('advisory-lock')).toBeLessThan(events.indexOf('project-reread'));
    });

    it('should update with version check (optimistic lock)', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1', version: 1 });
      mockPrisma.project.findFirst.mockResolvedValue(project);
      mockPrisma.project.update.mockResolvedValue({ ...project, version: 2 });

      await service.update(
        'proj-1',
        { name: '更新项目名', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-1', version: 1, deletedAt: null },
          data: expect.objectContaining({
            name: '更新项目名',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('关联订单时写回锁后校验的完整客户、商机、订单三元组', async () => {
      const project = buildProjectWithRelations({
        id: 'proj-1',
        version: 1,
        customerId: null,
        opportunityId: null,
        saleOrderId: null,
      });
      mockPrisma.project.findFirst.mockResolvedValue(project);
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-1',
        opportunityId: 'opp-1',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-1', customerId: 'cust-1' });
      mockPrisma.project.update.mockResolvedValue({
        ...project,
        customerId: 'cust-1',
        opportunityId: 'opp-1',
        saleOrderId: 'order-1',
        version: 2,
      });

      await service.update(
        'proj-1',
        { saleOrderId: 'order-1', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            opportunityId: 'opp-1',
            saleOrderId: 'order-1',
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 (version mismatch)', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1', version: 1 });
      mockPrisma.project.findFirst.mockResolvedValue(project);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.project.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'proj-1',
          { name: '冲突更新', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1', version: 1 });
      mockPrisma.project.findFirst.mockResolvedValue(project);
      mockPrisma.project.update.mockRejectedValue(new Error('Unknown error'));

      await expect(
        service.update(
          'proj-1',
          { name: '错误', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('Unknown error');
    });
  });

  describe('remove', () => {
    it('should soft delete project and return { success: true }', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1' });
      mockPrisma.project.findFirst.mockResolvedValue(project);
      mockPrisma.project.update.mockResolvedValue(project);

      const result = await service.remove('proj-1', 1, {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1', version: 1, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          opportunityId: null,
          saleOrderId: null,
          version: { increment: 1 },
        }),
      });
    });

    it('should throw NotFoundException when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', 1, { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMember', () => {
    it('should add member after validating project exists', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1' });
      mockPrisma.project.findFirst.mockResolvedValue(project);

      const member = buildProjectMember();
      mockPrisma.projectMember.create.mockResolvedValue(member);

      const result = await service.addMember(
        'proj-1',
        { employeeId: 'user-2', role: 'developer' },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(result).toBeDefined();
      expect(mockPrisma.project.findFirst).toHaveBeenCalled();
      expect(mockPrisma.projectMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'proj-1',
            employeeId: 'user-2',
            role: 'developer',
            joinedAt: expect.any(Date),
          }),
        })
      );
    });
  });

  describe('removeMember', () => {
    it('should remove existing member', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1' });
      mockPrisma.project.findFirst.mockResolvedValue(project);

      const member = buildProjectMember({ id: 'member-1', projectId: 'proj-1' });
      mockPrisma.projectMember.findFirst.mockResolvedValue(member);
      mockPrisma.projectMember.update.mockResolvedValue(member);

      const result = await service.removeMember('proj-1', 'member-1', 1, {
        id: 'user-1',
        employeeId: 'emp-user-1',
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.projectMember.update).toHaveBeenCalledWith({
        where: {
          id: 'member-1',
          projectId: 'proj-1',
          version: 1,
          deletedAt: null,
        },
        data: expect.objectContaining({
          isActive: false,
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
    });

    it('should throw NotFoundException for invalid member', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1' });
      mockPrisma.project.findFirst.mockResolvedValue(project);
      mockPrisma.projectMember.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', { code: 'P2025', clientVersion: '0' })
      );

      await expect(
        service.removeMember('proj-1', 'non-exist-member', 1, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow();
    });
  });

  describe('getMembers', () => {
    it('should return member list for project', async () => {
      const project = buildProjectWithRelations({ id: 'proj-1' });
      mockPrisma.project.findFirst.mockResolvedValue(project);

      const members = [
        buildProjectMember({ id: 'member-1' }),
        buildProjectMember({ id: 'member-2', userId: 'user-3', userName: '王五' }),
      ];
      mockPrisma.projectMember.findMany.mockResolvedValue(members);

      const result = await service.getMembers('proj-1');

      expect(result).toHaveLength(2);
      expect(mockPrisma.projectMember.findMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', deletedAt: null, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findAllForSelection', () => {
    it('should return simplified project list for dropdown', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'proj-1',
          name: '项目A',
          status: 'active',
          category: null,
          customer: { customerName: '客户A' },
        },
        {
          id: 'proj-2',
          name: '项目B',
          status: 'active',
          category: null,
          customer: null,
        },
      ]);

      const result = await service.findAllForSelection();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'proj-1',
        name: '项目A',
        status: 'active',
        category: null,
        customerName: '客户A',
      });
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
          select: {
            id: true,
            name: true,
            status: true,
            category: true,
            customer: { select: { customerName: true } },
          },
          orderBy: { name: 'asc' },
        })
      );
    });

    it('should filter by project name or customer name with keyword and status', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.findAllForSelection('艾泽', 'active');

      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            OR: [
              { name: { contains: '艾泽', mode: 'insensitive' } },
              {
                customer: {
                  is: {
                    customerName: { contains: '艾泽', mode: 'insensitive' },
                  },
                },
              },
            ],
          }),
        })
      );
    });
  });
});
