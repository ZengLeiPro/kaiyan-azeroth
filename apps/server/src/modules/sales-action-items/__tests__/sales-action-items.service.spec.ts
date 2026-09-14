import type { CreateSalesActionItemInput } from '@ky-azeroth/shared/schemas/sales-action-item';
import { BadRequestException } from '@nestjs/common';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import type { KeepRecordsService } from '../../keep-records/keep-records.service';
import { SalesActionItemsService } from '../sales-action-items.service';

type ActionRecord = Record<string, unknown> & {
  id: string;
  employeeId: string;
  refType: string | null;
  refId: string | null;
  status: string;
  version: number;
  resultType: string | null;
  resultId: string | null;
};

const actor = { id: 'emp-1', employeeId: 'emp-1' };
const createEmployeeId = '11111111-1111-4111-8111-111111111111';
const createCustomerId = '22222222-2222-4222-8222-222222222222';

function buildCreateInput(
  overrides: Partial<CreateSalesActionItemInput> = {}
): CreateSalesActionItemInput {
  return {
    employeeId: createEmployeeId,
    category: 'FOLLOW_UP_DUE',
    priority: 90,
    title: '跟进到期',
    reason: '客户 7 天无跟进',
    confidence: 'HIGH',
    dedupKey: 'FOLLOW_UP_DUE:cust-1',
    ...overrides,
  };
}

function buildActionRecord(overrides: Partial<ActionRecord> = {}): ActionRecord {
  const now = new Date('2026-06-05T10:00:00.000Z');
  return {
    id: 'action-1',
    employeeId: 'emp-1',
    category: 'FOLLOW_UP_DUE',
    priority: 90,
    refType: 'Customer',
    refId: 'cust-1',
    title: '跟进到期',
    reason: '客户 7 天无跟进',
    suggestedAction: null,
    aiDraft: null,
    evidence: null,
    confidence: 'HIGH',
    dedupKey: 'FOLLOW_UP_DUE:cust-1',
    status: 'pending',
    resolveNote: null,
    doneType: null,
    snoozeUntil: null,
    remindCount: 0,
    resultType: null,
    resultId: null,
    sourceRunId: 'nightly-20260605',
    createdVia: 'cron',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    employee: { id: 'emp-1', name: '销售A' },
    resolvedBy: null,
    ...overrides,
  };
}

describe('SalesActionItemsService', () => {
  let service: SalesActionItemsService;
  let mockPrisma: MockPrismaService;
  let mockKeepRecordsService: {
    create: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockKeepRecordsService = {
      create: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    mockFilterApplier = { buildWhere: vi.fn() };

    service = new SalesActionItemsService(
      asPrismaService(mockPrisma),
      mockKeepRecordsService as unknown as KeepRecordsService,
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create/find/count', () => {
    it('should create and serialize an action item with JSON payloads', async () => {
      const created = buildActionRecord({
        aiDraft: {
          kind: 'keep_record',
          matchMode: 'FULL_NAME_EXPLICIT',
          matchedCustomerId: createCustomerId,
          matchedFullName: '客户A',
          evidenceMessageId: 'msg-1',
          payload: {
            customerId: createCustomerId,
            keepRecordType: 'phone',
            keepRecordContent: '已电话沟通',
            keepRecordTime: '2026-06-05T10:00:00.000Z',
          },
        },
        evidence: [{ type: 'crm', table: 'customer', refId: 'cust-1', excerpt: '客户无跟进' }],
      });
      mockPrisma.salesActionItem.create.mockResolvedValue(created);

      const result = await service.create(
        {
          employeeId: createEmployeeId,
          category: 'FOLLOW_UP_DUE',
          priority: 90,
          refType: 'Customer',
          refId: 'cust-1',
          title: '跟进到期',
          reason: '客户 7 天无跟进',
          aiDraft: {
            kind: 'keep_record',
            matchMode: 'FULL_NAME_EXPLICIT',
            matchedCustomerId: createCustomerId,
            matchedFullName: '客户A',
            evidenceMessageId: 'msg-1',
            payload: {
              customerId: createCustomerId,
              keepRecordType: 'phone',
              keepRecordContent: '已电话沟通',
              keepRecordTime: '2026-06-05T10:00:00.000Z',
            },
          },
          evidence: [{ type: 'crm', table: 'customer', refId: 'cust-1', excerpt: '客户无跟进' }],
          confidence: 'HIGH',
          dedupKey: 'FOLLOW_UP_DUE:cust-1',
          sourceRunId: 'nightly-20260605',
          createdVia: 'cron',
        },
        actor
      );

      expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: createEmployeeId,
          aiDraft: expect.objectContaining({ kind: 'keep_record' }),
          evidence: [{ type: 'crm', table: 'customer', refId: 'cust-1', excerpt: '客户无跟进' }],
          creatorEmployeeId: 'emp-1',
          updaterEmployeeId: 'emp-1',
        }),
      });
      expect(result.aiDraft).toEqual(
        expect.objectContaining({
          kind: 'keep_record',
          payload: expect.objectContaining({ customerId: createCustomerId }),
        })
      );
      expect(result.evidence).toEqual([
        { type: 'crm', table: 'customer', refId: 'cust-1', excerpt: '客户无跟进' },
      ]);
    });

    it.each([
      'javascript:alert(1)',
      'https://user:password@example.com/doc',
      'https://example.com/path\\doc',
      'https://example.com/%255Cdoc',
      'https://example.com/%',
      'https://example.com/%ZZ',
      'https://example.com/%25ZZ',
      'https://example.com/%00',
      'https://example.com/%0d%0aevil',
      'https://example.com/%250Aevil',
      'https://example.com/%E2%80%8Bhidden',
      'https://example.com/%25E2%2580%258Bhidden',
      'https://example.com/\u200bhidden',
      'https://example.com/\u202ehidden',
      'https://example.com/\u2060hidden',
      'https://例子.测试/doc',
      ' https://example.com/doc',
      'https://example.com/doc ',
    ])('rejects unsafe document URL %j with 400 before create reaches Prisma', async (url) => {
      const error = await service
        .create(buildCreateInput({ evidence: [{ type: 'doc', title: '危险文档', url }] }), actor)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      if (!(error instanceof BadRequestException)) throw new Error('expected BadRequestException');
      expect(error.getStatus()).toBe(400);
      expect(error.message).toContain('evidence.0.url');
      expect(mockPrisma.salesActionItem.create).not.toHaveBeenCalled();
    });

    it('rebuilds dirty legacy evidence from whitelists without failing or writing back', async () => {
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(
        buildActionRecord({
          refType: null,
          refId: null,
          evidence: [
            {
              type: 'doc',
              title: '危险历史文档',
              url: 'https://user:password@example.com/doc',
              extra: 'must-not-leak',
            },
            {
              type: 'doc',
              title: '首尾空格历史文档',
              url: '  https://example.com/doc  ',
              extra: 'must-not-leak',
            },
            {
              type: 'doc',
              title: '双重编码危险历史文档',
              url: 'https://example.com/%25E2%2580%258Bhidden',
              extra: 'must-not-leak',
            },
            {
              type: 'doc',
              title: '旧编码历史文档',
              url: 'https://example.com/%D6%D0%CE%C4?raw=%FF',
              extra: 'must-not-leak',
            },
            {
              type: 'doc',
              title: '安全历史文档',
              url: 'HTTPS://EXAMPLE.COM:443/doc?q=1#hash',
              extra: 'must-not-leak',
            },
            {
              type: 'crm',
              table: 'customer',
              refId: 'cust-1',
              excerpt: '客户无跟进',
              url: 'javascript:alert(1)',
              extra: { secret: true },
            },
            { type: 'unknown', title: '未知', url: 'https://example.com' },
          ],
        })
      );

      const result = await service.findOne('action-1', ['emp-1']);

      expect(result.evidence).toEqual([
        { type: 'doc', title: '危险历史文档' },
        { type: 'doc', title: '首尾空格历史文档' },
        { type: 'doc', title: '双重编码危险历史文档' },
        {
          type: 'doc',
          title: '旧编码历史文档',
          url: 'https://example.com/%D6%D0%CE%C4?raw=%FF',
        },
        {
          type: 'doc',
          title: '安全历史文档',
          url: 'https://example.com/doc?q=1#hash',
        },
        { type: 'crm', table: 'customer', refId: 'cust-1', excerpt: '客户无跟进' },
      ]);
      expect(mockPrisma.salesActionItem.update).not.toHaveBeenCalled();
    });

    it('should find action items with filter applier and resolve customer info', async () => {
      const item = buildActionRecord({ status: 'ignored' });
      mockFilterApplier.buildWhere.mockResolvedValue({
        deletedAt: null,
        employeeId: { in: ['emp-1'] },
      });
      mockPrisma.salesActionItem.count.mockResolvedValue(1);
      mockPrisma.salesActionItem.findMany.mockResolvedValue([item]);
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', customerName: '客户A' }]);

      const result = await service.findAll(
        { page: 2, pageSize: 10, sortOrder: 'desc', status: ['ignored'], keyword: '跟进' },
        ['emp-1'],
        undefined,
        { keyword: '跟进' }
      );

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyKeyword: '跟进',
          legacyFilters: expect.objectContaining({ status: ['ignored'] }),
          chargerScope: ['emp-1'],
          baseWhere: { deletedAt: null },
        })
      );
      expect(mockPrisma.salesActionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          where: { deletedAt: null, employeeId: { in: ['emp-1'] } },
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          total: 1,
          page: 2,
          pageSize: 10,
          totalPages: 1,
          items: [
            expect.objectContaining({
              id: 'action-1',
              customerName: '客户A',
              customer: { id: 'cust-1', customerName: '客户A' },
            }),
          ],
        })
      );
    });

    it('should count pending mine after auto-expire scan', async () => {
      mockPrisma.salesActionItem.findMany.mockResolvedValue([]);
      mockPrisma.salesActionItem.count.mockResolvedValue(3);

      const result = await service.countMine('emp-1', ['FOLLOW_UP_DUE']);

      expect(mockPrisma.salesActionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: 'emp-1',
            status: 'pending',
            deletedAt: null,
          }),
        })
      );
      expect(mockPrisma.salesActionItem.count).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          employeeId: 'emp-1',
          status: 'pending',
          category: { in: ['FOLLOW_UP_DUE'] },
        },
      });
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('update validation', () => {
    it('rejects unsafe evidence before reading or writing Prisma', async () => {
      const error = await service
        .update(
          'action-1',
          { evidence: [{ type: 'doc', title: '危险文档', url: 'file:///etc/passwd' }] },
          actor,
          ['emp-1']
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      if (!(error instanceof BadRequestException)) throw new Error('expected BadRequestException');
      expect(error.getStatus()).toBe(400);
      expect(mockPrisma.salesActionItem.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.salesActionItem.update).not.toHaveBeenCalled();
    });
  });

  describe('upsertCandidate', () => {
    it('should merge an active duplicate candidate instead of creating another one', async () => {
      const existing = buildActionRecord({ status: 'snoozed', remindCount: 1 });
      const merged = buildActionRecord({ priority: 95, remindCount: 2 });
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(existing);
      mockPrisma.salesActionItem.update.mockResolvedValue(merged);

      const result = await service.upsertCandidate(
        {
          employeeId: createEmployeeId,
          category: 'FOLLOW_UP_DUE',
          priority: 95,
          refType: 'Customer',
          refId: 'cust-1',
          title: '跟进到期',
          reason: '客户 30 天无跟进',
          suggestedAction: '今天联系客户',
          confidence: 'HIGH',
          dedupKey: 'FOLLOW_UP_DUE:cust-1',
          evidence: [
            {
              type: 'crm',
              table: 'customer',
              refId: 'cust-1',
              excerpt: '30 天无跟进',
            },
          ],
          sourceRunId: 'nightly-20260608',
        },
        actor
      );

      expect(mockPrisma.salesActionItem.update).toHaveBeenCalledWith({
        where: { id: 'action-1' },
        data: expect.objectContaining({
          priority: 95,
          reason: '客户 30 天无跟进',
          remindCount: { increment: 1 },
          evidence: [
            {
              type: 'crm',
              table: 'customer',
              refId: 'cust-1',
              excerpt: '30 天无跟进',
            },
          ],
          updaterEmployeeId: 'emp-1',
        }),
      });
      expect(mockPrisma.salesActionItem.create).not.toHaveBeenCalled();
      expect(result.priority).toBe(95);
    });

    it('rejects unsafe internal candidates before duplicate lookup or write', async () => {
      const error = await service
        .upsertCandidate(
          buildCreateInput({
            evidence: [{ type: 'doc', title: '危险文档', url: '//example.com/doc' }],
          }),
          actor
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      if (!(error instanceof BadRequestException)) throw new Error('expected BadRequestException');
      expect(error.getStatus()).toBe(400);
      expect(mockPrisma.salesActionItem.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.salesActionItem.update).not.toHaveBeenCalled();
      expect(mockPrisma.salesActionItem.create).not.toHaveBeenCalled();
    });
  });

  describe('adopt', () => {
    const adoptableDraft = {
      kind: 'keep_record',
      matchMode: 'FULL_NAME_EXPLICIT',
      matchedCustomerId: 'cust-1',
      matchedFullName: '客户A',
      evidenceMessageId: 'msg-1',
      payload: {
        customerId: 'cust-1',
        keepRecordType: 'phone',
        keepRecordTime: '2026-06-05T10:00:00.000Z',
        keepRecordContent: '采纳后电话跟进',
      },
    };

    it('采纳待办、跟进主写与客户派生共用同一事务并按顺序执行', async () => {
      const pending = buildActionRecord({ aiDraft: adoptableDraft });
      const adopted = buildActionRecord({
        status: 'adopted',
        resultType: 'keep_record',
        resultId: 'keep-1',
        version: 2,
      });
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(pending);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockKeepRecordsService.create.mockResolvedValue({ id: 'keep-1', customerId: 'cust-1' });
      mockPrisma.salesActionItem.update.mockResolvedValue(adopted);

      const result = await service.adopt('action-1', actor, ['emp-1']);

      expect(result.status).toBe('adopted');
      expect(mockKeepRecordsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          source: 'action_item',
          sourceActionItemId: 'action-1',
        }),
        actor,
        { tx: mockPrisma }
      );
      expect(mockPrisma.salesActionItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockKeepRecordsService.create.mock.invocationCallOrder[0]!
      );
      expect(mockKeepRecordsService.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.salesActionItem.update.mock.invocationCallOrder[0]!
      );
    });

    it('采纳跟进或生命周期失败时待办抢占事务整体回滚', async () => {
      const pending = buildActionRecord({ aiDraft: adoptableDraft });
      let rolledBack = false;
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(pending);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockKeepRecordsService.create.mockRejectedValue(new Error('adopt lifecycle failed'));
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

      await expect(service.adopt('action-1', actor, ['emp-1'])).rejects.toThrow(
        'adopt lifecycle failed'
      );

      expect(rolledBack).toBe(true);
      expect(mockKeepRecordsService.create).toHaveBeenCalledWith(expect.anything(), actor, {
        tx: mockPrisma,
      });
      expect(mockPrisma.salesActionItem.update).not.toHaveBeenCalled();
    });
  });

  describe('done', () => {
    it('should mark pending item as done without creating keep record for regular done type', async () => {
      const pending = buildActionRecord();
      const done = buildActionRecord({
        status: 'done',
        doneType: 'other',
        resolveNote: '已处理',
        version: 2,
      });
      mockPrisma.salesActionItem.findFirst
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(done);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.done('action-1', '已处理', 'other', actor, ['emp-1']);

      expect(mockPrisma.salesActionItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'action-1', status: 'pending' },
        data: expect.objectContaining({
          status: 'done',
          resolveNote: '已处理',
          doneType: 'other',
          resolvedById: 'emp-1',
        }),
      });
      expect(mockKeepRecordsService.create).not.toHaveBeenCalled();
      expect(result.status).toBe('done');
    });

    it('should reject keep record payload for non follow_recorded done type', async () => {
      const pending = buildActionRecord();
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(pending);

      await expect(
        service.done('action-1', '已处理', 'other', actor, ['emp-1'], {
          keepRecordType: 'phone',
          keepRecordTime: '2026-06-05T10:00:00.000Z',
          keepRecordContent: '已沟通',
          keepRecordStatus: '客户维护',
        })
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockPrisma.salesActionItem.updateMany).not.toHaveBeenCalled();
    });

    it('should create a keep record when doneType is follow_recorded', async () => {
      const pending = buildActionRecord();
      const updated = buildActionRecord({
        status: 'done',
        doneType: 'follow_recorded',
        resolveNote: '已电话沟通，客户确认下周三演示',
        resultType: 'keep_record',
        resultId: 'keep-1',
        version: 2,
      });
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(pending);
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', customerName: '客户A' }]);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.salesActionItem.update.mockResolvedValue(updated);
      mockKeepRecordsService.create.mockResolvedValue({
        id: 'keep-1',
        customerId: 'cust-1',
      });

      await service.done(
        'action-1',
        '已电话沟通，客户确认下周三演示',
        'follow_recorded',
        actor,
        ['emp-1'],
        {
          keepRecordType: 'phone',
          keepRecordTime: '2026-06-05T10:00:00.000Z',
          keepRecordContent: '已电话沟通，客户确认下周三演示',
          keepRecordStatus: '客户维护',
        }
      );

      expect(mockKeepRecordsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          contactId: null,
          keepRecordType: 'phone',
          keepRecordTime: '2026-06-05T10:00:00.000Z',
          keepRecordContent: '已电话沟通，客户确认下周三演示',
          keepRecordStatus: '客户维护',
          chargerId: 'emp-1',
          source: 'action_item',
          sourceActionItemId: 'action-1',
        }),
        actor,
        { tx: mockPrisma }
      );
      expect(mockPrisma.salesActionItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'action-1', status: 'pending', version: 1 },
          data: expect.objectContaining({
            status: 'done',
            doneType: 'follow_recorded',
            resultType: 'keep_record',
          }),
        })
      );
      expect(mockPrisma.salesActionItem.update).toHaveBeenCalledWith({
        where: { id: 'action-1' },
        data: { resultId: 'keep-1' },
      });
      expect(mockPrisma.salesActionItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockKeepRecordsService.create.mock.invocationCallOrder[0]!
      );
      expect(mockKeepRecordsService.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.salesActionItem.update.mock.invocationCallOrder[0]!
      );
    });

    it('跟进创建或其生命周期失败时办结待办事务整体回滚', async () => {
      const pending = buildActionRecord();
      let rolledBack = false;
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(pending);
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', customerName: '客户A' }]);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockKeepRecordsService.create.mockRejectedValue(new Error('keep lifecycle failed'));
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
        service.done('action-1', '已沟通', 'follow_recorded', actor, ['emp-1'], {
          keepRecordType: 'phone',
          keepRecordTime: '2026-06-05T10:00:00.000Z',
          keepRecordContent: '原子跟进',
          keepRecordStatus: '客户维护',
        })
      ).rejects.toThrow('keep lifecycle failed');

      expect(rolledBack).toBe(true);
      expect(mockKeepRecordsService.create).toHaveBeenCalledWith(expect.anything(), actor, {
        tx: mockPrisma,
      });
      expect(mockPrisma.salesActionItem.update).not.toHaveBeenCalled();
    });

    it('should reject follow_recorded when the customer cannot be resolved structurally', async () => {
      const pending = buildActionRecord({ refType: null, refId: null });
      mockPrisma.salesActionItem.findFirst.mockResolvedValue(pending);

      await expect(
        service.done('action-1', '已沟通', 'follow_recorded', actor, ['emp-1'], {
          keepRecordType: 'phone',
          keepRecordTime: '2026-06-05T10:00:00.000Z',
          keepRecordContent: '已沟通',
          keepRecordStatus: '客户维护',
        })
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockKeepRecordsService.create).not.toHaveBeenCalled();
      expect(mockPrisma.salesActionItem.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('reopen', () => {
    it('should soft delete the keep record created by follow_recorded done', async () => {
      const done = buildActionRecord({
        status: 'done',
        doneType: 'follow_recorded',
        resultType: 'keep_record',
        resultId: 'keep-1',
        version: 2,
      });
      const reopened = buildActionRecord({ status: 'pending', version: 3 });
      mockPrisma.salesActionItem.findFirst
        .mockResolvedValueOnce(done)
        .mockResolvedValueOnce(reopened);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.keepRecord.findUnique.mockResolvedValue({ customerId: 'cust-1', version: 4 });

      await service.reopen('action-1', actor, ['emp-1']);

      expect(mockPrisma.salesActionItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'action-1', status: 'done', version: 2 },
          data: expect.objectContaining({
            status: 'pending',
            resolveNote: null,
            doneType: null,
            resultType: null,
            resultId: null,
          }),
        })
      );
      expect(mockKeepRecordsService.remove).toHaveBeenCalledWith(
        'keep-1',
        actor,
        null,
        'emp-1',
        4,
        { tx: mockPrisma }
      );
      expect(mockPrisma.salesActionItem.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockKeepRecordsService.remove.mock.invocationCallOrder[0]!
      );
    });
  });

  describe('transfer', () => {
    it('should create a target pending item, mark source transferred, and write operation log', async () => {
      const pending = buildActionRecord();
      const target = buildActionRecord({
        id: 'action-2',
        employeeId: 'emp-2',
        createdVia: 'transfer',
        employee: { id: 'emp-2', name: '销售B' },
      });
      const manager = { id: 'manager-1', employeeId: 'manager-1' };
      mockPrisma.salesActionItem.findFirst
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(target);
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-2', name: '销售B' });
      mockPrisma.salesActionItem.create.mockResolvedValue(target);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.operationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', customerName: '客户A' }]);

      const result = await service.transfer(
        'action-1',
        'emp-2',
        '客户已由销售B接手',
        manager,
        null
      );

      // ORG-01 后 where 由 ACTIVE_EMPLOYEE_WHERE 展开（+canLogin），id 仍在 spread 后
      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith({
        where: { deletedAt: null, status: 'active', canLogin: true, id: 'emp-2' },
        select: { id: true, name: true },
      });
      expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: 'emp-2',
          category: 'FOLLOW_UP_DUE',
          dedupKey: 'FOLLOW_UP_DUE:cust-1',
          createdVia: 'transfer',
          creatorEmployeeId: 'manager-1',
          updaterEmployeeId: 'manager-1',
        }),
      });
      expect(mockPrisma.salesActionItem.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'action-1',
          status: { in: ['pending', 'snoozed'] },
          version: 1,
        },
        data: expect.objectContaining({
          status: 'transferred',
          resolveNote: '转交给销售B：客户已由销售B接手',
          resultType: 'sales_action_item',
          resultId: 'action-2',
          resolvedById: 'manager-1',
          updaterEmployeeId: 'manager-1',
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          employeeId: 'manager-1',
          module: 'sales_action_items',
          action: 'transfer',
          target: 'action-1',
          details: expect.objectContaining({
            sourceItemId: 'action-1',
            targetItemId: 'action-2',
            fromEmployeeId: 'emp-1',
            toEmployeeId: 'emp-2',
            reason: '客户已由销售B接手',
            mergedIntoExisting: false,
          }),
        }),
      });
      expect(result.id).toBe('action-2');
    });

    it('sanitizes dirty historical evidence before creating the transferred target', async () => {
      const pending = buildActionRecord({
        evidence: [
          {
            type: 'doc',
            title: '危险历史文档',
            url: 'https://user:password@example.com/doc',
            extra: 'must-not-leak',
          },
          {
            type: 'doc',
            title: '双重编码危险历史文档',
            url: 'https://example.com/%255Cdoc',
            extra: 'must-not-leak',
          },
          {
            type: 'doc',
            title: 'GBK 历史文档',
            url: 'https://example.com/%D6%D0%CE%C4',
            extra: 'must-not-leak',
          },
          {
            type: 'doc',
            title: '安全历史文档',
            url: 'HTTPS://EXAMPLE.COM:443/doc?q=1#hash',
            extra: 'must-not-leak',
          },
          {
            type: 'crm',
            table: 'customer',
            refId: 'cust-1',
            excerpt: '客户无跟进',
            url: 'javascript:alert(1)',
            extra: { secret: true },
          },
          { type: 'unknown', url: 'https://evil.example', secret: true },
        ],
      });
      const target = buildActionRecord({
        id: 'action-2',
        employeeId: 'emp-2',
        createdVia: 'transfer',
        employee: { id: 'emp-2', name: '销售B' },
      });
      mockPrisma.salesActionItem.findFirst
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(target);
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-2', name: '销售B' });
      mockPrisma.salesActionItem.create.mockResolvedValue(target);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.operationLog.create.mockResolvedValue({ id: 'log-1' });
      mockPrisma.customer.findMany.mockResolvedValue([{ id: 'cust-1', customerName: '客户A' }]);

      await service.transfer('action-1', 'emp-2', '交给销售B', actor, null);

      expect(mockPrisma.salesActionItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          evidence: [
            { type: 'doc', title: '危险历史文档' },
            { type: 'doc', title: '双重编码危险历史文档' },
            {
              type: 'doc',
              title: 'GBK 历史文档',
              url: 'https://example.com/%D6%D0%CE%C4',
            },
            {
              type: 'doc',
              title: '安全历史文档',
              url: 'https://example.com/doc?q=1#hash',
            },
            { type: 'crm', table: 'customer', refId: 'cust-1', excerpt: '客户无跟进' },
          ],
        }),
      });
    });
  });

  describe('ignore/autoExpire/query helpers', () => {
    it('should ignore a pending item with audit fields', async () => {
      const pending = buildActionRecord();
      const ignored = buildActionRecord({
        status: 'ignored',
        resolveNote: '本周不跟进',
        version: 2,
      });
      mockPrisma.salesActionItem.findFirst
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(ignored);
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.ignore('action-1', '本周不跟进', actor, ['emp-1']);

      expect(mockPrisma.salesActionItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'action-1', status: 'pending' },
        data: expect.objectContaining({
          status: 'ignored',
          resolveNote: '本周不跟进',
          resolvedById: 'emp-1',
          version: { increment: 1 },
        }),
      });
      expect(result.status).toBe('ignored');
    });

    it('should auto-expire recovered customer gaps', async () => {
      const createdAt = new Date('2026-06-01T00:00:00.000Z');
      mockPrisma.salesActionItem.findMany.mockResolvedValue([
        {
          id: 'action-1',
          refType: 'Customer',
          refId: 'cust-1',
          createdAt,
          category: 'FOLLOW_UP_DUE',
        },
      ]);
      mockPrisma.keepRecord.findFirst.mockResolvedValue(null);
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);
      mockPrisma.payment.findFirst.mockResolvedValue({ id: 'pay-1' });
      mockPrisma.salesActionItem.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.autoExpireForEmployee('emp-1');

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
        where: {
          customerId: 'cust-1',
          direction: 'IN',
          deletedAt: null,
          createdAt: { gt: createdAt },
        },
        select: { id: true },
      });
      expect(mockPrisma.salesActionItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['action-1'] }, status: 'pending' },
        data: expect.objectContaining({ status: 'auto_expired' }),
      });
      expect(count).toBe(1);
    });

    it('should return sleeping customers with normalized dates', async () => {
      const lastKeepRecordTime = new Date('2026-05-01T08:00:00.000Z');
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust-1',
          customerName: '客户A',
          customerLevel: 'A',
          chargerId: 'emp-1',
          lastKeepRecordTime,
        },
      ]);

      const result = await service.getSleepingCustomers(['emp-1'], 30);

      expect(mockPrisma.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chargerId: { in: ['emp-1'] },
            customerLevel: { in: ['S', 'A'] },
          }),
          take: 500,
        })
      );
      expect(result[0]).toEqual(
        expect.objectContaining({
          customerId: 'cust-1',
          customerName: '客户A',
          lastKeepRecordTime: '2026-05-01T08:00:00.000Z',
          daysSinceLastKeep: expect.any(Number),
        })
      );
    });

    it('should return due opportunities with date-only expectedDealDate', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([
        {
          id: 'opp-1',
          opportunityName: '商机A',
          customerId: 'cust-1',
          opportunityStage: 'following',
          expectedDealDate: new Date('2026-06-08T12:00:00.000Z'),
          chargerId: 'emp-1',
        },
      ]);

      const result = await service.getDueOpportunities(['emp-1']);

      expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            chargerId: { in: ['emp-1'] },
            expectedDealDate: expect.any(Object),
          }),
          take: 500,
        })
      );
      expect(result).toEqual([
        {
          opportunityId: 'opp-1',
          opportunityName: '商机A',
          customerId: 'cust-1',
          opportunityStage: 'following',
          expectedDealDate: '2026-06-08',
          chargerId: 'emp-1',
        },
      ]);
    });

    it('should keep only customers with silent receivables', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust-old',
          customerName: '客户旧',
          chargerId: 'emp-1',
          accountsReceivable: 1200,
        },
        {
          id: 'cust-new',
          customerName: '客户新',
          chargerId: 'emp-1',
          accountsReceivable: 800,
        },
      ]);
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({ businessDate: new Date('2020-01-01T00:00:00.000Z') })
        .mockResolvedValueOnce({ businessDate: new Date('2099-01-01T00:00:00.000Z') });

      const result = await service.getSilentReceivables(['emp-1'], 30);

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        expect.objectContaining({
          customerId: 'cust-old',
          customerName: '客户旧',
          accountsReceivable: 1200,
          lastInPaymentDate: '2020-01-01',
          daysSinceLastIn: expect.any(Number),
        }),
      ]);
    });
  });
});
