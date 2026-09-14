import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { DingtalkCalendarEventsService } from '../dingtalk-calendar-events.service';

describe('DingtalkCalendarEventsService', () => {
  let service: DingtalkCalendarEventsService;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    service = new DingtalkCalendarEventsService(asPrismaService(mockPrisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated events with default params', async () => {
      const items = [
        { id: '1', eventId: 'evt-1', title: '周会', startTime: new Date() },
        { id: '2', eventId: 'evt-2', title: '评审', startTime: new Date() },
      ];
      mockPrisma.dingtalkCalendarEvent.findMany.mockResolvedValue(items);
      mockPrisma.dingtalkCalendarEvent.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.dingtalkCalendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { startTime: 'desc' },
        })
      );
    });

    it('should filter by keyword on title (case insensitive)', async () => {
      mockPrisma.dingtalkCalendarEvent.findMany.mockResolvedValue([]);
      mockPrisma.dingtalkCalendarEvent.count.mockResolvedValue(0);

      await service.findAll({ keyword: '周会', page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockPrisma.dingtalkCalendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            title: { contains: '周会', mode: 'insensitive' },
          }),
        })
      );
    });

    it('should calculate pagination correctly for page 2', async () => {
      mockPrisma.dingtalkCalendarEvent.findMany.mockResolvedValue([]);
      mockPrisma.dingtalkCalendarEvent.count.mockResolvedValue(25);

      const result = await service.findAll({ page: 2, pageSize: 10, sortOrder: 'desc' as const });

      expect(result.totalPages).toBe(3);
      expect(mockPrisma.dingtalkCalendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return event when found by eventId', async () => {
      const event = { id: '1', eventId: 'evt-1', title: '周会', startTime: new Date() };
      mockPrisma.dingtalkCalendarEvent.findUnique.mockResolvedValue(event);

      const result = await service.findOne('evt-1');

      expect(result).toBeDefined();
      expect(mockPrisma.dingtalkCalendarEvent.findUnique).toHaveBeenCalledWith({
        where: { eventId: 'evt-1' },
      });
    });

    it('should throw NotFoundException when event does not exist', async () => {
      mockPrisma.dingtalkCalendarEvent.findUnique.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
      await expect(service.findOne('non-exist')).rejects.toThrow('日程事件不存在');
    });
  });
});
