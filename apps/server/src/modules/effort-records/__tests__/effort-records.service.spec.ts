import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildEffortRecord } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { EffortRecordsService } from '../effort-records.service';

/** 构造带 project 关联的工时记录 mock 数据 */
function buildRecordWithProject(overrides: Record<string, unknown> = {}) {
  return {
    ...buildEffortRecord(),
    project: {
      id: 'proj-1',
      name: '项目A',
      customer: { customerName: '客户A' },
    },
    ...overrides,
  };
}

describe('EffortRecordsService', () => {
  let service: EffortRecordsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };
  let mockHolidaysService: { isRestDay: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    // 默认所有日期视为工作日；个别用例需要测节假日拦截可在用例内 override
    mockHolidaysService = {
      isRestDay: vi.fn().mockResolvedValue(false),
    };
    service = new EffortRecordsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService,
      mockHolidaysService as unknown as import('../../holidays/holidays.service').HolidaysService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------- create ----------
  describe('create', () => {
    it('应成功创建工时记录', async () => {
      const record = buildRecordWithProject();
      mockPrisma.effortRecord.create.mockResolvedValue(record);

      const dto = {
        projectId: 'proj-1',
        actualTime: 4,
        description: '开发任务',
        workType: 'DEVELOPMENT',
        ownerName: '张三',
        startDate: '2026-03-01',
        endDate: '2026-03-02',
      } as Parameters<typeof service.create>[0];

      const result = await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(result).toBeDefined();
      expect(mockPrisma.effortRecord.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.effortRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'proj-1',
          }),
        })
      );
    });

    it('应将 actualTime 转为 String 写入', async () => {
      const record = buildRecordWithProject();
      mockPrisma.effortRecord.create.mockResolvedValue(record);

      const dto = {
        projectId: 'proj-1',
        actualTime: 8.5,
        startDate: '2026-03-01',
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.effortRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actualTime: '8.5',
          }),
        })
      );
    });

    it('应包含 project 关联查询', async () => {
      const record = buildRecordWithProject();
      mockPrisma.effortRecord.create.mockResolvedValue(record);

      const dto = {
        projectId: 'proj-1',
        actualTime: 4,
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.effortRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            project: {
              select: {
                id: true,
                name: true,
                customer: { select: { customerName: true } },
              },
            },
          },
        })
      );
    });

    it('应将 startDate/endDate 转为 Date 对象', async () => {
      const record = buildRecordWithProject();
      mockPrisma.effortRecord.create.mockResolvedValue(record);

      const dto = {
        projectId: 'proj-1',
        actualTime: 4,
        startDate: '2026-03-01',
        endDate: '2026-03-05',
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.effortRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            startDate: expect.any(Date),
            endDate: expect.any(Date),
          }),
        })
      );
    });

    it('应从 project 获取 customerName', async () => {
      const record = buildRecordWithProject();
      mockPrisma.effortRecord.create.mockResolvedValue(record);

      const dto = {
        projectId: 'proj-1',
        actualTime: 4,
      } as Parameters<typeof service.create>[0];

      const result = await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(result.project).toEqual(
        expect.objectContaining({
          id: 'proj-1',
          name: '项目A',
          customerName: '客户A',
        })
      );
    });
  });

  // ---------- findAll ----------
  describe('findAll', () => {
    it('应返回默认分页结果', async () => {
      const items = [buildRecordWithProject()];
      mockPrisma.effortRecord.findMany.mockResolvedValue(items);
      mockPrisma.effortRecord.count.mockResolvedValue(1);

      const result = await service.findAll(
        {
          page: 1,
          pageSize: 20,
          sortOrder: 'desc' as const,
        } as Parameters<typeof service.findAll>[0],
        undefined,
        null
      );

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('应过滤已删除记录（deletedAt: null）', async () => {
      mockPrisma.effortRecord.findMany.mockResolvedValue([]);
      mockPrisma.effortRecord.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, pageSize: 20, sortOrder: 'desc' as const } as Parameters<
          typeof service.findAll
        >[0],
        undefined,
        null
      );

      expect(mockPrisma.effortRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        })
      );
    });

    it('应按 projectId 转发到 FilterApplier (legacyFilters)', async () => {
      mockPrisma.effortRecord.findMany.mockResolvedValue([]);
      mockPrisma.effortRecord.count.mockResolvedValue(0);

      await service.findAll(
        {
          projectId: ['proj-1'],
          page: 1,
          pageSize: 20,
          sortOrder: 'desc' as const,
        } as Parameters<typeof service.findAll>[0],
        undefined,
        null
      );

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ projectId: ['proj-1'] }),
        })
      );
    });

    it('应按 ownerId 转发到 FilterApplier (legacyFilters)', async () => {
      mockPrisma.effortRecord.findMany.mockResolvedValue([]);
      mockPrisma.effortRecord.count.mockResolvedValue(0);

      await service.findAll(
        {
          ownerId: 'owner-1',
          page: 1,
          pageSize: 20,
          sortOrder: 'desc' as const,
        } as Parameters<typeof service.findAll>[0],
        undefined,
        null
      );

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ ownerId: 'owner-1' }),
        })
      );
    });

    it('ALL 数据范围传入 null（放开数据范围）', async () => {
      mockPrisma.effortRecord.findMany.mockResolvedValue([]);
      mockPrisma.effortRecord.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, pageSize: 20, sortOrder: 'desc' as const } as Parameters<
          typeof service.findAll
        >[0],
        undefined,
        null
      );

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ chargerScope: null })
      );
    });

    it('SELF 数据范围按 employeeId 强制下推', async () => {
      mockPrisma.effortRecord.findMany.mockResolvedValue([]);
      mockPrisma.effortRecord.count.mockResolvedValue(0);

      await service.findAll(
        { page: 1, pageSize: 20, sortOrder: 'desc' as const } as Parameters<
          typeof service.findAll
        >[0],
        undefined,
        ['emp-1']
      );

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ chargerScope: ['emp-1'] })
      );
    });
  });

  // ---------- findOne ----------
  describe('findOne', () => {
    it('应返回包含 project 的详情', async () => {
      const record = buildRecordWithProject({ id: 'er-1' });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);

      const result = await service.findOne('er-1');

      expect(result).toBeDefined();
      expect(result.project).toEqual(
        expect.objectContaining({
          id: 'proj-1',
          name: '项目A',
          customerName: '客户A',
        })
      );
      expect(mockPrisma.effortRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'er-1', deletedAt: null },
        include: {
          owner: { select: { id: true, name: true } },
          project: {
            select: {
              id: true,
              name: true,
              customer: { select: { customerName: true } },
            },
          },
        },
      });
    });

    it('记录不存在时应抛出 NotFoundException', async () => {
      mockPrisma.effortRecord.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------- update ----------
  describe('update', () => {
    it('应使用乐观锁进行更新', async () => {
      const record = buildRecordWithProject({ id: 'er-1', version: 1 });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);
      mockPrisma.effortRecord.update.mockResolvedValue({ ...record, version: 2 });

      await service.update(
        'er-1',
        {
          description: '更新描述',
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.effortRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'er-1', version: 1, deletedAt: null },
          data: expect.objectContaining({
            description: '更新描述',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('应将 actualTime 转为 String 写入', async () => {
      const record = buildRecordWithProject({ id: 'er-1', version: 1 });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);
      mockPrisma.effortRecord.update.mockResolvedValue({ ...record, version: 2 });

      await service.update(
        'er-1',
        {
          actualTime: 6.5,
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.effortRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actualTime: '6.5',
          }),
        })
      );
    });

    it('应将 startDate/endDate 转为 Date 或 null', async () => {
      const record = buildRecordWithProject({ id: 'er-1', version: 1 });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);
      mockPrisma.effortRecord.update.mockResolvedValue({ ...record, version: 2 });

      await service.update(
        'er-1',
        {
          startDate: '2026-04-01',
          endDate: null,
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.effortRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            startDate: expect.any(Date),
            endDate: null,
          }),
        })
      );
    });

    it('版本冲突 P2025 应抛出 ConflictException', async () => {
      const record = buildRecordWithProject({ id: 'er-1', version: 1 });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.effortRecord.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'er-1',
          { description: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('非 P2025 错误应原样重抛', async () => {
      const record = buildRecordWithProject({ id: 'er-1', version: 1 });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);
      mockPrisma.effortRecord.update.mockRejectedValue(new Error('Unknown error'));

      await expect(
        service.update(
          'er-1',
          { description: '错误', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('Unknown error');
    });
  });

  // ---------- remove ----------
  describe('remove', () => {
    it('应执行软删除并返回 { success: true }', async () => {
      const record = buildRecordWithProject({ id: 'er-1' });
      mockPrisma.effortRecord.findFirst.mockResolvedValue(record);
      mockPrisma.effortRecord.update.mockResolvedValue(record);

      const result = await service.remove('er-1', 1, {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toEqual({ success: true });
      expect(mockPrisma.effortRecord.update).toHaveBeenCalledWith({
        where: { id: 'er-1', version: 1, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
    });

    it('记录不存在时应抛出 NotFoundException', async () => {
      mockPrisma.effortRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', 1, { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });
});
