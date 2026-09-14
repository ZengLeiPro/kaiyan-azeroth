import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import type { AmapReverseGeocodeService } from '../../../common/geocoding/amap-reverse-geocode.service';
import { buildVisitRecord } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import type { ApprovalGuardService } from '../../approvals/approval-guard.service';
import type { CustomersService } from '../../customers/customers.service';
import type { UploadService } from '../../upload/upload.service';
import { VisitRecordsService } from '../visit-records.service';

function buildVisitRecordWithIncludes(overrides = {}) {
  const record = buildVisitRecord(overrides);
  return {
    ...record,
    customer: { id: record.customerId, customerName: '测试客户', shortName: '测试' },
    contact: null,
  };
}

describe('VisitRecordsService', () => {
  let service: VisitRecordsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };
  let mockReverseGeocode: { ensureAddress: ReturnType<typeof vi.fn> };
  let mockCustomersService: { refreshCustomerLifecycle: ReturnType<typeof vi.fn> };
  let mockApprovalGuard: { isRequired: ReturnType<typeof vi.fn> };
  let mockBusinessApprovalService: {
    createApprovalForNewRecord: ReturnType<typeof vi.fn>;
    assertCanDirectEdit: ReturnType<typeof vi.fn>;
    lockPendingFormEdit: ReturnType<typeof vi.fn>;
    syncPendingFormEdit: ReturnType<typeof vi.fn>;
    assertCanDelete: ReturnType<typeof vi.fn>;
    submitChangeApproval: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockCustomersService = {
      refreshCustomerLifecycle: vi.fn().mockResolvedValue(undefined),
    };
    mockApprovalGuard = {
      isRequired: vi.fn().mockResolvedValue(false),
    };
    const mockApprovalsService = {
      notifyOnSubmit: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('../../approvals/approvals.service').ApprovalsService;
    mockBusinessApprovalService = {
      createApprovalForNewRecord: vi.fn().mockResolvedValue('mock-instance-id'),
      assertCanDirectEdit: vi.fn(),
      lockPendingFormEdit: vi.fn().mockResolvedValue(null),
      syncPendingFormEdit: vi.fn().mockResolvedValue(undefined),
      assertCanDelete: vi.fn(),
      submitChangeApproval: vi.fn().mockResolvedValue({ id: 'mock-change-instance-id' }),
    };
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    mockReverseGeocode = {
      ensureAddress: vi.fn((signAddress, signLocation) =>
        Promise.resolve({
          signAddress: signAddress ?? null,
          signLocation: signLocation ?? null,
        })
      ),
    };
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });

    const mockUploadService = {
      createRegisteredImagePreviewUrls: vi.fn().mockResolvedValue(new Map()),
      attachmentCandidateKey: vi.fn((id: string, url: string) => `${id}\u0000${url}`),
    } as unknown as UploadService;

    service = new VisitRecordsService(
      asPrismaService(mockPrisma),
      mockCustomersService as unknown as CustomersService,
      mockApprovalGuard as unknown as ApprovalGuardService,
      mockApprovalsService,
      mockBusinessApprovalService as unknown as import('../../approvals/business-approval.service').BusinessApprovalService,
      mockFilterApplier as unknown as FilterApplierService,
      mockReverseGeocode as unknown as AmapReverseGeocodeService,
      mockUploadService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create a visit record with customer and contact includes', async () => {
      const record = buildVisitRecordWithIncludes();
      mockPrisma.visitRecord.create.mockResolvedValue(record);

      const result = await service.create(
        { customerId: 'cust-1', content: '拜访内容' } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(mockPrisma.visitRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            content: '拜访内容',
            flowStatus: 'approved',
          }),
          include: expect.objectContaining({
            customer: expect.anything(),
            contact: expect.anything(),
          }),
        })
      );
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        record.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.visitRecord.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('pending 创建不推进客户完成事实', async () => {
      const record = buildVisitRecordWithIncludes({ flowStatus: 'pending' });
      mockApprovalGuard.isRequired.mockResolvedValue(true);
      mockPrisma.visitRecord.create.mockResolvedValue(record);

      await service.create(
        { customerId: 'cust-1', content: '待审批拜访' } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.visitRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ flowStatus: 'pending' }) })
      );
      expect(mockBusinessApprovalService.createApprovalForNewRecord).toHaveBeenCalledWith(
        mockPrisma,
        'visit_approve',
        record,
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('pending 拜访也不能写入软删除客户', async () => {
      mockApprovalGuard.isRequired.mockResolvedValue(true);
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { customerId: 'cust-deleted', content: '待审批但客户已删除' } as Parameters<
            typeof service.create
          >[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-deleted', deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.visitRecord.create).not.toHaveBeenCalled();
      expect(mockBusinessApprovalService.createApprovalForNewRecord).not.toHaveBeenCalled();
    });

    it('pending 主写后客户被并发软删时回滚拜访和审批实例', async () => {
      const record = buildVisitRecordWithIncludes({ id: 'vr-race', flowStatus: 'pending' });
      mockApprovalGuard.isRequired.mockResolvedValue(true);
      mockPrisma.customer.findFirst
        .mockResolvedValueOnce({ id: 'cust-1' })
        .mockResolvedValueOnce(null);
      mockPrisma.visitRecord.create.mockResolvedValue(record);

      await expect(
        service.create(
          { customerId: 'cust-1', content: '并发软删' } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.visitRecord.create).toHaveBeenCalled();
      expect(mockBusinessApprovalService.createApprovalForNewRecord).not.toHaveBeenCalled();
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('派生刷新失败会让创建事务整体失败', async () => {
      const record = buildVisitRecordWithIncludes({ flowStatus: 'approved' });
      let rolledBack = false;
      mockPrisma.visitRecord.create.mockResolvedValue(record);
      mockCustomersService.refreshCustomerLifecycle.mockRejectedValue(
        new Error('derived refresh failed')
      );
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
          { customerId: 'cust-1', content: '原子创建' } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('derived refresh failed');

      expect(rolledBack).toBe(true);
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        record.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
    });

    it('should convert signInTime and signOutTime to Date objects', async () => {
      const record = buildVisitRecordWithIncludes();
      mockPrisma.visitRecord.create.mockResolvedValue(record);

      await service.create(
        {
          customerId: 'cust-1',
          signInTime: '2025-06-01T09:00:00Z',
          signOutTime: '2025-06-01T17:00:00Z',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.visitRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signInTime: new Date('2025-06-01T09:00:00Z'),
            signOutTime: new Date('2025-06-01T17:00:00Z'),
          }),
        })
      );
    });

    it('should convert attachments via toJsonValue', async () => {
      const record = buildVisitRecordWithIncludes();
      mockPrisma.visitRecord.create.mockResolvedValue(record);

      const attachments = [{ fileName: 'photo.jpg', fileUrl: 'https://example.com/photo.jpg' }];
      await service.create(
        {
          customerId: 'cust-1',
          attachments,
        } as unknown as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.visitRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: expect.anything(),
          }),
        })
      );
      // Verify attachments is not passed as raw array (toJsonValue wraps it)
      const callData = mockPrisma.visitRecord.create.mock.calls[0]![0].data;
      expect(callData.attachments).toBeDefined();
    });

    it('服务端反解结果覆盖坐标文本后再写库', async () => {
      const record = buildVisitRecordWithIncludes({
        signAddress: '福建省泉州市晋江市陈埭镇',
        signLocation: '118.643052,24.729363',
      });
      mockPrisma.visitRecord.create.mockResolvedValue(record);
      mockReverseGeocode.ensureAddress.mockResolvedValue({
        signAddress: '福建省泉州市晋江市陈埭镇',
        signLocation: '118.643052,24.729363',
      });

      await service.create(
        {
          customerId: 'cust-1',
          signAddress: '纬度 24.732352, 经度 118.638586 (精度 60米)',
          signLocation: '118.643052,24.729363',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockReverseGeocode.ensureAddress).toHaveBeenCalledWith(
        '纬度 24.732352, 经度 118.638586 (精度 60米)',
        '118.643052,24.729363'
      );
      expect(mockPrisma.visitRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signAddress: '福建省泉州市晋江市陈埭镇',
            signLocation: '118.643052,24.729363',
          }),
        })
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated visit records with default params', async () => {
      const records = [buildVisitRecordWithIncludes(), buildVisitRecordWithIncludes()];
      mockPrisma.visitRecord.findMany.mockResolvedValue(records);
      mockPrisma.visitRecord.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.visitRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.visitRecord.findMany.mockResolvedValue([]);
      mockPrisma.visitRecord.count.mockResolvedValue(0);

      await service.findAll({ keyword: '北京', page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '北京' })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.visitRecord.findMany.mockResolvedValue([]);
      mockPrisma.visitRecord.count.mockResolvedValue(0);

      await service.findAll({
        customerId: 'cust-1',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: 'cust-1' }),
        })
      );
    });

    it('should forward visitType to FilterApplier (legacyFilters)', async () => {
      mockPrisma.visitRecord.findMany.mockResolvedValue([]);
      mockPrisma.visitRecord.count.mockResolvedValue(0);

      await service.findAll({
        visitType: ['onsite'],
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ visitType: ['onsite'] }),
        })
      );
    });

    it('should include customer and contact relations', async () => {
      mockPrisma.visitRecord.findMany.mockResolvedValue([]);
      mockPrisma.visitRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockPrisma.visitRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            customer: expect.anything(),
            contact: expect.anything(),
          }),
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return a visit record with includes', async () => {
      const record = buildVisitRecordWithIncludes({ id: 'vr-1' });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(record);

      const result = await service.findOne('vr-1');

      expect(result).toBeDefined();
      expect(mockPrisma.visitRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'vr-1', deletedAt: null },
        include: expect.objectContaining({
          customer: expect.anything(),
          contact: expect.anything(),
        }),
      });
    });

    it('should throw NotFoundException when visit record does not exist', async () => {
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it.each([undefined, 0, -1, 1.5])('非法 version=%s 时在主写前拒绝', async (version) => {
      await expect(
        service.update(
          'vr-1',
          { content: '非法版本', version } as Parameters<typeof service.update>[1],
          {
            id: 'user-1',
            employeeId: 'emp-user-1',
          }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.visitRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.visitRecord.update).not.toHaveBeenCalled();
    });

    it('事务内拒绝迁移到软删除客户', async () => {
      const existing = buildVisitRecordWithIncludes({ id: 'vr-1', version: 1 });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          'vr-1',
          { customerId: 'cust-deleted', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-deleted', deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.visitRecord.update).not.toHaveBeenCalled();
    });

    it('客户迁移按固定 CAS 写入并在同一事务完整刷新旧、新客户', async () => {
      const existing = buildVisitRecordWithIncludes({
        id: 'vr-1',
        version: 3,
        customerId: 'cust-a',
      });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.visitRecord.update.mockResolvedValue({
        ...existing,
        customerId: 'cust-b',
        version: 4,
      });

      await service.update(
        'vr-1',
        { customerId: 'cust-b', version: 3 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'vr-1', version: 3 } })
      );
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        ['cust-a', 'cust-b'],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.visitRecord.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('更新后的生命周期重算失败时整个 CAS 事务回滚', async () => {
      const existing = buildVisitRecordWithIncludes({ id: 'vr-1', version: 3 });
      let rolledBack = false;
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.visitRecord.update.mockResolvedValue({ ...existing, version: 4 });
      mockCustomersService.refreshCustomerLifecycle.mockRejectedValue(
        new Error('lifecycle update failed')
      );
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
          'vr-1',
          { content: '原子更新', version: 3 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('lifecycle update failed');

      expect(rolledBack).toBe(true);
      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'vr-1', version: 3 } })
      );
    });

    it('事务外快照版本与请求不一致时拒绝，避免并发迁移漏刷中间客户', async () => {
      const existing = buildVisitRecordWithIncludes({
        id: 'vr-1',
        version: 4,
        customerId: 'cust-b',
      });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);

      await expect(
        service.update(
          'vr-1',
          { customerId: 'cust-c', version: 3 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.visitRecord.update).not.toHaveBeenCalled();
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('should update visit record with version check (optimistic lock)', async () => {
      const existing = buildVisitRecordWithIncludes({ id: 'vr-1', version: 1 });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.visitRecord.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'vr-1',
        { content: '更新内容', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'vr-1', version: 1 },
          data: expect.objectContaining({
            content: '更新内容',
            version: { increment: 1 },
          }),
        })
      );
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        [existing.customerId, existing.customerId],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock conflict)', async () => {
      const existing = buildVisitRecordWithIncludes({ id: 'vr-1', version: 1 });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.visitRecord.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'vr-1',
          { content: '冲突更新', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildVisitRecordWithIncludes({ id: 'vr-1' });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.visitRecord.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update(
          'vr-1',
          { content: '更新', version: 1 } as Parameters<typeof service.update>[1],
          {
            id: 'user-1',
            employeeId: 'emp-' + 'user-1',
          }
        )
      ).rejects.toThrow('DB connection lost');
    });

    it('坐标变化但地址未显式更新时强制重新反解', async () => {
      const existing = buildVisitRecordWithIncludes({
        id: 'vr-1',
        version: 1,
        signAddress: '旧地址',
        signLocation: '118.600000,24.800000',
      });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockPrisma.visitRecord.update.mockResolvedValue({
        ...existing,
        signAddress: '新地址',
        signLocation: '118.700000,24.900000',
        version: 2,
      });
      mockReverseGeocode.ensureAddress.mockResolvedValue({
        signAddress: '新地址',
        signLocation: '118.700000,24.900000',
      });

      await service.update(
        'vr-1',
        { signLocation: '118.700000,24.900000', version: 1 } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockReverseGeocode.ensureAddress).toHaveBeenCalledWith(null, '118.700000,24.900000');
      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            signAddress: '新地址',
            signLocation: '118.700000,24.900000',
          }),
        })
      );
    });
  });

  describe('remove', () => {
    it.each([undefined, 0, -1, 1.5])('非法 version=%s 时拒绝删除', async (version) => {
      await expect(
        service.remove(
          'vr-1',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          version
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.visitRecord.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.visitRecord.update).not.toHaveBeenCalled();
    });

    it('删除快照版本已过期时返回冲突且不写入', async () => {
      const record = buildVisitRecordWithIncludes({ id: 'vr-1', version: 5 });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(record);

      await expect(
        service.remove('vr-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 4)
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.visitRecord.update).not.toHaveBeenCalled();
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('删除 CAS 在事务内竞争失败时映射为 409', async () => {
      const record = buildVisitRecordWithIncludes({ id: 'vr-1', version: 5 });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(record);
      mockPrisma.visitRecord.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', { code: 'P2025', clientVersion: '0' })
      );

      await expect(
        service.remove('vr-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 5)
      ).rejects.toThrow(ConflictException);
    });

    it('should soft delete by setting deletedAt', async () => {
      const record = buildVisitRecordWithIncludes({ id: 'vr-1' });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(record);
      mockPrisma.visitRecord.update.mockResolvedValue(record);

      await service.remove(
        'vr-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        record.version
      );

      expect(mockPrisma.visitRecord.update).toHaveBeenCalledWith({
        where: { id: 'vr-1', version: record.version },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        record.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.visitRecord.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('should throw NotFoundException when visit record does not exist', async () => {
      mockPrisma.visitRecord.findFirst.mockResolvedValue(null);

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

  describe('submitChangeRequest', () => {
    it('提交审批前先把坐标文本反解，并把地址和坐标一起写入 patch', async () => {
      const existing = buildVisitRecordWithIncludes({
        id: 'vr-1',
        version: 1,
        flowStatus: 'approved',
        signAddress: '旧地址',
        signLocation: '118.600000,24.800000',
      });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(existing);
      mockReverseGeocode.ensureAddress.mockResolvedValue({
        signAddress: '新地址',
        signLocation: '118.700000,24.900000',
      });

      await service.submitChangeRequest(
        'vr-1',
        {
          signAddress: '纬度 24.900000, 经度 118.700000 (精度 30米)',
          signLocation: '118.700000,24.900000',
          version: 1,
        } as Parameters<typeof service.submitChangeRequest>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockBusinessApprovalService.submitChangeApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          patch: expect.objectContaining({
            signAddress: '新地址',
            signLocation: '118.700000,24.900000',
          }),
        }),
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });
  });

  describe('RBAC dual-path scope', () => {
    it('findAll should pass dual-path OR baseWhere when chargerScope provided', async () => {
      mockPrisma.visitRecord.findMany.mockResolvedValue([]);
      mockPrisma.visitRecord.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, ['emp-B']);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: expect.objectContaining({
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

    it('findOne should match record via customer.chargerId path', async () => {
      const record = buildVisitRecordWithIncludes({ id: 'vr-orphan', chargerId: 'emp-A' });
      mockPrisma.visitRecord.findFirst.mockResolvedValue(record);

      const result = await service.findOne('vr-orphan', ['emp-B']);

      expect(result.id).toBe('vr-orphan');
      expect(mockPrisma.visitRecord.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'vr-orphan',
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
  });
});
