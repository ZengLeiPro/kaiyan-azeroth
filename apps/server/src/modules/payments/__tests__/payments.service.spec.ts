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
import { PaymentsService } from '../payments.service';

const now = new Date();

function buildPaymentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    paymentId: 'pay-1',
    saleOrderProductId: 'op-1',
    itemSeq: 1,
    productName: '默认产品',
    amount: new Prisma.Decimal('10000.00'),
    financeSubjectId: null,
    paymentMode: 'direct',
    remark: null,
    createdAt: now,
    creatorEmployeeId: 'emp-user-1',
    updatedAt: now,
    updaterEmployeeId: 'emp-user-1',
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

function buildPaymentSplit(amount: number, saleOrderProductId = 'op-1') {
  return [{ saleOrderProductId, amount, paymentMode: 'direct' as const }];
}

function buildPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    serialNumber: 'PAY00001',
    subject: '首期款',
    saleOrderId: 'order-1',
    customerId: 'cust-1',
    paymentAmount: new Prisma.Decimal('10000.00'),
    paymentType: 'bank_transfer',
    businessDate: now,
    payer: '张三',
    bankName: '工商银行',
    tradeSerialNumber: 'TXN001',
    chargerId: 'charger-1',
    chargerName: '李四',
    remark: null,
    flowStatus: 'approved' as string | null,
    status: 'active',
    direction: 'IN',
    refundType: null as string | null,
    refundReason: null as string | null,
    relatedPaymentId: null as string | null,
    relatedInvoiceId: null as string | null,
    invoicedByInvoiceId: null as string | null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: 'user-1',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  };
}

function buildPaymentWithRelations(overrides: Record<string, unknown> = {}) {
  const payment = buildPayment(overrides);
  return {
    ...payment,
    charger: { id: payment.chargerId, name: payment.chargerName },
    customer: { id: payment.customerId, customerName: '测试客户', shortName: null },
    saleOrder: { id: payment.saleOrderId, orderTitle: '测试订单', serialNumber: 'DD00001' },
    relatedPayment: null,
    relatedInvoice: null,
    paymentItems: Array.isArray(overrides.paymentItems) ? overrides.paymentItems : [],
  };
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };
  let submitChangeApproval: ReturnType<typeof vi.fn>;
  let createForMerge: ReturnType<typeof vi.fn>;
  let recalculateForPayment: ReturnType<typeof vi.fn>;
  let recalculateBatch: ReturnType<typeof vi.fn>;
  let revokeFromPayment: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('PAY');

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
    mockPrisma.orderProduct.findMany.mockResolvedValue([
      {
        id: 'op-1',
        saleOrderId: 'order-1',
        productName: '默认产品',
        financeSubjectId: null,
      },
    ]);
    mockPrisma.paymentItem.findMany.mockResolvedValue([buildPaymentItem()]);
    mockPrisma.paymentItem.update.mockResolvedValue(buildPaymentItem({ version: 2 }));
    // create/update/remove 流程会触发 recalcSaleOrderPaymentSummary，
    // 给 payment.aggregate 一个默认空值，避免 helper 在 service 测试里因 mock 缺失而炸。
    // _max.businessDate 对应 helper 的 IN 聚合（lastPaymentDate 派生源）。
    mockPrisma.payment.aggregate.mockResolvedValue({
      _sum: { paymentAmount: null },
      _max: { businessDate: null },
    });

    createForMerge = vi.fn();
    const mockInvoicesService = {
      createForMerge,
    } as unknown as import('../../invoices/invoices.service').InvoicesService;

    // CRM 回款 ↔ 财务流水绑定 v2.1 同步钩子，spec 默认 FEATURE_FLAG=false 等价空实现
    revokeFromPayment = vi.fn().mockResolvedValue(undefined);
    const mockFinanceLedgerSync = {
      syncFromPayment: vi.fn().mockResolvedValue(undefined),
      revokeFromPayment,
    } as unknown as import('../../finance/sync/finance-ledger-sync.service').FinanceLedgerSyncService;

    // v2.2 反向缓存，spec 默认空实现（不传 items 时不会被调用）
    recalculateForPayment = vi.fn().mockResolvedValue({ updated: 0 });
    recalculateBatch = vi.fn().mockResolvedValue({ updated: 0 });
    const mockReceivableService = {
      recalculateForPayment,
      recalculateForOrderProduct: vi.fn().mockResolvedValue({}),
      recalculateBatch,
    } as unknown as import('../../finance/receivables/order-product-receivable.service').OrderProductReceivableService;

    service = new PaymentsService(
      asPrismaService(mockPrisma),
      asSerialNumberService(mockSerialNumber),
      mockApprovalGuard,
      mockApprovalsService,
      mockBusinessApprovalService,
      mockFilterApplier as unknown as FilterApplierService,
      mockInvoicesService,
      mockFinanceLedgerSync,
      mockReceivableService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated payments', async () => {
      const items = [
        buildPaymentWithRelations({ businessDate: new Date('2026-05-14T00:00:00.000Z') }),
      ];
      mockPrisma.payment.findMany.mockResolvedValue(items);
      mockPrisma.payment.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.businessDate).toBe('2026-05-14');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(1);
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ keyword: 'PAY', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: 'PAY' })
      );
    });

    it('should forward saleOrderId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ saleOrderId: 'order-1', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ saleOrderId: 'order-1' }),
        })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ customerId: 'cust-1', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: 'cust-1' }),
        })
      );
    });

    it('should forward paymentType to FilterApplier (legacyFilters)', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({
        paymentType: ['bank_transfer'],
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ paymentType: ['bank_transfer'] }),
        })
      );
    });

    it('should include customer and saleOrder relations', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            customer: expect.anything(),
            saleOrder: expect.anything(),
          }),
        })
      );
    });

    it('should exclude soft-deleted records', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        })
      );
    });

    // —— 表头排序：白名单字段 → 透传到 prisma；非白名单 → 兜底 createdAt desc ——
    it('sortBy=businessDate sortOrder=asc → prisma 收到 {businessDate: asc}', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'businessDate',
        sortOrder: 'asc',
      });

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { businessDate: 'asc' } })
      );
    });

    it('sortBy=paymentAmount sortOrder=desc → prisma 收到 {paymentAmount: desc}', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'paymentAmount',
        sortOrder: 'desc',
      });

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { paymentAmount: 'desc' } })
      );
    });

    it('sortBy 不在白名单 → 兜底 {createdAt: desc}（防注入/非索引列）', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: '__proto__',
        sortOrder: 'asc',
      });

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } })
      );
    });

    it('sortBy 缺省 → 兜底 {createdAt: desc}', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } })
      );
    });
  });

  describe('submitVoidRequest', () => {
    it('已审批且未被退款引用时提交带原因的回款作废审批', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(
        buildPaymentWithRelations({ id: 'pay-void', flowStatus: 'approved', version: 2 })
      );
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.submitVoidRequest(
        'pay-void',
        { reason: '重复回款', version: 2 },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      expect(submitChangeApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'payment_change',
          targetType: 'payment',
          targetId: 'pay-void',
          title: '回款作废｜PAY00001',
          patch: { __operation: 'void', __reason: '重复回款' },
        }),
        { id: 'user-1', employeeId: 'emp-1' }
      );
    });
  });

  describe('findOne', () => {
    it('should return payment with relations and complete active items', async () => {
      const payment = buildPaymentWithRelations({
        id: 'pay-1',
        paymentItems: [buildPaymentItem({ amount: new Prisma.Decimal('123.45') })],
      });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      const result = await service.findOne('pay-1');

      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'item-1',
          saleOrderProductId: 'op-1',
          amount: 123.45,
          version: 1,
        }),
      ]);
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith({
        where: { id: 'pay-1', deletedAt: null },
        include: expect.objectContaining({
          customer: expect.anything(),
          saleOrder: expect.anything(),
          paymentItems: expect.objectContaining({ where: { deletedAt: null } }),
        }),
      });
    });

    it('should throw NotFoundException when payment does not exist', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('mergeInvoice', () => {
    it('并发抢占回款失败时整笔合并开票回滚并提示冲突', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          customerId: 'cust-1',
          saleOrderId: 'order-1',
          direction: 'IN',
          flowStatus: 'approved',
          invoicedByInvoiceId: null,
          paymentAmount: new Prisma.Decimal('100.00'),
        },
      ]);
      mockPrisma.saleOrder.findUnique.mockResolvedValue({ chargerId: 'emp-1' });
      createForMerge.mockResolvedValue({
        invoice: buildPaymentWithRelations({
          id: 'invoice-1',
          serialNumber: 'FP00001',
          invoiceNumber: null,
        }),
      });
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.mergeInvoice(
          {
            paymentIds: ['pay-1'],
            invoice: {
              invoiceType: '增值税普通发票',
              invoiceDate: '2026-07-27',
            },
          } as Parameters<typeof service.mergeInvoice>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['pay-1'] },
          customerId: 'cust-1',
          saleOrderId: 'order-1',
          direction: 'IN',
          flowStatus: 'approved',
          deletedAt: null,
          invoicedByInvoiceId: null,
        },
        data: expect.objectContaining({
          invoicedByInvoiceId: 'invoice-1',
          version: { increment: 1 },
        }),
      });
    });
  });

  describe('create', () => {
    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      '拒绝非法回款金额 %s',
      async (paymentAmount) => {
        await expect(
          service.create({ paymentAmount } as Parameters<typeof service.create>[0], {
            id: 'user-1',
            employeeId: 'emp-user-1',
          })
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      }
    );

    it('拒绝在当前数据范围之外的订单下创建回款', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            saleOrderId: 'order-outside',
            paymentAmount: 100,
            items: buildPaymentSplit(100),
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

    it('拒绝把回款负责人指定到当前数据范围之外', async () => {
      await expect(
        service.create(
          {
            saleOrderId: 'order-1',
            chargerId: 'emp-outside',
            paymentAmount: 100,
            items: buildPaymentSplit(100),
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(ForbiddenException);

      expect(mockSerialNumber.generate).not.toHaveBeenCalled();
    });

    it('should generate serial number and create payment', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-new' });
      mockPrisma.payment.create.mockResolvedValue(payment);

      const dto = {
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        subject: '首期款',
        paymentAmount: 10000,
        paymentType: 'bank_transfer',
        items: buildPaymentSplit(10000),
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serialNumber: expect.stringMatching(/^PAY/),
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            subject: '首期款',
            paymentAmount: '10000',
          }),
        })
      );
    });

    it('should reject payment when customerId does not match sale order customer', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-order' });

      await expect(
        service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-other',
            paymentAmount: 10000,
            items: buildPaymentSplit(10000),
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('should derive customerId from sale order when customerId is omitted', async () => {
      const payment = buildPaymentWithRelations({ customerId: 'cust-order' });
      mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-order' });
      mockPrisma.payment.create.mockResolvedValue(payment);

      await service.create(
        {
          saleOrderId: 'order-1',
          paymentAmount: 10000,
          items: buildPaymentSplit(10000),
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-order',
          }),
        })
      );
    });

    it('should convert paymentAmount Decimal field to String', async () => {
      const payment = buildPaymentWithRelations();
      mockPrisma.payment.create.mockResolvedValue(payment);

      await service.create(
        {
          saleOrderId: 'order-1',
          customerId: 'cust-1',
          paymentAmount: 99999.99,
          items: buildPaymentSplit(99999.99),
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentAmount: '99999.99',
          }),
        })
      );
    });

    describe('v2.2 PR-C bankName → financeAccountId 反查', () => {
      it('bankName=招商银行 + DB 命中 → data.financeAccountId 写入', async () => {
        const payment = buildPaymentWithRelations();
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.financeAccount.findFirst.mockResolvedValue({ id: 'acc-cmb-uuid' });

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 10000,
            bankName: '招商银行',
            items: buildPaymentSplit(10000),
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.financeAccount.findFirst).toHaveBeenCalledWith({
          where: { code: 'cmb', deletedAt: null },
          select: { id: true },
        });
        expect(mockPrisma.payment.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              bankName: '招商银行',
              financeAccountId: 'acc-cmb-uuid',
            }),
          })
        );
      });

      it('bankName=null → 跳过反查 + financeAccountId 留空', async () => {
        const payment = buildPaymentWithRelations();
        mockPrisma.payment.create.mockResolvedValue(payment);

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 10000,
            items: buildPaymentSplit(10000),
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.financeAccount.findFirst).not.toHaveBeenCalled();
      });

      it('bankName 不在映射表（自定义） → 不查 DB + financeAccountId 留空', async () => {
        const payment = buildPaymentWithRelations();
        mockPrisma.payment.create.mockResolvedValue(payment);

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 10000,
            bankName: '某自定义银行',
            items: buildPaymentSplit(10000),
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.financeAccount.findFirst).not.toHaveBeenCalled();
      });

      it('bankName 命中映射但 DB 找不到 finance_account → 走 service 层不抛错（syncFromPayment 兜底）', async () => {
        const payment = buildPaymentWithRelations();
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.financeAccount.findFirst.mockResolvedValue(null);

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 10000,
            bankName: '微信',
            items: buildPaymentSplit(10000),
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.financeAccount.findFirst).toHaveBeenCalledWith({
          where: { code: 'wechat', deletedAt: null },
          select: { id: true },
        });
        // DB 没有该 finance_account，service create 不抛错；
        // financeAccountId 仍是 undefined，由 syncFromPayment 在审批通过时兜底（懒迁移会重试，但同样会失败 → 抛 BadRequestException）
        const createCallArg = mockPrisma.payment.create.mock.calls[0]?.[0] as {
          data: { financeAccountId?: string };
        };
        expect(createCallArg.data.financeAccountId).toBeUndefined();
      });
    });

    describe('v2.2 PaymentItem 子项', () => {
      it('传 items 时同事务创建 PaymentItem + 刷反向缓存', async () => {
        const payment = buildPaymentWithRelations({ id: 'pay-new' });
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.orderProduct.findMany.mockResolvedValue([
          {
            id: 'op-1',
            saleOrderId: 'order-1',
            productName: '钉钉专业版',
            financeSubjectId: 'sub-钉钉一方品',
          },
          {
            id: 'op-2',
            saleOrderId: 'order-1',
            productName: '定制开发',
            financeSubjectId: 'sub-定制',
          },
        ]);

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 10000,
            items: [
              { saleOrderProductId: 'op-1', amount: 6000, paymentMode: 'dingtalk_collect' },
              { saleOrderProductId: 'op-2', amount: 4000, paymentMode: 'direct' },
            ],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.paymentItem.create).toHaveBeenCalledTimes(2);
        // 第一条 PaymentItem
        expect(mockPrisma.paymentItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              paymentId: 'pay-new',
              saleOrderProductId: 'op-1',
              itemSeq: 1,
              productName: '钉钉专业版', // 从 OP 继承
              amount: '6000.00',
              paymentMode: 'dingtalk_collect',
              financeSubjectId: 'sub-钉钉一方品', // 从 OP 继承
            }),
          })
        );
        // 第二条
        expect(mockPrisma.paymentItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              paymentId: 'pay-new',
              saleOrderProductId: 'op-2',
              itemSeq: 2,
              amount: '4000.00',
              paymentMode: 'direct',
            }),
          })
        );
      });

      it('items 金额加总与 paymentAmount 不一致 → 拒绝', async () => {
        const payment = buildPaymentWithRelations({ id: 'pay-new' });
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.orderProduct.findMany.mockResolvedValue([
          { id: 'op-1', saleOrderId: 'order-1', productName: 'P1', financeSubjectId: null },
        ]);

        await expect(
          service.create(
            {
              saleOrderId: 'order-1',
              customerId: 'cust-1',
              paymentAmount: 10000,
              items: [{ saleOrderProductId: 'op-1', amount: 9999, paymentMode: 'direct' }],
            } as Parameters<typeof service.create>[0],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.paymentItem.create).not.toHaveBeenCalled();
      });

      it('items 中的 saleOrderProductId 不属于本 saleOrder → 拒绝', async () => {
        const payment = buildPaymentWithRelations({ id: 'pay-new' });
        mockPrisma.payment.create.mockResolvedValue(payment);
        // OP 属于另一个 saleOrder
        mockPrisma.orderProduct.findMany.mockResolvedValue([
          {
            id: 'op-foreign',
            saleOrderId: 'order-other',
            productName: 'X',
            financeSubjectId: null,
          },
        ]);

        await expect(
          service.create(
            {
              saleOrderId: 'order-1',
              customerId: 'cust-1',
              paymentAmount: 5000,
              items: [{ saleOrderProductId: 'op-foreign', amount: 5000, paymentMode: 'direct' }],
            } as Parameters<typeof service.create>[0],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.paymentItem.create).not.toHaveBeenCalled();
      });

      it('items 中的 saleOrderProductId 不存在/已软删 → 拒绝', async () => {
        const payment = buildPaymentWithRelations({ id: 'pay-new' });
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.orderProduct.findMany.mockResolvedValue([]); // 一条都没

        await expect(
          service.create(
            {
              saleOrderId: 'order-1',
              customerId: 'cust-1',
              paymentAmount: 5000,
              items: [{ saleOrderProductId: 'op-gone', amount: 5000, paymentMode: 'direct' }],
            } as Parameters<typeof service.create>[0],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);
      });

      it('不传 items 时拒绝创建无拆分 IN 头表', async () => {
        await expect(
          service.create(
            {
              saleOrderId: 'order-1',
              customerId: 'cust-1',
              paymentAmount: 5000,
            } as Parameters<typeof service.create>[0],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      });

      it('items 数组为空时拒绝创建无拆分 IN 头表', async () => {
        await expect(
          service.create(
            {
              saleOrderId: 'order-1',
              customerId: 'cust-1',
              paymentAmount: 5000,
              items: [],
            } as unknown as Parameters<typeof service.create>[0],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      });

      it('item.productName 缺省时从 OP 快照继承', async () => {
        const payment = buildPaymentWithRelations({ id: 'pay-new' });
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.orderProduct.findMany.mockResolvedValue([
          {
            id: 'op-1',
            saleOrderId: 'order-1',
            productName: '钉钉专业版（OP 快照）',
            financeSubjectId: null,
          },
        ]);

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 9800,
            items: [{ saleOrderProductId: 'op-1', amount: 9800, paymentMode: 'direct' }],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.paymentItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              productName: '钉钉专业版（OP 快照）',
            }),
          })
        );
      });

      it('item.productName 显式传入 → 不被 OP 覆盖', async () => {
        const payment = buildPaymentWithRelations({ id: 'pay-new' });
        mockPrisma.payment.create.mockResolvedValue(payment);
        mockPrisma.orderProduct.findMany.mockResolvedValue([
          { id: 'op-1', saleOrderId: 'order-1', productName: 'OP 快照名', financeSubjectId: null },
        ]);

        await service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 9800,
            items: [
              {
                saleOrderProductId: 'op-1',
                amount: 9800,
                paymentMode: 'direct',
                productName: '前端覆盖名',
              },
            ],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        );

        expect(mockPrisma.paymentItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              productName: '前端覆盖名',
            }),
          })
        );
      });
    });
  });

  describe('update', () => {
    it.each([undefined, 0, -1, 1.5, Number.NaN, '1'])(
      '缺失或非法 version=%s 时在访问数据库前返回 BadRequestException',
      async (version) => {
        await expect(
          service.update(
            'pay-1',
            { subject: '尾款', version } as unknown as Parameters<typeof service.update>[1],
            { id: 'user-1', employeeId: 'emp-user-1' }
          )
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      }
    );

    it('should update with version check', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue({ ...payment, version: 2 });

      await service.update(
        'pay-1',
        { subject: '尾款', paymentType: 'cash', version: 1 } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1', version: 1 },
          data: expect.objectContaining({
            subject: '尾款',
            paymentType: 'cash',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('should convert paymentAmount to String on update', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue({
        ...payment,
        paymentAmount: new Prisma.Decimal('55555.55'),
        version: 2,
      });

      await service.update(
        'pay-1',
        {
          paymentAmount: 55555.55,
          items: buildPaymentSplit(55555.55),
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentAmount: '55555.55' }),
        })
      );
    });

    it('should update customerId from the new sale order when saleOrderId changes', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.saleOrder.findFirst.mockImplementation(async ({ where }) => ({
        customerId: where.id === 'order-2' ? 'cust-new' : 'cust-1',
      }));
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        {
          id: 'op-2',
          saleOrderId: 'order-2',
          productName: '新订单产品',
          financeSubjectId: null,
        },
      ]);
      mockPrisma.payment.update.mockResolvedValue({
        ...payment,
        saleOrderId: 'order-2',
        customerId: 'cust-new',
        version: 2,
      });

      await service.update(
        'pay-1',
        {
          saleOrderId: 'order-2',
          items: buildPaymentSplit(10000, 'op-2'),
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            saleOrder: { connect: { id: 'order-2' } },
            customer: { connect: { id: 'cust-new' } },
          }),
        })
      );
    });

    it('完整 replacement 复用既有 id/itemSeq、增量新增并刷新旧新产品缓存', async () => {
      const payment = buildPaymentWithRelations({
        id: 'pay-1',
        version: 1,
        flowStatus: 'draft',
        paymentAmount: new Prisma.Decimal('100.00'),
      });
      const historical = [
        buildPaymentItem({
          id: 'item-active',
          itemSeq: 1,
          amount: new Prisma.Decimal('100.00'),
          version: 3,
        }),
        buildPaymentItem({
          id: 'item-deleted',
          itemSeq: 7,
          deletedAt: now,
          version: 4,
        }),
      ];
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue({ ...payment, version: 2 });
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        { id: 'op-1', saleOrderId: 'order-1', productName: '产品一', financeSubjectId: null },
        { id: 'op-2', saleOrderId: 'order-1', productName: '产品二', financeSubjectId: null },
      ]);
      mockPrisma.paymentItem.findMany.mockResolvedValueOnce(historical).mockResolvedValueOnce([
        buildPaymentItem({ id: 'item-active', amount: new Prisma.Decimal('60.00'), version: 4 }),
        buildPaymentItem({
          id: 'item-new',
          saleOrderProductId: 'op-2',
          itemSeq: 8,
          amount: new Prisma.Decimal('40.00'),
        }),
      ]);

      const result = await service.update(
        'pay-1',
        {
          items: [
            { saleOrderProductId: 'op-1', amount: 60, paymentMode: 'direct' },
            { saleOrderProductId: 'op-2', amount: 40, paymentMode: 'direct' },
          ],
          version: 1,
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.paymentItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-active', version: 3, deletedAt: null },
          data: expect.objectContaining({ amount: '60.00', version: { increment: 1 } }),
        })
      );
      expect(mockPrisma.paymentItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemSeq: 8,
            saleOrderProductId: 'op-2',
            amount: '40.00',
          }),
        })
      );
      expect(mockPrisma.paymentItem.updateMany).not.toHaveBeenCalled();
      expect(recalculateBatch).toHaveBeenCalledWith(mockPrisma, ['op-1', 'op-2']);
      expect(result.items).toHaveLength(2);
    });

    it('PaymentItem 逐行 CAS 冲突时 replacement 整体失败且不刷新缓存', async () => {
      const payment = buildPaymentWithRelations({
        id: 'pay-1',
        version: 1,
        flowStatus: 'draft',
        paymentAmount: new Prisma.Decimal('100.00'),
      });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue({ ...payment, version: 2 });
      mockPrisma.paymentItem.findMany.mockResolvedValueOnce([
        buildPaymentItem({ id: 'item-stale', version: 9 }),
      ]);
      mockPrisma.paymentItem.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', {
          code: 'P2025',
          clientVersion: '0',
        })
      );

      await expect(
        service.update(
          'pay-1',
          {
            items: [
              {
                saleOrderProductId: 'op-1',
                amount: 100,
                paymentMode: 'direct',
                productName: '并发后的新快照',
              },
            ],
            version: 1,
          } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(recalculateBatch).not.toHaveBeenCalled();
    });

    it('should reject update when customerId does not match target sale order customer', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.saleOrder.findFirst.mockResolvedValue({ customerId: 'cust-1' });

      await expect(
        service.update(
          'pay-1',
          { customerId: 'cust-other', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.payment.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'pay-1',
          { paymentType: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockRejectedValue(new Error('Unknown error'));

      await expect(
        service.update(
          'pay-1',
          { paymentType: '错误', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('Unknown error');
    });
  });

  describe('submitChangeRequest', () => {
    it('使用正确 version 提交变更审批，并从 patch 中移除 version', async () => {
      const payment = buildPaymentWithRelations({ flowStatus: 'approved', version: 3 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      await service.submitChangeRequest(
        'pay-1',
        { subject: '变更后的回款主题', version: 3 } as Parameters<
          typeof service.submitChangeRequest
        >[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(submitChangeApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'pay-1',
          baseVersion: 3,
          patch: { subject: '变更后的回款主题' },
        }),
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });

    it('陈旧 version 返回 ConflictException', async () => {
      const payment = buildPaymentWithRelations({ flowStatus: 'approved', version: 3 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      await expect(
        service.submitChangeRequest(
          'pay-1',
          { subject: '陈旧变更', version: 2 } as Parameters<typeof service.submitChangeRequest>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);
      expect(submitChangeApproval).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it.each([undefined, 0, -1, 1.5, Number.NaN, '1'])(
      '缺失或非法 version=%s 时在访问数据库前返回 BadRequestException',
      async (version) => {
        await expect(
          service.remove(
            'pay-1',
            { id: 'user-1', employeeId: 'emp-user-1' },
            undefined,
            undefined,
            version as never
          )
        ).rejects.toThrow(BadRequestException);

        expect(mockPrisma.payment.findFirst).not.toHaveBeenCalled();
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
      }
    );

    it('should soft delete payment with version check', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 2 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue({ ...payment, version: 3 });

      await service.remove(
        'pay-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        2
      );

      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1', version: 2 },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      const deletedAt = mockPrisma.payment.update.mock.calls[0]![0].data.deletedAt;
      expect(mockPrisma.paymentItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-1', version: 1, deletedAt: null },
          data: expect.objectContaining({ deletedAt, version: { increment: 1 } }),
        })
      );
      expect(recalculateBatch).toHaveBeenCalledWith(mockPrisma, ['op-1']);
    });

    it('PaymentItem CAS 陈旧时返回 409，后续汇总与流水不执行以便删除事务整体回滚', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 2 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockResolvedValue({ ...payment, version: 3 });
      mockPrisma.paymentItem.update.mockRejectedValueOnce({ code: 'P2025' });

      await expect(
        service.remove('pay-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 2)
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.payment.update).toHaveBeenCalledTimes(1);
      expect(recalculateBatch).not.toHaveBeenCalled();
      expect(mockPrisma.payment.aggregate).not.toHaveBeenCalled();
      expect(revokeFromPayment).not.toHaveBeenCalled();
    });

    it('陈旧 version 导致 P2025 时返回 ConflictException', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', version: 2 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);
      mockPrisma.payment.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', {
          code: 'P2025',
          clientVersion: '0',
        })
      );

      await expect(
        service.remove('pay-1', { id: 'user-1', employeeId: 'emp-user-1' }, undefined, undefined, 1)
      ).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when payment does not exist', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue(null);

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

  describe('RBAC dual-path scope (refactored to applyChargerOrCustomerScope)', () => {
    it('findAll should pass dual-path OR baseWhere when chargerScope provided', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

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

    it('findOne should now match via customer.chargerId path (此前是单一 chargerId 走漏)', async () => {
      // 之前 findOne 只过滤 chargerId，B 接手客户后看不到 A 时代的回款详情；
      // 本次重构后 findOne 与 findAll 双路径维度完全一致。
      const payment = buildPaymentWithRelations({ id: 'pay-orphan', chargerId: 'emp-A' });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      const result = await service.findOne('pay-orphan', ['emp-B']);

      expect(result.id).toBe('pay-orphan');
      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'pay-orphan',
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

  describe('RBAC triple-path scope (协作人协作权限)', () => {
    it('findAll should add customer.collaboratorIds OR when currentEmployeeId provided', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, ['emp-B'], 'emp-B');

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: expect.objectContaining({
            deletedAt: null,
            OR: [
              { chargerId: { in: ['emp-B'] } },
              { customer: { chargerId: { in: ['emp-B'] } } },
              { customer: { chargerId: null } },
              { customer: { collaboratorIds: { array_contains: ['emp-B'] } } },
            ],
          }),
        })
      );
    });

    it('findOne should also include customer.collaboratorIds OR when currentEmployeeId provided', async () => {
      // 协作人通过客户关联看到归属该客户的回款详情：A 是负责人，C 不在 chargerScope
      // 内但作为 customer.collaboratorIds 成员仍应有权访问。
      const payment = buildPaymentWithRelations({ id: 'pay-collab', chargerId: 'emp-A' });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      await service.findOne('pay-collab', ['emp-C'], 'emp-C');

      expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'pay-collab',
            deletedAt: null,
            OR: [
              { chargerId: { in: ['emp-C'] } },
              { customer: { chargerId: { in: ['emp-C'] } } },
              { customer: { chargerId: null } },
              { customer: { collaboratorIds: { array_contains: ['emp-C'] } } },
            ],
          }),
        })
      );
    });

    it('ADMIN (chargerScope=null) should not inject any scope OR', async () => {
      mockPrisma.payment.findMany.mockResolvedValue([]);
      mockPrisma.payment.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, null, 'emp-Admin');

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null,
          baseWhere: { deletedAt: null },
        })
      );
    });
  });

  describe('createRefund (direction=OUT)', () => {
    const baseRefundDto = {
      saleOrderId: 'order-1',
      customerId: 'cust-1',
      paymentAmount: 3000,
      paymentType: 'bank_transfer',
      businessDate: '2026-05-14',
      bankName: '工商银行',
      chargerId: 'charger-1',
      refundType: '客户取消',
      relatedPaymentId: 'pay-original-1',
    } as Parameters<typeof service.createRefund>[0];

    it('should generate REF- serial number and create OUT payment with refund fields', async () => {
      // 重写 serialNumber mock 让本组用例返回 REF 前缀
      mockSerialNumber.generate.mockResolvedValueOnce('REF00001');
      const refund = buildPaymentWithRelations({
        id: 'ref-1',
        serialNumber: 'REF00001',
        direction: 'OUT',
        refundType: '客户取消',
        relatedPaymentId: 'pay-original-1',
        paymentAmount: new Prisma.Decimal('3000.00'),
      });
      mockPrisma.payment.create.mockResolvedValue(refund);

      // 事务内有两次 payment.findFirst：
      // 1) lockRelatedInForRefund 先抢占关联 IN 的 version（select { id, version }）
      // 2) assertRefundWithinReceived 再读关联 IN 全字段做归属/余额校验
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({ id: 'pay-original-1', version: 1 })
        .mockResolvedValueOnce({
          id: 'pay-original-1',
          saleOrderId: 'order-1',
          customerId: 'cust-1',
          direction: 'IN',
          flowStatus: 'approved',
          paymentAmount: new Prisma.Decimal('10000.00'),
        });
      // lockRelatedInForRefund 的 version CAS（where {id, version}）需成功返回
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-original-1', version: 2 });
      // 3 个 aggregate 调用：单笔已退 / 订单 IN（带 _max.businessDate）/ 订单 OUT
      mockPrisma.payment.aggregate
        .mockResolvedValueOnce({ _sum: { paymentAmount: null } })
        .mockResolvedValueOnce({
          _sum: { paymentAmount: new Prisma.Decimal('10000.00') },
          _max: { businessDate: null },
        })
        .mockResolvedValueOnce({ _sum: { paymentAmount: null } });

      await service.createRefund(baseRefundDto, { id: 'user-1', employeeId: 'emp-user-1' });

      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            serialNumber: 'REF00001',
            direction: 'OUT',
            refundType: '客户取消',
            relatedPaymentId: 'pay-original-1',
            paymentAmount: '3000',
          }),
        })
      );
    });

    it('should reject when relatedPayment is from another order', async () => {
      mockSerialNumber.generate.mockResolvedValueOnce('REF00001');
      // 1) lockRelatedInForRefund 抢占成功（关联 IN 存在，归属校验不在 lock 里）
      // 2) assertRefundWithinReceived 读到 saleOrderId 不同 → 跨订单退款被拒
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({ id: 'pay-original-1', version: 1 })
        .mockResolvedValueOnce({
          id: 'pay-original-1',
          saleOrderId: 'order-OTHER',
          customerId: 'cust-1',
          direction: 'IN',
          flowStatus: 'approved',
          paymentAmount: new Prisma.Decimal('10000.00'),
        });
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-original-1', version: 2 });

      await expect(
        service.createRefund(baseRefundDto, { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('should reject when refund amount exceeds original payment balance', async () => {
      mockSerialNumber.generate.mockResolvedValueOnce('REF00001');
      // 1) lockRelatedInForRefund 抢占成功
      // 2) assertRefundWithinReceived 读到原回款仅 1000，本次退 5000 → 超额被拒
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({ id: 'pay-original-1', version: 1 })
        .mockResolvedValueOnce({
          id: 'pay-original-1',
          saleOrderId: 'order-1',
          customerId: 'cust-1',
          direction: 'IN',
          flowStatus: 'approved',
          paymentAmount: new Prisma.Decimal('1000.00'),
        });
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-original-1', version: 2 });
      mockPrisma.payment.aggregate.mockResolvedValueOnce({ _sum: { paymentAmount: null } });

      await expect(
        service.createRefund(
          { ...baseRefundDto, paymentAmount: 5000 },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when relatedPayment is not approved', async () => {
      mockSerialNumber.generate.mockResolvedValueOnce('REF00001');
      // 1) lockRelatedInForRefund 抢占成功（lock 只查 deletedAt:null，不看 flowStatus）
      // 2) assertRefundWithinReceived 读到 flowStatus=pending → 关联回款未审批通过被拒
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce({ id: 'pay-original-1', version: 1 })
        .mockResolvedValueOnce({
          id: 'pay-original-1',
          saleOrderId: 'order-1',
          customerId: 'cust-1',
          direction: 'IN',
          flowStatus: 'pending',
          paymentAmount: new Prisma.Decimal('10000.00'),
        });
      mockPrisma.payment.update.mockResolvedValue({ id: 'pay-original-1', version: 2 });

      await expect(
        service.createRefund(baseRefundDto, { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update direction immutability', () => {
    it('should reject when direction differs from existing', async () => {
      const payment = buildPaymentWithRelations({ id: 'pay-1', direction: 'IN', version: 1 });
      mockPrisma.payment.findFirst.mockResolvedValue(payment);

      await expect(
        service.update(
          'pay-1',
          { direction: 'OUT', version: 1 } as unknown as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('create rejects OUT direction', () => {
    it('should reject when create receives direction=OUT (must use /refund endpoint)', async () => {
      await expect(
        service.create(
          {
            saleOrderId: 'order-1',
            customerId: 'cust-1',
            paymentAmount: 1000,
            direction: 'OUT',
          } as unknown as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('versioned batch writes', () => {
    it('批量编辑把每行真实 version 与审批状态放入最终 CAS where', async () => {
      const draft = {
        id: 'pay-draft',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        direction: 'IN',
        flowStatus: 'draft',
      };
      const approved = { ...draft, id: 'pay-approved', flowStatus: 'approved' };
      mockPrisma.payment.findMany
        .mockResolvedValueOnce([draft, approved])
        .mockResolvedValueOnce([{ id: 'pay-draft', serialNumber: 'PAY00001' }])
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'pay-draft', serialNumber: 'PAY00001', remark: '已修正' }]);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.batchUpdate(
          {
            ids: ['pay-draft', 'pay-approved'],
            versions: { 'pay-draft': 2, 'pay-approved': 8 },
            patch: { remark: '已修正' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).resolves.toEqual({ success: 1, skipped: ['pay-approved'] });

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            legacyAdjustment: false,
            AND: [
              {
                OR: [{ id: 'pay-draft', version: 2, flowStatus: 'draft' }],
              },
            ],
          },
        })
      );
    });

    it('批量转交任一陈旧 version 即整批 409', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-new' });
      const draft = {
        id: 'pay-1',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        direction: 'IN',
        flowStatus: 'draft',
      };
      mockPrisma.payment.findMany
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'pay-1', serialNumber: 'PAY00001' }])
        .mockResolvedValueOnce([draft]);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.batchTransfer(
          {
            ids: ['pay-1'],
            versions: { 'pay-1': 3 },
            chargerId: 'emp-new',
          },
          { id: 'user-1', employeeId: 'emp-user-1' },
          null,
          'emp-user-1'
        )
      ).rejects.toThrow(ConflictException);
    });

    it('批量删除 CAS 失败时不触发订单聚合副作用', async () => {
      const draft = {
        id: 'pay-1',
        saleOrderId: 'order-1',
        customerId: 'cust-1',
        direction: 'IN',
        flowStatus: 'draft',
      };
      mockPrisma.payment.findMany
        .mockResolvedValueOnce([draft])
        .mockResolvedValueOnce([{ id: 'pay-1', serialNumber: 'PAY00001' }])
        .mockResolvedValueOnce([draft]);
      mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.batchRemove(
          { ids: ['pay-1'], versions: { 'pay-1': 4 } },
          { id: 'user-1', employeeId: 'emp-user-1' },
          ['emp-user-1'],
          'emp-user-1'
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            legacyAdjustment: false,
            AND: [
              {
                OR: [{ id: 'pay-1', version: 4, flowStatus: 'draft' }],
              },
            ],
            OR: expect.any(Array),
          }),
        })
      );
      expect(mockPrisma.payment.aggregate).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });
  });
});
