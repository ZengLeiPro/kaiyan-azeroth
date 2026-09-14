import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { DingtalkLogsService } from '../dingtalk-logs.service';

describe('DingtalkLogsService', () => {
  let service: DingtalkLogsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({}),
    };
    service = new DingtalkLogsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated logs with default params', async () => {
      const items = [
        {
          id: '1',
          reportId: 'rpt-1',
          creatorName: '张三',
          templateName: '日报',
          createTime: new Date(),
        },
        {
          id: '2',
          reportId: 'rpt-2',
          creatorName: '李四',
          templateName: '周报',
          createTime: new Date(),
        },
      ];
      mockPrisma.dingtalkLog.findMany.mockResolvedValue(items);
      mockPrisma.dingtalkLog.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.dingtalkLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createTime: 'desc' },
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.dingtalkLog.findMany.mockResolvedValue([]);
      mockPrisma.dingtalkLog.count.mockResolvedValue(0);

      await service.findAll({ keyword: '张三', page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '张三' })
      );
    });

    it('should forward creatorId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.dingtalkLog.findMany.mockResolvedValue([]);
      mockPrisma.dingtalkLog.count.mockResolvedValue(0);

      await service.findAll({
        creatorId: 'user-123',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ creatorId: 'user-123' }),
        })
      );
    });

    it('should calculate pagination correctly for page 3', async () => {
      mockPrisma.dingtalkLog.findMany.mockResolvedValue([]);
      mockPrisma.dingtalkLog.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 3, pageSize: 10, sortOrder: 'desc' as const });

      expect(result.totalPages).toBe(5);
      expect(mockPrisma.dingtalkLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        })
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return log when found by reportId', async () => {
      const log = {
        id: '1',
        reportId: 'rpt-1',
        creatorName: '张三',
        templateName: '日报',
        createTime: new Date(),
      };
      mockPrisma.dingtalkLog.findUnique.mockResolvedValue(log);

      const result = await service.findOne('rpt-1');

      expect(result).toBeDefined();
      expect(mockPrisma.dingtalkLog.findUnique).toHaveBeenCalledWith({
        where: { reportId: 'rpt-1' },
      });
    });

    it('should throw NotFoundException when log does not exist', async () => {
      mockPrisma.dingtalkLog.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-exist')).rejects.toThrow('钉钉日志不存在');
    });
  });
});
