import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildKeepRecord } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import type { CustomerLifecycleService } from '../../customers/customer-lifecycle.service';
import { KeepRecordsService } from '../keep-records.service';

function buildKeepRecordWithRelations(overrides = {}) {
  const record = buildKeepRecord(overrides);
  return {
    ...record,
    customer: { id: record.customerId, customerName: '客户A', shortName: 'A' },
    contact: null as { id: string; contactName: string } | null,
  };
}

describe('KeepRecordsService', () => {
  let service: KeepRecordsService;
  let mockPrisma: MockPrismaService;
  let mockCustomerLifecycle: {
    refresh: ReturnType<typeof vi.fn>;
  };
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockCustomerLifecycle = {
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });

    service = new KeepRecordsService(
      asPrismaService(mockPrisma),
      mockCustomerLifecycle as unknown as CustomerLifecycleService,
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('回访日期响应契约', () => {
    it.each([new Date('2026-09-11T00:00:00.000Z'), '2026-09-11T00:00:00.000Z', null])(
      '详情和列表统一返回纯日期：%s',
      async (nextFollowUpAt) => {
        const record = { ...buildKeepRecordWithRelations(), nextFollowUpAt };
        mockPrisma.keepRecord.findFirst.mockResolvedValue(record);
        mockPrisma.keepRecord.findMany.mockResolvedValue([record]);
        mockPrisma.keepRecord.count.mockResolvedValue(1);
        const expectedDate = nextFollowUpAt ? '2026-09-11' : null;
        expect((await service.findOne(record.id)).nextFollowUpAt).toBe(expectedDate);
        const list = await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' });
        expect(list.items[0]?.nextFollowUpAt).toBe(expectedDate);
      }
    );

    it('创建后回读的纯日期可用于再次更新，写入仍为UTC零点Date', async () => {
      const nextFollowUpAt = new Date('2026-09-11T00:00:00.000Z');
      const record = { ...buildKeepRecordWithRelations(), nextFollowUpAt };
      mockPrisma.keepRecord.create.mockResolvedValue(record);
      mockPrisma.keepRecord.findFirst.mockResolvedValue(record);
      mockPrisma.keepRecord.update.mockResolvedValue(record);
      const actor = { id: 'user-1', employeeId: 'emp-1' };
      const created = await service.create(
        {
          customerId: record.customerId,
          keepRecordType: 'phone',
          keepRecordTime: '2026-09-08T02:00:00.000Z',
          keepRecordContent: '确认演示',
          keepRecordStatus: '客户维护',
          chargerId: 'emp-1',
          intentTemperature: 'HIGH',
          intentReasons: ['DEMO'],
          nextFollowUpAt: '2026-09-11',
        },
        actor
      );
      expect(created.nextFollowUpAt).toBe('2026-09-11');
      const updated = await service.update(
        record.id,
        { version: 1, nextFollowUpAt: created.nextFollowUpAt },
        actor
      );
      expect(updated.nextFollowUpAt).toBe('2026-09-11');
      expect(mockPrisma.keepRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ nextFollowUpAt }) })
      );
      expect(mockPrisma.keepRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ nextFollowUpAt }) })
      );
    });
  });

  // ─── create ───────────────────────────────────────────────

  describe('create', () => {
    it('should create a keep record with customer and contact includes', async () => {
      const record = buildKeepRecordWithRelations();
      record.contact = { id: 'contact-1', contactName: '联系人A' };
      mockPrisma.keepRecord.create.mockResolvedValue(record);

      const result = await service.create(
        {
          customerId: 'cust-1',
          contactId: 'contact-1',
          keepRecordContent: '电话沟通',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(mockCustomerLifecycle.refresh).toHaveBeenCalledWith(
        record.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.keepRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            contactId: 'contact-1',
            keepRecordContent: '电话沟通',
            flowStatus: 'approved',
          }),
          include: expect.objectContaining({
            customer: expect.anything(),
            contact: expect.anything(),
          }),
        })
      );
      expect(mockPrisma.keepRecord.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomerLifecycle.refresh.mock.invocationCallOrder[0]!
      );
    });

    it('软删除客户不能创建跟进记录', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { customerId: 'cust-deleted', keepRecordContent: '不应落库' } as Parameters<
            typeof service.create
          >[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-deleted', deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.keepRecord.create).not.toHaveBeenCalled();
    });

    it('主写后客户被并发软删时回滚跟进，不刷新派生状态', async () => {
      const record = buildKeepRecordWithRelations({ id: 'kr-race', customerId: 'cust-1' });
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ id: 'cust-1' })
        .mockResolvedValueOnce(null);
      mockPrisma.keepRecord.create.mockResolvedValue(record);

      await expect(
        service.create(
          { customerId: 'cust-1', keepRecordContent: '并发软删' } as Parameters<
            typeof service.create
          >[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.keepRecord.create).toHaveBeenCalled();
      expect(mockCustomerLifecycle.refresh).not.toHaveBeenCalled();
    });

    it('外部 TransactionClient 写真实跟进时在同一事务内刷新', async () => {
      const tx = createMockPrismaService();
      const record = buildKeepRecordWithRelations({
        id: 'kr-action',
        customerId: 'cust-1',
        source: 'action_item',
        flowStatus: 'approved',
      });
      tx.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      tx.keepRecord.create.mockResolvedValue(record);

      await service.create(
        {
          customerId: 'cust-1',
          keepRecordContent: '采纳行动项',
          source: 'action_item',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' },
        { tx: tx as unknown as Prisma.TransactionClient }
      );

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockCustomerLifecycle.refresh).toHaveBeenCalledWith(
        'cust-1',
        { id: 'user-1', employeeId: 'emp-user-1' },
        tx
      );
      expect(tx.keepRecord.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomerLifecycle.refresh.mock.invocationCallOrder[0]!
      );
    });

    it('field_change 系统留底与主写同事务，但不触发客户接触事实刷新', async () => {
      const record = buildKeepRecordWithRelations({
        id: 'kr-field-change',
        source: 'field_change',
        flowStatus: 'approved',
      });
      mockPrisma.keepRecord.create.mockResolvedValue(record);

      await service.create(
        {
          customerId: 'cust-1',
          keepRecordContent: '[系统] 线索阶段变更',
          source: 'field_change',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.keepRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'field_change', flowStatus: 'approved' }),
        })
      );
      expect(mockCustomerLifecycle.refresh).not.toHaveBeenCalled();
    });

    it('派生刷新失败会让跟进创建事务整体失败', async () => {
      const record = buildKeepRecordWithRelations({ flowStatus: 'approved' });
      let rolledBack = false;
      mockPrisma.keepRecord.create.mockResolvedValue(record);
      mockCustomerLifecycle.refresh.mockRejectedValue(new Error('derived refresh failed'));
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => {
          try {
            return await callback(mockPrisma);
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        }
      );

      await expect(
        service.create(
          { customerId: 'cust-1', keepRecordContent: '原子跟进' } as Parameters<
            typeof service.create
          >[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('derived refresh failed');

      expect(rolledBack).toBe(true);
    });

    it('should convert attachments to JSON value when provided', async () => {
      const attachments = [{ fileName: 'doc.pdf', fileUrl: 'https://example.com/doc.pdf' }];
      const record = buildKeepRecordWithRelations({ attachments });
      mockPrisma.keepRecord.create.mockResolvedValue(record);

      const result = await service.create(
        {
          customerId: 'cust-1',
          attachments,
        } as unknown as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(result.attachments).toBeDefined();
      // attachments data should have been passed through toJsonValue
      expect(mockPrisma.keepRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: expect.anything(),
          }),
        })
      );
    });
  });

  // ─── findAll ──────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated records with default params', async () => {
      const records = [buildKeepRecordWithRelations(), buildKeepRecordWithRelations()];
      mockPrisma.keepRecord.findMany.mockResolvedValue(records);
      mockPrisma.keepRecord.count.mockResolvedValue(2);

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
      expect(mockPrisma.keepRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should filter by keyword on keepRecordContent', async () => {
      mockPrisma.keepRecord.findMany.mockResolvedValue([]);
      mockPrisma.keepRecord.count.mockResolvedValue(0);

      await service.findAll({
        keyword: '电话',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      } as Parameters<typeof service.findAll>[0]);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '电话' })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.keepRecord.findMany.mockResolvedValue([]);
      mockPrisma.keepRecord.count.mockResolvedValue(0);

      await service.findAll({
        customerId: 'cust-1',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      } as Parameters<typeof service.findAll>[0]);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: 'cust-1' }),
        })
      );
    });

    it('should include customer and contact relations', async () => {
      mockPrisma.keepRecord.findMany.mockResolvedValue([]);
      mockPrisma.keepRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const } as Parameters<
        typeof service.findAll
      >[0]);

      expect(mockPrisma.keepRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            customer: expect.anything(),
            contact: expect.anything(),
          }),
        })
      );
    });

    it('should forward keepRecordType to FilterApplier (legacyFilters)', async () => {
      mockPrisma.keepRecord.findMany.mockResolvedValue([]);
      mockPrisma.keepRecord.count.mockResolvedValue(0);

      await service.findAll({
        keepRecordType: ['phone'],
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      } as Parameters<typeof service.findAll>[0]);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ keepRecordType: ['phone'] }),
        })
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a record with customer and contact includes', async () => {
      const record = buildKeepRecordWithRelations({
        id: 'kr-1',
        signLocation: '31.230000, 121.470000',
        signAddress: '上海市',
      });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(record);

      const result = await service.findOne('kr-1');

      expect(result).toBeDefined();
      expect('signLocation' in result).toBe(false);
      expect('signAddress' in result).toBe(false);
      expect(mockPrisma.keepRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'kr-1', deletedAt: null },
        include: expect.objectContaining({
          customer: expect.anything(),
          contact: expect.anything(),
        }),
      });
    });

    it('should throw NotFoundException when record does not exist', async () => {
      mockPrisma.keepRecord.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────

  describe('update', () => {
    it.each([undefined, 0, -1, 1.5])('非法 version=%s 时在主写前拒绝', async (version) => {
      await expect(
        service.update(
          'kr-1',
          { keepRecordContent: '非法版本', version } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.keepRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.keepRecord.update).not.toHaveBeenCalled();
    });

    it('事务内拒绝迁移到软删除客户', async () => {
      const existing = buildKeepRecordWithRelations({ id: 'kr-1', version: 1 });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'kr-1',
          { customerId: 'cust-deleted', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-deleted', deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.keepRecord.update).not.toHaveBeenCalled();
    });

    it('客户迁移按固定 CAS 写入并在同一事务完整刷新旧、新客户', async () => {
      const existing = buildKeepRecordWithRelations({
        id: 'kr-1',
        version: 3,
        customerId: 'cust-a',
      });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.keepRecord.update.mockResolvedValue({
        ...existing,
        customerId: 'cust-b',
        version: 4,
      });

      await service.update(
        'kr-1',
        { customerId: 'cust-b', version: 3 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.keepRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'kr-1', version: 3 } })
      );
      expect(mockCustomerLifecycle.refresh).toHaveBeenCalledWith(
        ['cust-a', 'cust-b'],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.keepRecord.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomerLifecycle.refresh.mock.invocationCallOrder[0]!
      );
    });

    it('更新后的生命周期重算失败时整个 CAS 事务回滚', async () => {
      const existing = buildKeepRecordWithRelations({ id: 'kr-1', version: 3 });
      let rolledBack = false;
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.keepRecord.update.mockResolvedValue({ ...existing, version: 4 });
      mockCustomerLifecycle.refresh.mockRejectedValue(new Error('lifecycle update failed'));
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: MockPrismaService) => Promise<unknown>) => {
          try {
            return await callback(mockPrisma);
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        }
      );

      await expect(
        service.update(
          'kr-1',
          { keepRecordContent: '原子更新', version: 3 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('lifecycle update failed');

      expect(rolledBack).toBe(true);
      expect(mockPrisma.keepRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'kr-1', version: 3 } })
      );
    });

    it('事务外快照版本与请求不一致时拒绝，避免并发迁移漏刷中间客户', async () => {
      const existing = buildKeepRecordWithRelations({
        id: 'kr-1',
        version: 4,
        customerId: 'cust-b',
      });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);

      await expect(
        service.update(
          'kr-1',
          { customerId: 'cust-c', version: 3 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.keepRecord.update).not.toHaveBeenCalled();
      expect(mockCustomerLifecycle.refresh).not.toHaveBeenCalled();
    });

    it('should update with optimistic lock (version check)', async () => {
      const existing = buildKeepRecordWithRelations({ id: 'kr-1', version: 1 });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.keepRecord.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'kr-1',
        {
          keepRecordContent: '更新内容',
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.keepRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'kr-1', version: 1 },
          data: expect.objectContaining({
            keepRecordContent: '更新内容',
            version: { increment: 1 },
          }),
        })
      );
      expect(mockCustomerLifecycle.refresh).toHaveBeenCalledWith(
        [existing.customerId, existing.customerId],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
    });

    it('should set attachments to Prisma.JsonNull when explicitly cleared', async () => {
      const existing = buildKeepRecordWithRelations({ id: 'kr-1' });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.keepRecord.update.mockResolvedValue({ ...existing, attachments: null });

      await service.update(
        'kr-1',
        {
          attachments: null,
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.keepRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: Prisma.JsonNull,
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const existing = buildKeepRecordWithRelations({ id: 'kr-1', version: 1 });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.keepRecord.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'kr-1',
          {
            keepRecordContent: '冲突',
            version: 1,
          } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildKeepRecordWithRelations({ id: 'kr-1' });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.keepRecord.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update(
          'kr-1',
          {
            keepRecordContent: '更新',
            version: 1,
          } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('DB connection lost');
    });
  });

  // ─── remove ───────────────────────────────────────────────

  describe('remove', () => {
    it.each([undefined, 0, -1, 1.5])('非法 version=%s 时拒绝删除', async (version) => {
      await expect(
        service.remove(
          'kr-1',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          version
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.keepRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.keepRecord.update).not.toHaveBeenCalled();
    });

    it('删除快照版本已过期时返回冲突且不写入', async () => {
      const record = buildKeepRecordWithRelations({ id: 'kr-1', version: 5 });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(record);

      await expect(
        service.remove('kr-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 4)
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.keepRecord.update).not.toHaveBeenCalled();
      expect(mockCustomerLifecycle.refresh).not.toHaveBeenCalled();
    });

    it('删除 CAS 在事务内竞争失败时映射为 409', async () => {
      const record = buildKeepRecordWithRelations({ id: 'kr-1', version: 5 });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(record);
      mockPrisma.keepRecord.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', { code: 'P2025', clientVersion: '0' })
      );

      await expect(
        service.remove('kr-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 5)
      ).rejects.toThrow(ConflictException);
    });

    it('should soft delete by setting deletedAt', async () => {
      const record = buildKeepRecordWithRelations({ id: 'kr-1' });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(record);
      mockPrisma.keepRecord.update.mockResolvedValue(record);

      await service.remove(
        'kr-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        record.version
      );

      expect(mockPrisma.keepRecord.update).toHaveBeenCalledWith({
        where: { id: 'kr-1', version: record.version },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      expect(mockCustomerLifecycle.refresh).toHaveBeenCalledWith(
        record.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.keepRecord.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomerLifecycle.refresh.mock.invocationCallOrder[0]!
      );
    });

    it('should throw NotFoundException when record does not exist', async () => {
      mockPrisma.keepRecord.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(
          'non-exist',
          { id: 'user-1', employeeId: 'emp-' + 'user-1' },
          undefined,
          undefined,
          1
        )
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('RBAC dual-path scope', () => {
    it('findAll should pass dual-path OR baseWhere when chargerScope provided', async () => {
      mockPrisma.keepRecord.findMany.mockResolvedValue([]);
      mockPrisma.keepRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, ['emp-B']);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: expect.objectContaining({
            deletedAt: null,
            // 三路径 OR：自身 chargerId / 客户 chargerId / 公海客户（customer.chargerId IS NULL）
            // 2026-06-04：放宽公海客户跟进记录对所有 view 权限可见，详见 data-scope.service.ts。
            OR: [
              { chargerId: { in: ['emp-B'] } },
              { customer: { chargerId: { in: ['emp-B'] } } },
              { customer: { chargerId: null } },
            ],
          }),
        })
      );
    });

    it('findOne should match record via customer.chargerId path', async () => {
      const record = buildKeepRecordWithRelations({ id: 'kr-orphan', chargerId: 'emp-A' });
      mockPrisma.keepRecord.findFirst.mockResolvedValue(record);

      const result = await service.findOne('kr-orphan', ['emp-B']);

      expect(result.id).toBe('kr-orphan');
      expect(mockPrisma.keepRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'kr-orphan',
            deletedAt: null,
            OR: [
              { chargerId: { in: ['emp-B'] } },
              { customer: { chargerId: { in: ['emp-B'] } } },
              { customer: { chargerId: null } },
            ],
          }),
        })
      );
    });

    it('findAll should expose public-pool records (customer.chargerId=NULL) to non-owners', async () => {
      // 验证公海可见路径：CUS90001 这类公海客户的历史跟进（chargerId=离职员工）
      // 对当前调用方 emp-B 也应可见——通过 customer.chargerId IS NULL OR 命中。
      mockPrisma.keepRecord.findMany.mockResolvedValue([]);
      mockPrisma.keepRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, ['emp-B']);

      const call = mockFilterApplier.buildWhere.mock.calls[0]![0] as {
        baseWhere: { OR: Array<Record<string, unknown>> };
      };
      expect(call.baseWhere.OR).toContainEqual({ customer: { chargerId: null } });
    });
  });
});
