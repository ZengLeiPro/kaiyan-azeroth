import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildCrmWorkDaily } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { CrmWorkDailiesService } from '../crm-work-dailies.service';

describe('CrmWorkDailiesService', () => {
  let service: CrmWorkDailiesService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    service = new CrmWorkDailiesService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a work daily successfully', async () => {
      const daily = buildCrmWorkDaily({ createdBy: 'user-1', updatedBy: 'user-1' });
      mockPrisma.crmWorkDaily.create.mockResolvedValue(daily);

      const result = await service.create(
        {
          reportDate: '2026-03-05',
          senderId: 'emp-1',
          keyCustomerSummary: '拜访了重要客户',
          attachments: [{ name: 'file.pdf', url: 'https://example.com/file.pdf' }],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(daily.id);
      expect(mockPrisma.crmWorkDaily.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderId: 'emp-1',
            keyCustomerSummary: '拜访了重要客户',
          }),
        })
      );
    });

    it('should persist newContactMethodCount on create', async () => {
      const daily = buildCrmWorkDaily({
        createdBy: 'user-1',
        updatedBy: 'user-1',
        newContactMethodCount: 3,
      });
      mockPrisma.crmWorkDaily.create.mockResolvedValue(daily);

      await service.create(
        {
          reportDate: '2026-09-14',
          reportType: 'telesales',
          newContactMethodCount: 3,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-1' }
      );

      expect(mockPrisma.crmWorkDaily.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportType: 'telesales',
            newContactMethodCount: 3,
          }),
        })
      );
    });

    it('should default report type and sender when omitted', async () => {
      const daily = buildCrmWorkDaily({ createdBy: 'user-1', updatedBy: 'user-1' });
      mockPrisma.crmWorkDaily.create.mockResolvedValue(daily);

      await service.create({ reportDate: '2026-03-05' } as Parameters<typeof service.create>[0], {
        id: 'user-1',
        employeeId: 'emp-1',
      });

      expect(mockPrisma.crmWorkDaily.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportType: 'daily',
            senderId: 'emp-1',
          }),
        })
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated results with default params', async () => {
      const dailies = [buildCrmWorkDaily(), buildCrmWorkDaily()];
      mockPrisma.crmWorkDaily.findMany.mockResolvedValue(dailies);
      mockPrisma.crmWorkDaily.count.mockResolvedValue(2);

      const result = await service.findAll({
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      } as Parameters<typeof service.findAll>[0]);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.crmWorkDaily.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.crmWorkDaily.findMany.mockResolvedValue([]);
      mockPrisma.crmWorkDaily.count.mockResolvedValue(0);

      await service.findAll({
        keyword: '张三',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      } as Parameters<typeof service.findAll>[0]);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '张三' })
      );
    });

    it('should forward senderId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.crmWorkDaily.findMany.mockResolvedValue([]);
      mockPrisma.crmWorkDaily.count.mockResolvedValue(0);

      await service.findAll({
        senderId: 'sender-1',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      } as Parameters<typeof service.findAll>[0]);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ senderId: 'sender-1' }),
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return a work daily detail', async () => {
      const daily = buildCrmWorkDaily({ id: 'daily-1' });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(daily);

      const result = await service.findOne('daily-1');

      expect(result).toBeDefined();
      expect(result.id).toBe('daily-1');
      expect(mockPrisma.crmWorkDaily.findFirst).toHaveBeenCalledWith({
        where: { id: 'daily-1', deletedAt: null },
        include: {
          sender: { select: { id: true, name: true } },
        },
      });
    });

    it('should throw NotFoundException when work daily does not exist', async () => {
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update with optimistic lock (version check)', async () => {
      const existing = buildCrmWorkDaily({ id: 'daily-1', version: 1 });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(existing);
      mockPrisma.crmWorkDaily.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'daily-1',
        { keyCustomerSummary: '更新内容', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.crmWorkDaily.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'daily-1', version: 1 },
          data: expect.objectContaining({
            keyCustomerSummary: '更新内容',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('should persist newContactMethodCount on update', async () => {
      const existing = buildCrmWorkDaily({ id: 'daily-1', version: 1 });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(existing);
      mockPrisma.crmWorkDaily.update.mockResolvedValue({
        ...existing,
        newContactMethodCount: 5,
        version: 2,
      });

      await service.update(
        'daily-1',
        { newContactMethodCount: 5, version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.crmWorkDaily.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            newContactMethodCount: 5,
          }),
        })
      );
    });

    it('should set attachments to Prisma.JsonNull when cleared', async () => {
      const existing = buildCrmWorkDaily({
        id: 'daily-1',
        attachments: [{ name: 'old.pdf', url: 'https://example.com/old.pdf' }],
      });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(existing);
      mockPrisma.crmWorkDaily.update.mockResolvedValue({ ...existing, attachments: null });

      await service.update(
        'daily-1',
        { attachments: null, version: 1 } as unknown as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.crmWorkDaily.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: Prisma.JsonNull,
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const existing = buildCrmWorkDaily({ id: 'daily-1', version: 1 });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(existing);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.crmWorkDaily.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'daily-1',
          { keyCustomerSummary: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildCrmWorkDaily({ id: 'daily-1' });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(existing);
      mockPrisma.crmWorkDaily.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update(
          'daily-1',
          { keyCustomerSummary: '更新' } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('DB connection lost');
    });
  });

  describe('remove', () => {
    it('should soft delete by setting deletedAt', async () => {
      const daily = buildCrmWorkDaily({ id: 'daily-1' });
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(daily);
      mockPrisma.crmWorkDaily.update.mockResolvedValue(daily);

      await service.remove('daily-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.crmWorkDaily.update).toHaveBeenCalledWith({
        where: { id: 'daily-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException when work daily does not exist', async () => {
      mockPrisma.crmWorkDaily.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('non-exist', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });
});
