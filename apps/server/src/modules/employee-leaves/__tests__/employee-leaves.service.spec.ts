import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { EmployeeLeavesService } from '../employee-leaves.service';

describe('EmployeeLeavesService', () => {
  let service: EmployeeLeavesService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({}),
    };
    service = new EmployeeLeavesService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated employee leaves with default params', async () => {
      const items = [
        { id: '1', name: '张三', leaveTime: new Date() },
        { id: '2', name: '李四', leaveTime: new Date() },
      ];
      mockPrisma.employeeLeave.findMany.mockResolvedValue(items);
      mockPrisma.employeeLeave.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.employeeLeave.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { leaveTime: 'desc' },
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.employeeLeave.findMany.mockResolvedValue([]);
      mockPrisma.employeeLeave.count.mockResolvedValue(0);

      await service.findAll({ keyword: '张三', page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '张三' })
      );
    });

    it('should calculate pagination correctly for page 2', async () => {
      mockPrisma.employeeLeave.findMany.mockResolvedValue([]);
      mockPrisma.employeeLeave.count.mockResolvedValue(35);

      const result = await service.findAll({ page: 2, pageSize: 15, sortOrder: 'desc' as const });

      expect(result.totalPages).toBe(3);
      expect(mockPrisma.employeeLeave.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 15,
          take: 15,
        })
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return employee leave when found by id', async () => {
      const leave = { id: 'leave-1', name: '张三', leaveTime: new Date() };
      mockPrisma.employeeLeave.findUnique.mockResolvedValue(leave);

      const result = await service.findOne('leave-1');

      expect(result).toBeDefined();
      expect(mockPrisma.employeeLeave.findUnique).toHaveBeenCalledWith({
        where: { id: 'leave-1' },
      });
    });

    it('should throw NotFoundException when employee leave does not exist', async () => {
      mockPrisma.employeeLeave.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-exist')).rejects.toThrow('员工离职记录不存在');
    });
  });
});
