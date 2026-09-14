import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { DashboardService } from '../dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new DashboardService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── getStats ─────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return all 3 counts', async () => {
      mockPrisma.customer.count.mockResolvedValue(10);
      mockPrisma.opportunity.count.mockResolvedValue(5);
      mockPrisma.saleOrder.count.mockResolvedValue(3);

      const result = await service.getStats();

      expect(result).toEqual({
        customerCount: 10,
        opportunityCount: 5,
        saleOrderCount: 3,
      });
    });

    it('should query customers with deletedAt: null', async () => {
      mockPrisma.customer.count.mockResolvedValue(0);
      mockPrisma.opportunity.count.mockResolvedValue(0);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.getStats();

      expect(mockPrisma.customer.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    });

    it('should query opportunities with deletedAt: null', async () => {
      mockPrisma.customer.count.mockResolvedValue(0);
      mockPrisma.opportunity.count.mockResolvedValue(0);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.getStats();

      expect(mockPrisma.opportunity.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
      expect(mockPrisma.saleOrder.count).toHaveBeenCalledWith({ where: { deletedAt: null } });
    });

    it('should handle zero counts correctly', async () => {
      mockPrisma.customer.count.mockResolvedValue(0);
      mockPrisma.opportunity.count.mockResolvedValue(0);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      const result = await service.getStats();

      expect(result).toEqual({
        customerCount: 0,
        opportunityCount: 0,
        saleOrderCount: 0,
      });
    });

    it('should call all 3 count queries via Promise.all', async () => {
      mockPrisma.customer.count.mockResolvedValue(1);
      mockPrisma.opportunity.count.mockResolvedValue(2);
      mockPrisma.saleOrder.count.mockResolvedValue(3);

      await service.getStats();

      expect(mockPrisma.customer.count).toHaveBeenCalledTimes(1);
      expect(mockPrisma.opportunity.count).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saleOrder.count).toHaveBeenCalledTimes(1);
      expect(mockPrisma.employee.count).not.toHaveBeenCalled();
    });
  });
});
