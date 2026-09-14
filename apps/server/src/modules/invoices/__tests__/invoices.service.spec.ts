import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import {
  asSerialNumberService,
  createMockSerialNumberService,
  type MockSerialNumberService,
} from '../../../test/serial-number-mock.factory';
import type { ApprovalGuardService } from '../../approvals/approval-guard.service';
import { InvoicesService } from '../invoices.service';

/** 构造发票 mock 数据（含关联） */
function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    serialNumber: 'FP0001',
    subject: '软件开发服务费',
    saleOrderId: 'order-1',
    customerId: 'cust-1',
    invoiceAmount: new Prisma.Decimal('10000.00'),
    invoiceType: '增值税专用发票',
    invoiceDate: new Date('2025-06-01'),
    invoiceNumber: 'INV-2025-001',
    title: '示例科技',
    taxIdentifyNum: '91330000MA1XXXXX',
    invoiceStatus: 'pending',
    sourcePaymentIds: null,
    chargerId: 'charger-1',
    chargerName: '负责人',
    flowStatus: 'draft',
    status: 'active',
    remark: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    customer: { id: 'cust-1', customerName: '客户A', shortName: 'A' },
    saleOrder: { id: 'order-1', serialNumber: 'DD0001' },
    ...overrides,
  };
}

describe('InvoicesService', () => {
  let service: InvoicesService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };
  let submitChangeApproval: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('FP');

    const mockApprovalGuard = {
      getInitialStatus: vi.fn().mockResolvedValue('approved'),
      isRequired: vi.fn().mockResolvedValue(false),
    } as unknown as ApprovalGuardService;

    const mockApprovalsService = {
      notifyOnSubmit: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('../../approvals/approvals.service').ApprovalsService;

    submitChangeApproval = vi.fn().mockResolvedValue({ id: 'mock-change-instance-id' });
    const mockBusinessApprovalService = {
      createApprovalForNewRecord: vi.fn().mockResolvedValue('mock-instance-id'),
      assertCanDirectEdit: vi.fn(),
      lockPendingFormEdit: vi.fn().mockResolvedValue(null),
      syncPendingFormEdit: vi.fn().mockResolvedValue(undefined),
      assertCanDelete: vi.fn(),
      submitChangeApproval,
    } as unknown as import('../../approvals/business-approval.service').BusinessApprovalService;

    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-1' });
    // create/update/remove 流程会触发 recalcSaleOrderInvoicedSummary，
    // 给 invoice.aggregate 一个默认空值，避免 helper 在 service 测试里因 mock 缺失而炸。
    mockPrisma.invoice.aggregate.mockResolvedValue({ _sum: { invoiceAmount: null } });

    service = new InvoicesService(
      asPrismaService(mockPrisma),
      asSerialNumberService(mockSerialNumber),
      mockApprovalGuard,
      mockApprovalsService,
      mockBusinessApprovalService,
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      '拒绝非法发票金额 %s',
      async (invoiceAmount) => {
        await expect(
          service.create({ invoiceAmount } as Parameters<typeof service.create>[0], {
            id: 'user-1',
            employeeId: 'emp-user-1',
          })
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
      }
    );

    it('拒绝在当前数据范围之外的订单下创建发票', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            saleOrderId: 'order-outside',
            invoiceAmount: 100,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'order-outside',
          deletedAt: null,
          OR: [
            { chargerId: { in: ['emp-1'] } },
            { customer: { chargerId: { in: ['emp-1'] } } },
            { customer: { collaboratorIds: { array_contains: ['emp-1'] } } },
          ],
        },
        select: { customerId: true },
      });
      expect(mockSerialNumber.generate).not.toHaveBeenCalled();
    });

    it('should generate serial number and create invoice', async () => {
      const invoice = buildInvoice({ id: 'inv-new' });
      mockPrisma.invoice.create.mockResolvedValue(invoice);

      const dto = {
        customerId: 'cust-1',
        saleOrderId: 'order-1',
        subject: '软件开发服务费',
        invoiceAmount: 10000,
        title: '示例科技',
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serialNumber: 'FP0001',
            customerId: 'cust-1',
            saleOrderId: 'order-1',
            subject: '软件开发服务费',
            invoiceAmount: '10000',
            title: '示例科技',
          }),
          include: expect.objectContaining({
            customer: expect.anything(),
            saleOrder: expect.anything(),
          }),
        })
      );
    });

    it('should reject invoice when customerId does not match sale order customer', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-order' });

      await expect(
        service.create(
          {
            customerId: 'cust-other',
            saleOrderId: 'order-1',
            invoiceAmount: 10000,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('should derive customerId from sale order when customerId is omitted', async () => {
      const invoice = buildInvoice({ customerId: 'cust-order' });
      mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-order' });
      mockPrisma.invoice.create.mockResolvedValue(invoice);

      await service.create(
        {
          saleOrderId: 'order-1',
          invoiceAmount: 10000,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-order',
          }),
        })
      );
    });

    it('should convert invoiceAmount to String via String()', async () => {
      const invoice = buildInvoice();
      mockPrisma.invoice.create.mockResolvedValue(invoice);

      await service.create(
        {
          customerId: 'cust-1',
          saleOrderId: 'order-1',
          invoiceAmount: 99999.99,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceAmount: '99999.99',
          }),
        })
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated invoices', async () => {
      const items = [buildInvoice()];
      mockPrisma.invoice.findMany.mockResolvedValue(items);
      mockPrisma.invoice.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAll({ keyword: '示例', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '示例' })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAll({ customerId: 'cust-1', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: 'cust-1' }),
        })
      );
    });

    it('should forward invoiceStatus to FilterApplier (legacyFilters)', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAll({
        invoiceStatus: ['pending'],
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ invoiceStatus: ['pending'] }),
        })
      );
    });

    it('should convert Decimal invoiceAmount in response items', async () => {
      const invoice = buildInvoice({ invoiceAmount: new Prisma.Decimal('12345.67') });
      mockPrisma.invoice.findMany.mockResolvedValue([invoice]);
      mockPrisma.invoice.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      const firstItem = result.items[0];
      expect(firstItem).toBeDefined();
      expect(typeof firstItem!.invoiceAmount).toBe('number');
      expect(firstItem!.invoiceAmount).toBe(12345.67);
    });

    // —— 表头排序：白名单字段 → 透传到 prisma；非白名单 → 兜底 createdAt desc ——
    it('sortBy=invoiceDate sortOrder=asc → prisma 收到 {invoiceDate: asc}', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'invoiceDate',
        sortOrder: 'asc',
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { invoiceDate: 'asc' } })
      );
    });

    it('sortBy=invoiceAmount sortOrder=desc → prisma 收到 {invoiceAmount: desc}', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'invoiceAmount',
        sortOrder: 'desc',
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { invoiceAmount: 'desc' } })
      );
    });

    it('sortBy 不在白名单 → 兜底 {createdAt: desc}', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([]);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: '__proto__',
        sortOrder: 'asc',
      });

      expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } })
      );
    });
  });

  describe('findOne', () => {
    it('should return invoice by id', async () => {
      const invoice = buildInvoice({ id: 'inv-1' });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

      const result = await service.findOne('inv-1');

      expect(result).toBeDefined();
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith({
        where: { id: 'inv-1', deletedAt: null },
        include: expect.objectContaining({
          customer: expect.anything(),
          saleOrder: expect.anything(),
        }),
      });
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it.each([undefined, 0, -1, 1.5, Number.NaN, '1'])(
      '缺失或非法 version=%s 时在访问数据库前返回 BadRequestException',
      async (version) => {
        await expect(
          service.update(
            'inv-1',
            { title: '更新标题', version } as unknown as Parameters<typeof service.update>[1],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      }
    );

    it('should update with version check (optimistic lock)', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 1 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockResolvedValue({ ...invoice, version: 2 });

      await service.update(
        'inv-1',
        { subject: '技术服务费', title: '更新标题', version: 1 } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1', version: 1 },
          data: expect.objectContaining({
            subject: '技术服务费',
            title: '更新标题',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('should convert Decimal field to String on update', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 1 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockResolvedValue({ ...invoice, version: 2 });

      await service.update(
        'inv-1',
        { invoiceAmount: 55555.55, version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ invoiceAmount: '55555.55' }),
        })
      );
    });

    it('should update customerId from the new sale order when saleOrderId changes', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 1 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.saleOrder.findFirst.mockImplementation(async ({ where }) => ({
        customerId: where.id === 'order-2' ? 'cust-new' : 'cust-1',
      }));
      mockPrisma.invoice.update.mockResolvedValue({
        ...invoice,
        saleOrderId: 'order-2',
        customerId: 'cust-new',
        version: 2,
      });

      await service.update(
        'inv-1',
        { saleOrderId: 'order-2', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            saleOrderId: 'order-2',
            customerId: 'cust-new',
          }),
        })
      );
    });

    it('直接将草稿发票改为作废时清除合并开票回款反向引用', async () => {
      const invoice = buildInvoice({
        id: 'inv-void',
        version: 1,
        flowStatus: 'draft',
        invoiceStatus: '正常',
      });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockResolvedValue({
        ...invoice,
        version: 2,
        invoiceStatus: '作废',
      });

      await service.update(
        'inv-void',
        { invoiceStatus: '作废', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(1, {
        where: { invoicedByInvoiceId: 'inv-void', deletedAt: null },
        data: expect.objectContaining({
          invoicedByInvoiceId: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, {
        where: { relatedInvoiceId: 'inv-void', deletedAt: null },
        data: expect.objectContaining({
          relatedInvoiceId: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
        mockPrisma.payment.updateMany.mock.invocationCallOrder[0]!
      );
    });

    it('should reject update when customerId does not match target sale order customer', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 1 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-1' });

      await expect(
        service.update(
          'inv-1',
          { customerId: 'cust-other', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on P2025 (version mismatch)', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 1 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.invoice.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'inv-1',
          { title: '冲突更新', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 1 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockRejectedValue(new Error('Database connection lost'));

      await expect(
        service.update(
          'inv-1',
          { title: '错误', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('Database connection lost');
    });
  });

  describe('submitChangeRequest', () => {
    it('使用正确 version 提交变更审批，并从 patch 中移除 version', async () => {
      const invoice = buildInvoice({ flowStatus: 'approved', version: 3 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

      await service.submitChangeRequest(
        'inv-1',
        { title: '变更后的发票抬头', version: 3 } as Parameters<
          typeof service.submitChangeRequest
        >[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(submitChangeApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'inv-1',
          baseVersion: 3,
          patch: { title: '变更后的发票抬头' },
        }),
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });

    it('陈旧 version 返回 ConflictException', async () => {
      const invoice = buildInvoice({ flowStatus: 'approved', version: 3 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);

      await expect(
        service.submitChangeRequest(
          'inv-1',
          { title: '陈旧变更', version: 2 } as Parameters<typeof service.submitChangeRequest>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);
      expect(submitChangeApproval).not.toHaveBeenCalled();
    });
  });

  describe('voidRed', () => {
    it.each([undefined, 0, -1, 1.5, Number.NaN, '1'])(
      '缺失或非法 version=%s 时在访问数据库前返回 BadRequestException',
      async (version) => {
        await expect(
          service.voidRed('inv-red', version as never, '原因', {
            id: 'user-1',
            employeeId: 'emp-1',
          })
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
      }
    );

    it('冲红时同事务清除合并开票回款的反向引用', async () => {
      const invoice = buildInvoice({
        id: 'inv-red',
        version: 2,
        flowStatus: 'approved',
        invoiceStatus: '正常',
      });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockResolvedValue({
        ...invoice,
        version: 3,
        invoiceStatus: '已冲红',
      });

      await service.voidRed('inv-red', 2, '原票信息有误', { id: 'user-1', employeeId: 'emp-1' });

      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(1, {
        where: { invoicedByInvoiceId: 'inv-red', deletedAt: null },
        data: expect.objectContaining({
          invoicedByInvoiceId: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, {
        where: { relatedInvoiceId: 'inv-red', deletedAt: null },
        data: expect.objectContaining({
          relatedInvoiceId: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
        mockPrisma.payment.updateMany.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.invoice.aggregate).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it.each([undefined, 0, -1, 1.5, Number.NaN, '1'])(
      '缺失或非法 version=%s 时在访问数据库前返回 BadRequestException',
      async (version) => {
        await expect(
          service.remove(
            'inv-1',
            { id: 'user-1', employeeId: 'emp-user-1' },
            undefined,
            undefined,
            version as never
          )
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
      }
    );

    it('should soft delete invoice with version check', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 2 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockResolvedValue({ ...invoice, version: 3 });

      await service.remove(
        'inv-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        2
      );

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1', version: 2 },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(1, {
        where: { invoicedByInvoiceId: 'inv-1', deletedAt: null },
        data: expect.objectContaining({
          invoicedByInvoiceId: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, {
        where: { relatedInvoiceId: 'inv-1', deletedAt: null },
        data: expect.objectContaining({
          relatedInvoiceId: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.invoice.update.mock.invocationCallOrder[0]!).toBeLessThan(
        mockPrisma.payment.updateMany.mock.invocationCallOrder[0]!
      );
    });

    it('陈旧 version 导致 P2025 时返回 ConflictException', async () => {
      const invoice = buildInvoice({ id: 'inv-1', version: 2 });
      mockPrisma.invoice.findFirst.mockResolvedValue(invoice);
      mockPrisma.invoice.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', {
          code: 'P2025',
          clientVersion: '0',
        })
      );

      await expect(
        service.remove('inv-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 1)
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when invoice not found', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue(null);

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

  describe('batchUpdate', () => {
    it('允许批量修改草稿记录，并跳过审批中和已通过记录', async () => {
      const draft = {
        id: 'inv-draft',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        flowStatus: 'draft',
      };
      const approved = { ...draft, id: 'inv-approved', flowStatus: 'approved' };
      mockPrisma.invoice.findMany
        .mockResolvedValueOnce([draft, approved])
        .mockResolvedValueOnce([{ id: 'inv-draft', serialNumber: 'FP0001' }])
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'inv-draft', serialNumber: 'FP0001', remark: '已修正' }]);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.batchUpdate(
        {
          ids: ['inv-draft', 'inv-approved'],
          versions: { 'inv-draft': 2, 'inv-approved': 5 },
          patch: { remark: '已修正' },
        },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(result).toEqual({ success: 1, skipped: ['inv-approved'] });
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            AND: [
              {
                OR: [{ id: 'inv-draft', version: 2, flowStatus: 'draft' }],
              },
            ],
          },
        })
      );
    });
  });

  describe('versioned batch writes', () => {
    it('批量删除先通过发票最终 CAS/count guard，再清理两类 Payment 反向引用', async () => {
      const draft = {
        id: 'inv-1',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        flowStatus: 'draft',
      };
      mockPrisma.invoice.findMany
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'inv-1', serialNumber: 'FP0001' }])
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'inv-1', serialNumber: 'FP0001' }]);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.batchRemove(
          { ids: ['inv-1'], versions: { 'inv-1': 4 } },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).resolves.toEqual({ success: 1, skipped: [] });

      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(1, {
        where: { invoicedByInvoiceId: { in: ['inv-1'] }, deletedAt: null },
        data: expect.objectContaining({ invoicedByInvoiceId: null, version: { increment: 1 } }),
      });
      expect(mockPrisma.payment.updateMany).toHaveBeenNthCalledWith(2, {
        where: { relatedInvoiceId: { in: ['inv-1'] }, deletedAt: null },
        data: expect.objectContaining({ relatedInvoiceId: null, version: { increment: 1 } }),
      });
      expect(mockPrisma.invoice.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(
        mockPrisma.payment.updateMany.mock.invocationCallOrder[0]!
      );
    });

    it('批量转交以 id+version+状态做最终 CAS，任一陈旧即整批 409', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-new' });
      const draft = {
        id: 'inv-1',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        flowStatus: 'draft',
      };
      mockPrisma.invoice.findMany
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'inv-1', serialNumber: 'FP0001' }])
        .mockResolvedValueOnce([draft]);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.batchTransfer(
          {
            ids: ['inv-1'],
            versions: { 'inv-1': 3 },
            chargerId: 'emp-new',
          },
          { id: 'user-1', employeeId: 'emp-user-1' },
          null,
          'emp-user-1'
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            AND: [
              {
                OR: [{ id: 'inv-1', version: 3, flowStatus: 'draft' }],
              },
            ],
          },
        })
      );
    });

    it('批量删除 CAS 失败时不清理回款反向引用且不重算聚合', async () => {
      const draft = {
        id: 'inv-1',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        flowStatus: 'draft',
      };
      mockPrisma.invoice.findMany
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'inv-1', serialNumber: 'FP0001' }])
        .mockResolvedValueOnce([draft]);
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.batchRemove(
          { ids: ['inv-1'], versions: { 'inv-1': 4 } },
          { id: 'user-1', employeeId: 'emp-user-1' },
          ['emp-user-1'],
          'emp-user-1'
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            AND: [
              {
                OR: [{ id: 'inv-1', version: 4, flowStatus: 'draft' }],
              },
            ],
            OR: expect.any(Array),
          }),
        })
      );
      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.invoice.aggregate).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });
  });
});
