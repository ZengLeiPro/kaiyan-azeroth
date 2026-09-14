import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildSaleOrder } from '../../../test/factories';
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
import { reconcileSaleOrderActivationLifecycle } from '../sale-order-activation-lifecycle.helper';
import { SaleOrdersService } from '../sale-orders.service';

vi.mock('../sale-order-activation-lifecycle.helper', () => ({
  isEffectiveSaleOrderFlowStatus: vi.fn(
    (flowStatus: string | null | undefined) => flowStatus == null || flowStatus === 'approved'
  ),
  reconcileSaleOrderActivationLifecycle: vi.fn().mockResolvedValue(undefined),
}));

const baseProducts = [
  {
    productName: '钉钉专业版',
    quantity: 10,
    unitPrice: 120,
    contractUnitPrice: 200,
    subtotalAmount: 2000,
  },
];

function buildSaleOrderWithRelations(
  overrides: Parameters<typeof buildSaleOrder>[0] & {
    products?: typeof baseProducts;
  } = {}
) {
  const { products = baseProducts, ...orderOverrides } = overrides;
  const order = buildSaleOrder(orderOverrides);
  return {
    ...order,
    customer: null,
    opportunity: null,
    products,
  };
}

describe('SaleOrdersService', () => {
  let service: SaleOrdersService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };
  let submitChangeApproval: ReturnType<typeof vi.fn>;
  let isApprovalRequired: ReturnType<typeof vi.fn>;
  let mockBusinessApprovalService: {
    lockPendingFormEdit: ReturnType<typeof vi.fn>;
    syncPendingFormEdit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('DD');

    isApprovalRequired = vi.fn().mockResolvedValue(false);
    const mockApprovalGuard = {
      getInitialStatus: vi.fn().mockResolvedValue('approved'),
      isRequired: isApprovalRequired,
    } as unknown as ApprovalGuardService;

    const mockApprovalsService = {
      notifyOnSubmit: vi.fn().mockResolvedValue(undefined),
    } as unknown as import('../../approvals/approvals.service').ApprovalsService;

    submitChangeApproval = vi.fn().mockResolvedValue({ id: 'mock-change-instance-id' });
    mockBusinessApprovalService = {
      createApprovalForNewRecord: vi.fn().mockResolvedValue('mock-instance-id'),
      assertCanDirectEdit: vi.fn(),
      lockPendingFormEdit: vi.fn().mockResolvedValue(null),
      syncPendingFormEdit: vi.fn().mockResolvedValue(undefined),
      assertCanDelete: vi.fn(),
      submitChangeApproval,
    } as unknown as typeof mockBusinessApprovalService;

    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };

    // update 流程会触发 recalcSaleOrderInvoicedSummary / PaymentSummary，
    // 给 aggregate 一个默认空和值，避免 helper 在 service 测试里因 mock 缺失而炸。
    // _max.businessDate 对应 payment-summary.helper 的 IN 聚合（lastPaymentDate 派生源）。
    mockPrisma.payment.aggregate.mockResolvedValue({
      _sum: { paymentAmount: null },
      _max: { businessDate: null },
    });
    mockPrisma.invoice.aggregate.mockResolvedValue({
      _sum: { invoiceAmount: null },
    });
    mockPrisma.payment.findMany.mockResolvedValue([]);
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.project.findFirst.mockResolvedValue(null);
    mockPrisma.projectSaleOrder.findMany.mockResolvedValue([]);
    mockPrisma.financeLedger.findMany.mockResolvedValue([]);
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-user-1' });
    mockPrisma.saleOrder.aggregate.mockResolvedValue({
      _sum: { totalUncollected: null },
    });

    service = new SaleOrdersService(
      asPrismaService(mockPrisma),
      asSerialNumberService(mockSerialNumber),
      mockApprovalGuard,
      mockApprovalsService,
      mockBusinessApprovalService as unknown as import('../../approvals/business-approval.service').BusinessApprovalService,
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated sale orders', async () => {
      const items = [buildSaleOrderWithRelations()];
      mockPrisma.saleOrder.findMany.mockResolvedValue(items);
      mockPrisma.saleOrder.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        keyword: '订单',
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '订单' })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        customerId: ['cust-1'],
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: ['cust-1'] }),
        })
      );
    });

    it('should forward orderStatus to FilterApplier (legacyFilters)', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        orderStatus: ['signed'],
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ orderStatus: ['signed'] }),
        })
      );
    });

    it('should forward chargerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        chargerId: 'charger-1',
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ chargerId: 'charger-1' }),
        })
      );
    });

    it('should include customer and opportunity relations', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            customer: expect.anything(),
            opportunity: expect.anything(),
          }),
        })
      );
    });

    // —— 表头排序：白名单字段 → 透传到 prisma；非白名单 → 兜底 createdAt desc ——
    it('sortBy=businessDate sortOrder=asc → prisma 收到 {businessDate: asc}', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'businessDate',
        sortOrder: 'asc',
      });

      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { businessDate: 'asc' } })
      );
    });

    it('sortBy=paymentDate sortOrder=desc → prisma 收到 {paymentDate: desc}', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: 'paymentDate',
        sortOrder: 'desc',
      });

      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { paymentDate: 'desc' } })
      );
    });

    it('sortBy 不在白名单 → 兜底 {createdAt: desc}', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({
        page: 1,
        pageSize: 10,
        sortBy: '__proto__',
        sortOrder: 'asc',
      });

      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } })
      );
    });
  });

  describe('submitVoidRequest', () => {
    it('已审批且无关联回款/开票时提交带原因的作废审批', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        ...buildSaleOrderWithRelations({
          id: 'so-void',
          serialNumber: 'SO00001',
          orderTitle: '测试合同',
          version: 3,
        }),
        flowStatus: 'approved',
      });
      await service.submitVoidRequest(
        'so-void',
        { reason: '重复录入', version: 3 },
        { id: 'user-1', employeeId: 'emp-1' }
      );

      expect(submitChangeApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'sale_order_void',
          targetType: 'sale_order',
          targetId: 'so-void',
          title: '合同订单纠错作废｜测试合同',
          patch: expect.objectContaining({
            __operation: 'void_bundle',
            __reason: '重复录入',
            dependencySnapshot: expect.objectContaining({
              payments: [],
              invoices: [],
              project: null,
            }),
          }),
        }),
        { id: 'user-1', employeeId: 'emp-1' }
      );
    });
  });

  describe('findOne', () => {
    it('should return sale order with products', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-1' });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      const result = await service.findOne('order-1');

      expect(result).toBeDefined();
      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith({
        where: { id: 'order-1', deletedAt: null },
        include: expect.objectContaining({
          products: expect.objectContaining({
            where: { deletedAt: null },
          }),
        }),
      });
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('拒绝向当前数据范围之外的客户创建合同订单', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            customerId: 'cust-outside',
            products: baseProducts,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(ForbiddenException);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'cust-outside',
          deletedAt: null,
          OR: [
            { chargerId: { in: ['emp-1'] } },
            { collaboratorIds: { array_contains: ['emp-1'] } },
          ],
        },
        select: { id: true },
      });
      expect(mockSerialNumber.generate).not.toHaveBeenCalled();
    });

    it('拒绝把合同订单负责人指定到当前数据范围之外', async () => {
      await expect(
        service.create(
          {
            customerId: 'cust-1',
            chargerId: 'emp-outside',
            products: baseProducts,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(ForbiddenException);

      expect(mockSerialNumber.generate).not.toHaveBeenCalled();
    });

    it('should generate serial number and create sale order', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-new' });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      // 事务提交后再走 findOne 拿完整关联数据（含 products）
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      const dto = {
        customerId: 'cust-1',
        orderTitle: '新订单',
        orderAmount: 50000,
        products: [
          {
            ...baseProducts[0],
            unitPrice: 5000,
            contractUnitPrice: 4500,
            subtotalAmount: 1,
          },
        ],
      } as Parameters<typeof service.create>[0];

      await service.create(dto, {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.saleOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            orderTitle: '新订单',
            orderAmount: '50000',
            productAmount: '50000.00',
            totalReceivables: '45000.00',
            totalReceived: '0.00',
            totalUncollected: '45000.00',
          }),
        })
      );
    });

    it('should convert Decimal fields to String', async () => {
      const order = buildSaleOrderWithRelations();
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await service.create(
        {
          customerId: 'cust-1',
          orderAmount: 99999.99,
          products: [
            {
              productName: '钉钉专业版',
              quantity: 1,
              unitPrice: 99999.99,
              contractUnitPrice: 88888.88,
              subtotalAmount: 1,
            },
          ],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.saleOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderAmount: '99999.99',
            productAmount: '99999.99',
            totalReceivables: '88888.88',
            totalUncollected: '88888.88',
          }),
        })
      );
    });

    it('should handle null Decimal fields', async () => {
      const order = buildSaleOrderWithRelations();
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await service.create(
        { customerId: 'cust-1', products: baseProducts } as Parameters<typeof service.create>[0],
        {
          id: 'user-1',
          employeeId: 'emp-' + 'user-1',
        }
      );

      expect(mockPrisma.saleOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            orderAmount: expect.any(Number),
            totalReceivables: expect.any(Number),
            totalUncollected: expect.any(Number),
          }),
        })
      );
      expect(mockPrisma.saleOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productAmount: '1200.00',
            totalReceivables: '2000.00',
            totalReceived: '0.00',
            totalUncollected: '2000.00',
          }),
        })
      );
    });

    it('should write products via createMany when products provided', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-with-products' });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.orderProduct.createMany.mockResolvedValue({ count: 2 });

      await service.create(
        {
          customerId: 'cust-1',
          products: [
            {
              productName: '钉钉专业版',
              quantity: 10,
              unitPrice: 120,
              contractUnitPrice: 200,
              subtotalAmount: 999,
            },
            {
              productName: '钉钉硬件',
              quantity: 1,
              unitPrice: 300,
              contractUnitPrice: 500,
              subtotalAmount: 999,
            },
          ],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.orderProduct.createMany).toHaveBeenCalledTimes(1);
      const call = mockPrisma.orderProduct.createMany.mock.calls[0]![0] as {
        data: Array<Record<string, unknown>>;
      };
      expect(call.data).toHaveLength(2);
      expect(call.data[0]).toMatchObject({
        saleOrderId: 'order-with-products',
        productName: '钉钉专业版',
        quantity: '10',
        unitPrice: '120',
        contractUnitPrice: '200',
        subtotalAmount: '2000.00',
      });
    });

    it('should derive discount and subtotal from unitPrice and contractUnitPrice', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-recompute' });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.orderProduct.createMany.mockResolvedValue({ count: 1 });

      await service.create(
        {
          customerId: 'cust-1',
          orderAmount: 1000,
          products: [
            {
              productName: '折扣产品',
              quantity: 4,
              unitPrice: 1000,
              contractUnitPrice: 900,
              discount: 99,
              subtotalAmount: 999,
            },
          ],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.saleOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productAmount: '4000.00',
            totalReceivables: '3600.00',
          }),
        })
      );
      expect(mockPrisma.orderProduct.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            productName: '折扣产品',
            unitPrice: '1000',
            contractUnitPrice: '900',
            discount: '10.00',
            subtotalAmount: '3600.00',
          }),
        ]),
      });
    });

    it('should reject when products is empty', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-no-products' });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.create(
          { customerId: 'cust-1', products: [] } as unknown as Parameters<typeof service.create>[0],
          {
            id: 'user-1',
            employeeId: 'emp-user-1',
          }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.orderProduct.createMany).not.toHaveBeenCalled();
    });

    it('should reject opportunity from a different customer', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-other',
      });

      await expect(
        service.create(
          {
            customerId: 'cust-1',
            opportunityId: 'opp-1',
            orderAmount: 10000,
            products: baseProducts,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.saleOrder.create).not.toHaveBeenCalled();
    });

    it('should allow opportunity from the same customer', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-with-opportunity',
        customerId: 'cust-1',
        opportunityId: 'opp-1',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValue(order);

      await service.create(
        {
          customerId: 'cust-1',
          opportunityId: 'opp-1',
          orderAmount: 10000,
          products: baseProducts,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.saleOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            opportunityId: 'opp-1',
          }),
        })
      );
      const postLockOpportunityRead = mockPrisma.opportunity.findFirst.mock.invocationCallOrder[1]!;
      const uniquenessRead = mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[0]!;
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        postLockOpportunityRead
      );
      expect(postLockOpportunityRead).toBeLessThan(uniquenessRead);
      expect(uniquenessRead).toBeLessThan(mockPrisma.saleOrder.create.mock.invocationCallOrder[0]!);
    });

    it('锁后发现商机已软删/改绑时 fail-closed，且不执行 uniqueness 或 create', async () => {
      mockPrisma.opportunity.findFirst
        .mockResolvedValueOnce({ customerId: 'cust-1' })
        .mockResolvedValueOnce(null);

      await expect(
        service.create(
          {
            customerId: 'cust-1',
            opportunityId: 'opp-raced',
            orderAmount: 10000,
            products: baseProducts,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saleOrder.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.create).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.opportunity.findFirst.mock.invocationCallOrder[1]!
      );
    });

    it('should reject when opportunity already has an active sale order', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        serialNumber: 'DD0001',
        orderTitle: '客户A-合同订单',
      });

      await expect(
        service.create(
          {
            customerId: 'cust-1',
            opportunityId: 'opp-1',
            orderAmount: 10000,
            products: baseProducts,
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.saleOrder.create).not.toHaveBeenCalled();
    });

    it('无需审批的新订单在创建事务内统一推进商机与客户生命周期', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-with-opp',
        customerId: 'cust-1',
        opportunityId: 'opp-1',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValue(order);

      await service.create(
        {
          customerId: 'cust-1',
          opportunityId: 'opp-1',
          orderAmount: 10000,
          products: baseProducts,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledTimes(1);
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
        mockPrisma,
        { opportunityIds: ['opp-1'], customerIds: ['cust-1'] },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });

    it('待审批新订单不提前推进商机；自审批终态仅由 approved 回写路径负责', async () => {
      isApprovalRequired.mockResolvedValue(true);
      const order = buildSaleOrderWithRelations({
        id: 'order-pending',
        customerId: 'cust-1',
        opportunityId: 'opp-1',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });
      mockPrisma.saleOrder.create.mockResolvedValue(order);
      mockPrisma.saleOrder.findFirst.mockResolvedValueOnce(null).mockResolvedValue(order);

      await service.create(
        {
          customerId: 'cust-1',
          opportunityId: 'opp-1',
          orderAmount: 10000,
          products: baseProducts,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(reconcileSaleOrderActivationLifecycle).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('缺少 version 时拒绝更新', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-1', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.update(
          'order-1',
          { orderTitle: '更新订单' } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should update with version check', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-1', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });

      await service.update(
        'order-1',
        { orderTitle: '更新订单', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      // 注意：orderTitle 由后端按「客户名-日期-金额」无条件重新生成，dto.orderTitle 被忽略
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'order-1', version: 1 },
          data: expect.objectContaining({
            version: { increment: 1 },
          }),
        })
      );
    });

    it('审批中订单在派生汇总后同步审批目标最终版本', async () => {
      const order = {
        ...buildSaleOrderWithRelations({
          id: 'order-pending',
          version: 1,
          orderAmount: 1000,
        }),
        flowStatus: 'pending',
      };
      const updated = { ...order, version: 2, orderAmount: 1200 };
      const finalized = { ...updated, version: 3, invoicedAmount: 0 };
      mockBusinessApprovalService.lockPendingFormEdit.mockResolvedValue({
        id: 'approval-1',
        initiatorId: 'user-1',
        version: 4,
      });
      mockPrisma.saleOrder.findFirst
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(updated)
        .mockResolvedValueOnce(finalized)
        .mockResolvedValue(finalized);
      mockPrisma.saleOrder.update.mockResolvedValueOnce(updated).mockResolvedValueOnce(finalized);

      await service.update(
        order.id,
        { orderAmount: 1200, version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockBusinessApprovalService.syncPendingFormEdit).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'approval-1', initiatorId: 'user-1', version: 4 },
        'sale_order_activate',
        expect.objectContaining({ id: order.id, version: 3 }),
        expect.objectContaining({ id: 'user-1' })
      );
    });

    it('should convert orderAmount to String on update without overwriting receivables', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        orderAmount: 10000,
        totalReceivables: 10000,
        totalReceived: 2500,
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });

      await service.update(
        'order-1',
        { orderAmount: 12345.67, version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderAmount: '12345.67',
          }),
        })
      );
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            totalReceivables: expect.anything(),
            totalUncollected: expect.anything(),
          }),
        })
      );
    });

    it('should not overwrite custom receivables when updating orderAmount', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        orderAmount: 10000,
        totalReceivables: 12000,
        totalReceived: 1000,
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });

      await service.update(
        'order-1',
        { orderAmount: 12345.67, version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            totalReceivables: expect.anything(),
            totalUncollected: expect.anything(),
          }),
        })
      );
    });

    it('should recompute productAmount and receivables when updating products', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        orderAmount: 1000,
        totalReceivables: 1000,
        totalReceived: 100,
      });
      mockPrisma.saleOrder.findFirst
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, version: 2, totalReceivables: 900 })
        .mockResolvedValue({ ...order, version: 3, totalReceivables: 900 });
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });

      await service.update(
        'order-1',
        {
          version: 1,
          products: [
            {
              productName: '折扣产品',
              quantity: 1,
              unitPrice: 1000,
              contractUnitPrice: 900,
              subtotalAmount: 1,
            },
          ],
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productAmount: '1000.00',
            totalReceivables: '900.00',
            totalUncollected: '800.00',
          }),
        })
      );
      expect(mockPrisma.orderProduct.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            discount: '10.00',
            subtotalAmount: '900.00',
          }),
        ]),
      });
    });

    it('产品 replacement 对完全相同快照不软删、不新建，也不检查 PaymentItem', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-product-noop', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        {
          id: 'product-keep',
          version: 6,
          productName: '钉钉专业版',
          productNumber: null,
          productPrice: null,
          quantity: 10,
          unitPrice: 120,
          contractUnitPrice: 200,
          discount: -66.67,
          subtotalAmount: 2000,
          remark: null,
        },
      ]);

      await service.update(
        order.id,
        { version: 1, products: baseProducts } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.paymentItem.count).not.toHaveBeenCalled();
      expect(mockPrisma.orderProduct.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.orderProduct.createMany).not.toHaveBeenCalled();
    });

    it('产品 replacement 只软删变化行并以 id+version CAS，新行与主写同事务创建', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-product-diff', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });
      mockPrisma.orderProduct.findMany.mockResolvedValue([
        {
          id: 'product-keep',
          version: 2,
          productName: '钉钉专业版',
          productNumber: null,
          productPrice: null,
          quantity: 10,
          unitPrice: 120,
          contractUnitPrice: 200,
          discount: -66.67,
          subtotalAmount: 2000,
          remark: null,
        },
        {
          id: 'product-remove',
          version: 9,
          productName: '旧硬件',
          productNumber: null,
          productPrice: null,
          quantity: 1,
          unitPrice: 500,
          contractUnitPrice: 500,
          discount: 0,
          subtotalAmount: 500,
          remark: null,
        },
      ]);
      mockPrisma.paymentItem.count.mockResolvedValue(0);
      mockPrisma.orderProduct.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.orderProduct.createMany.mockResolvedValue({ count: 1 });

      await service.update(
        order.id,
        {
          version: 1,
          products: [
            ...baseProducts,
            {
              productName: '新硬件',
              quantity: 2,
              unitPrice: 600,
              contractUnitPrice: 550,
            },
          ],
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.paymentItem.count).toHaveBeenCalledWith({
        where: { saleOrderProductId: { in: ['product-remove'] }, deletedAt: null },
      });
      expect(mockPrisma.orderProduct.updateMany).toHaveBeenCalledWith({
        where: {
          saleOrderId: order.id,
          deletedAt: null,
          OR: [{ id: 'product-remove', version: 9 }],
        },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.orderProduct.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            saleOrderId: order.id,
            productName: '新硬件',
            subtotalAmount: '1100.00',
          }),
        ],
      });
    });

    it('should set Decimal field to null when explicitly null', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-1', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue({ ...order, version: 2 });

      await service.update(
        'order-1',
        { orderAmount: null, version: 1 } as unknown as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ orderAmount: null }),
        })
      );
    });

    it('should throw ConflictException on P2025', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-1', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.saleOrder.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'order-1',
          { orderTitle: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const order = buildSaleOrderWithRelations({ id: 'order-1', version: 1 });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockRejectedValue(new Error('Unknown error'));

      await expect(
        service.update(
          'order-1',
          { orderTitle: '错误', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow('Unknown error');
    });

    it('历史多订单下普通 remark 更新仍走统一图锁，但不跑 uniqueness', async () => {
      const existing = buildSaleOrderWithRelations({
        id: 'order-history',
        version: 1,
        customerId: 'cust-1',
        opportunityId: 'opp-history',
      });
      const updated = { ...existing, version: 2, remark: '普通备注' };
      mockPrisma.saleOrder.findFirst.mockResolvedValueOnce(existing).mockResolvedValue(updated);
      mockPrisma.opportunity.findFirst.mockResolvedValue({ customerId: 'cust-1' });
      mockPrisma.saleOrder.update.mockResolvedValue(updated);

      await service.update(
        existing.id,
        { remark: '普通备注', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
        'sale_order_financial:order-history',
        'sale_order_opportunity:opp-history',
      ]);
      expect(mockPrisma.saleOrder.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ opportunityId: 'opp-history' }),
        })
      );
      expect(mockPrisma.saleOrder.update).toHaveBeenCalledTimes(1);
      expect(reconcileSaleOrderActivationLifecycle).not.toHaveBeenCalled();
    });

    it('实际改绑严格按 advisory locks → 锁后商机复查 → uniqueness → write 排序', async () => {
      const existing = buildSaleOrderWithRelations({
        id: 'order-rebind',
        version: 1,
        customerId: 'cust-1',
        opportunityId: 'opp-z',
      });
      const updated = { ...existing, version: 2, opportunityId: 'opp-a' };
      mockPrisma.saleOrder.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(updated);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });
      mockPrisma.saleOrder.update.mockResolvedValue(updated);
      mockPrisma.project.findUnique.mockResolvedValue(null);

      await service.update(
        existing.id,
        { opportunityId: 'opp-a', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.$executeRaw.mock.calls.map((call) => call[1])).toEqual([
        'sale_order_financial:order-rebind',
        'sale_order_opportunity:opp-a',
        'sale_order_opportunity:opp-z',
      ]);
      const lastAdvisoryLock = mockPrisma.$executeRaw.mock.invocationCallOrder.at(-1)!;
      const postLockOpportunityRead = mockPrisma.opportunity.findFirst.mock.invocationCallOrder[1]!;
      const uniquenessRead = mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[2]!;
      expect(lastAdvisoryLock).toBeLessThan(postLockOpportunityRead);
      expect(postLockOpportunityRead).toBeLessThan(uniquenessRead);
      expect(uniquenessRead).toBeLessThan(mockPrisma.saleOrder.update.mock.invocationCallOrder[0]!);
    });

    it('should reject when changing customer makes existing opportunity inconsistent', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        customerId: 'cust-1',
        opportunityId: 'opp-1',
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });

      await expect(
        service.update(
          'order-1',
          { customerId: 'cust-other', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });

    it('should reject when changing opportunity to another customer', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        customerId: 'cust-1',
        opportunityId: null,
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-other',
      });

      await expect(
        service.update(
          'order-1',
          { opportunityId: 'opp-other', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });

    it('should reject when changing to an opportunity linked by another active order', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        customerId: 'cust-1',
        opportunityId: null,
      });
      mockPrisma.saleOrder.findFirst
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({
          serialNumber: 'DD0002',
          orderTitle: '已有关联订单',
        });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });

      await expect(
        service.update(
          'order-1',
          { opportunityId: 'opp-used', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });

    it('should reject changing opportunity when the order is already linked to a project', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        customerId: 'cust-1',
        opportunityId: 'opp-old',
      });
      mockPrisma.saleOrder.findFirst
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce(null);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        customerId: 'cust-1',
      });
      mockPrisma.project.findUnique.mockResolvedValue({
        customerId: 'cust-1',
        opportunityId: 'opp-old',
      });

      await expect(
        service.update(
          'order-1',
          { opportunityId: 'opp-new', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('合同订单已关联项目');

      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });

    it('客户改绑后按新旧客户集合一次传递同一 actor/tx 完整重算 lifecycle', async () => {
      const existing = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        customerId: 'cust-old',
        opportunityId: null,
      });
      const updated = { ...existing, customerId: 'cust-new', version: 2 };
      mockPrisma.saleOrder.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing)
        .mockResolvedValue(updated);
      mockPrisma.saleOrder.update.mockResolvedValue(updated);
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.invoice.count.mockResolvedValue(0);
      mockPrisma.customer.findUnique.mockResolvedValue({
        customerName: '新客户',
      });

      await service.update(
        'order-1',
        { customerId: 'cust-new', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledTimes(1);
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
        mockPrisma,
        {
          opportunityIds: [null, null],
          customerIds: ['cust-old', 'cust-new'],
          retractedOpportunityIds: [null],
        },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });

    it('should reject updating an existing order without product rows', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        version: 1,
        products: [],
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.update(
          'order-1',
          { orderAmount: 12345.67, version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('submitChangeRequest 日期最终态校验', () => {
    it('begin-only 与既有结束日期合并后倒置时拒绝提交', async () => {
      const order = {
        ...buildSaleOrderWithRelations({ id: 'order-date-1', version: 2 }),
        flowStatus: 'approved',
        orderBeginDate: new Date('2026-05-01T00:00:00.000Z'),
        orderEndDate: new Date('2026-05-31T00:00:00.000Z'),
      };
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.submitChangeRequest(
          order.id,
          { version: 2, orderBeginDate: '2026-06-01' } as never,
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('合同结束日期不能早于合同开始日期');
      expect(submitChangeApproval).not.toHaveBeenCalled();
    });

    it('end-only 与既有开始日期合并后倒置时拒绝提交', async () => {
      const order = {
        ...buildSaleOrderWithRelations({ id: 'order-date-2', version: 2 }),
        flowStatus: 'approved',
        orderBeginDate: new Date('2026-05-10T00:00:00.000Z'),
        orderEndDate: new Date('2026-05-31T00:00:00.000Z'),
      };
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.submitChangeRequest(order.id, { version: 2, orderEndDate: '2026-05-09' } as never, {
          id: 'user-1',
          employeeId: 'emp-user-1',
        })
      ).rejects.toThrow('合同结束日期不能早于合同开始日期');
      expect(submitChangeApproval).not.toHaveBeenCalled();
    });

    it('即使绕过 DTO 调用 service，也拒绝非法日历日', async () => {
      const order = {
        ...buildSaleOrderWithRelations({ id: 'order-date-3', version: 2 }),
        flowStatus: 'approved',
        orderBeginDate: new Date('2026-05-01T00:00:00.000Z'),
        orderEndDate: new Date('2026-05-31T00:00:00.000Z'),
      };
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await expect(
        service.submitChangeRequest(
          order.id,
          { version: 2, orderBeginDate: '2026-02-31' } as never,
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('合同开始日期必须是有效的 YYYY-MM-DD 日历日期');
      expect(submitChangeApproval).not.toHaveBeenCalled();
    });
  });

  describe('submitChangeRequest 最终引用事务校验', () => {
    function buildApprovedOrder() {
      return {
        ...buildSaleOrderWithRelations({
          id: 'order-change-refs',
          version: 3,
          customerId: 'cust-old',
          opportunityId: 'opp-old',
          chargerId: 'emp-old',
        }),
        flowStatus: 'approved',
      };
    }

    it.each([
      ['remark', { remark: '普通备注' }],
      ['amount', { orderAmount: 12345 }],
      ['products', { products: baseProducts }],
    ])(
      '历史多订单下普通 %s 变更提单保留实时 scope 校验，但不跑 uniqueness',
      async (_label, patch) => {
        const order = buildApprovedOrder();
        mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
        mockPrisma.customer.findFirst.mockResolvedValue({
          id: order.customerId,
        });
        mockPrisma.employee.findFirst.mockResolvedValue({
          id: order.chargerId,
        });
        mockPrisma.opportunity.findFirst.mockResolvedValue({
          id: order.opportunityId,
        });

        await service.submitChangeRequest(
          order.id,
          { version: order.version, ...patch } as never,
          { id: 'auth-user', employeeId: 'emp-user' },
          null,
          'emp-user'
        );

        const input = submitChangeApproval.mock.calls[0]![0] as {
          validateInTransaction: (tx: never) => Promise<void>;
        };
        await input.validateInTransaction(mockPrisma as never);

        expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith({
          where: {
            id: order.opportunityId,
            customerId: order.customerId,
            deletedAt: null,
          },
          select: { id: true },
        });
        expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
        expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledTimes(1);
      }
    );

    it('在创建变更申请的同一事务校验最终 customer/charger/opportunity 范围、关系和软删', async () => {
      const order = buildApprovedOrder();
      mockPrisma.saleOrder.findFirst.mockResolvedValueOnce(order).mockResolvedValueOnce(null);
      mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-new' });
      mockPrisma.employee.findFirst.mockResolvedValue({ id: 'emp-scope' });
      mockPrisma.opportunity.findFirst.mockResolvedValue({ id: 'opp-new' });
      mockPrisma.payment.count.mockResolvedValue(0);
      mockPrisma.invoice.count.mockResolvedValue(0);

      await service.submitChangeRequest(
        order.id,
        {
          version: 3,
          customerId: 'cust-new',
          chargerId: 'emp-scope',
          opportunityId: 'opp-new',
        } as never,
        { id: 'auth-user', employeeId: 'emp-user' },
        ['emp-scope'],
        'emp-user'
      );

      const input = submitChangeApproval.mock.calls[0]![0] as {
        validateInTransaction: (tx: never) => Promise<void>;
      };
      await input.validateInTransaction(mockPrisma as never);

      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'cust-new',
          deletedAt: null,
          OR: [
            { chargerId: { in: ['emp-scope'] } },
            { collaboratorIds: { array_contains: ['emp-user'] } },
          ],
        },
        select: { id: true },
      });
      expect(mockPrisma.employee.findFirst).toHaveBeenCalledWith({
        where: {
          id: { equals: 'emp-scope', in: ['emp-scope'] },
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'opp-new',
          customerId: 'cust-new',
          deletedAt: null,
        }),
        select: { id: true },
      });
      const postLockOpportunityRead = mockPrisma.opportunity.findFirst.mock.invocationCallOrder[0]!;
      const uniquenessRead = mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[1]!;
      // 统一 validator 在调用该窄化 callback 前已取得完整图锁；callback 本身禁止倒序补锁。
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      expect(postLockOpportunityRead).toBeLessThan(uniquenessRead);
    });

    it.each([
      ['最终客户已删除或越权', 'customer'],
      ['最终负责人已删除或越权', 'charger'],
      ['最终商机已删除、越权或客户不一致', 'opportunity'],
    ])('事务校验 fail-closed：%s 时不返回变更申请', async (_label, missingRef) => {
      const order = buildApprovedOrder();
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.customer.findFirst.mockResolvedValue(
        missingRef === 'customer' ? null : { id: 'cust-new' }
      );
      mockPrisma.employee.findFirst.mockResolvedValue(
        missingRef === 'charger' ? null : { id: 'emp-scope' }
      );
      mockPrisma.opportunity.findFirst.mockResolvedValue(
        missingRef === 'opportunity' ? null : { id: 'opp-new' }
      );
      submitChangeApproval.mockImplementationOnce(
        async (input: { validateInTransaction?: (tx: never) => Promise<void> }) => {
          await input.validateInTransaction?.(mockPrisma as never);
          return { id: 'must-not-return' };
        }
      );

      await expect(
        service.submitChangeRequest(
          order.id,
          {
            version: 3,
            customerId: 'cust-new',
            chargerId: 'emp-scope',
            opportunityId: 'opp-new',
          } as never,
          { id: 'auth-user', employeeId: 'emp-user' },
          ['emp-scope'],
          'emp-user'
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('缺少 version 时拒绝删除', async () => {
      await expect(
        service.remove('order-1', { id: 'user-1', employeeId: 'emp-user-1' })
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.saleOrder.findFirst).not.toHaveBeenCalled();
    });

    it('should soft delete sale order', async () => {
      const order = buildSaleOrderWithRelations({
        id: 'order-1',
        opportunityId: 'opp-remove',
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);
      mockPrisma.saleOrder.update.mockResolvedValue(order);

      await service.remove(
        'order-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        order.version
      );

      expect(mockPrisma.saleOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1', version: order.version },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
      expect(mockPrisma.$queryRaw.mock.calls.map((call) => call[1])).toEqual([
        'order-1',
        'order-1',
        'order-1',
        'order-1',
        'order-1',
        'order-1',
        'order-1',
        'order-1',
        'opp-remove',
        order.customerId,
      ]);
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPrisma.$queryRaw.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPrisma.saleOrder.update.mock.invocationCallOrder[0]!
      );
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledTimes(1);
      expect(reconcileSaleOrderActivationLifecycle).toHaveBeenCalledWith(
        mockPrisma,
        {
          opportunityIds: [order.opportunityId],
          customerIds: [order.customerId],
          retractedOpportunityIds: [order.opportunityId],
        },
        { id: 'user-1', employeeId: 'emp-user-1' }
      );
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.saleOrder.findFirst.mockResolvedValue(null);

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

  describe('batchRemove', () => {
    it('逐条复用单删原语并携带当前 version', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([
        { id: 'order-1', flowStatus: 'draft', version: 2 },
        { id: 'order-2', flowStatus: 'draft', version: 5 },
      ]);
      const removeSpy = vi.spyOn(service, 'remove').mockResolvedValue(undefined);

      const result = await service.batchRemove(
        ['order-1', 'order-2'],
        { id: 'user-1', employeeId: 'emp-user-1' },
        ['emp-user-1'],
        'emp-user-1'
      );

      expect(result).toEqual({ success: 2, skipped: [], errors: [] });
      expect(removeSpy).toHaveBeenNthCalledWith(
        1,
        'order-1',
        { id: 'user-1', employeeId: 'emp-user-1' },
        ['emp-user-1'],
        'emp-user-1',
        2
      );
      expect(removeSpy).toHaveBeenNthCalledWith(
        2,
        'order-2',
        { id: 'user-1', employeeId: 'emp-user-1' },
        ['emp-user-1'],
        'emp-user-1',
        5
      );
    });
  });

  describe('batchTransfer', () => {
    it('用每行真实 version 构造 CAS OR，并在同一 updateMany 中原子转交', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-new' });
      mockPrisma.saleOrder.findMany
        .mockResolvedValueOnce([
          { id: 'order-1', version: 2, flowStatus: 'draft' },
          { id: 'order-2', version: 5, flowStatus: 'draft' },
        ])
        .mockResolvedValueOnce([
          { id: 'order-1', serialNumber: 'DD0001' },
          { id: 'order-2', serialNumber: 'DD0002' },
        ])
        .mockResolvedValueOnce([
          { id: 'order-1', serialNumber: 'DD0001', chargerId: 'emp-new' },
          { id: 'order-2', serialNumber: 'DD0002', chargerId: 'emp-new' },
        ]);
      mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.batchTransfer(
        {
          ids: ['order-1', 'order-2'],
          versions: { 'order-1': 2, 'order-2': 5 },
          chargerId: 'emp-new',
        },
        { id: 'user-1', employeeId: 'emp-user-1' },
        null,
        'emp-user-1'
      );

      expect(result).toEqual({ success: 2, skipped: [] });
      expect(mockPrisma.saleOrder.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          select: { id: true, version: true, flowStatus: true },
        })
      );
      expect(mockPrisma.saleOrder.updateMany).toHaveBeenCalledWith({
        where: {
          deletedAt: null,
          AND: [
            {
              OR: [
                { id: 'order-1', version: 2 },
                { id: 'order-2', version: 5 },
              ],
            },
          ],
        },
        data: expect.objectContaining({
          chargerId: 'emp-new',
          chargerName: null,
          version: { increment: 1 },
        }),
      });
      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
    });

    it.each(['version', '软删除'])('%s 在候选读取后变化时整批 409，且没有逐行部分写', async () => {
      mockPrisma.employee.findUnique.mockResolvedValue({ id: 'emp-new' });
      mockPrisma.saleOrder.findMany
        .mockResolvedValueOnce([
          { id: 'order-1', version: 2, flowStatus: 'draft' },
          { id: 'order-2', version: 5, flowStatus: 'draft' },
        ])
        .mockResolvedValueOnce([
          { id: 'order-1', serialNumber: 'DD0001' },
          { id: 'order-2', serialNumber: 'DD0002' },
        ]);
      mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.batchTransfer(
          {
            ids: ['order-1', 'order-2'],
            versions: { 'order-1': 2, 'order-2': 5 },
            chargerId: 'emp-new',
          },
          { id: 'user-1', employeeId: 'emp-user-1' },
          null,
          'emp-user-1'
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.saleOrder.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saleOrder.update).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('batchUpdate', () => {
    it('跳过已通过记录，并以 CAS OR + 非 approved + scope 约束原子编辑', async () => {
      mockPrisma.saleOrder.findMany
        .mockResolvedValueOnce([
          { id: 'order-draft', version: 2, flowStatus: 'draft' },
          { id: 'order-approved', version: 7, flowStatus: 'approved' },
        ])
        .mockResolvedValueOnce([{ id: 'order-draft', serialNumber: 'DD0001' }])
        .mockResolvedValueOnce([{ id: 'order-draft', serialNumber: 'DD0001', remark: '已修正' }]);
      mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.batchUpdate(
        {
          ids: ['order-draft', 'order-approved'],
          versions: { 'order-draft': 2, 'order-approved': 7 },
          patch: { remark: '已修正' },
        },
        { id: 'user-1', employeeId: 'emp-user-1' },
        ['emp-user-1'],
        'emp-user-1'
      );

      expect(result).toEqual({ success: 1, skipped: ['order-approved'] });
      expect(mockPrisma.saleOrder.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          select: {
            id: true,
            version: true,
            flowStatus: true,
            orderBeginDate: true,
            orderEndDate: true,
          },
        })
      );
      expect(mockPrisma.saleOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            AND: [
              { OR: [{ id: 'order-draft', version: 2 }] },
              {
                OR: [{ flowStatus: null }, { flowStatus: { not: 'approved' } }],
              },
            ],
            OR: [
              { chargerId: { in: ['emp-user-1'] } },
              { customer: { chargerId: { in: ['emp-user-1'] } } },
              { customer: { chargerId: null } },
              {
                customer: {
                  collaboratorIds: { array_contains: ['emp-user-1'] },
                },
              },
            ],
          },
        })
      );
    });

    it('允许发起人批量编辑 pending 订单并同步审批快照', async () => {
      mockBusinessApprovalService.lockPendingFormEdit.mockResolvedValue({
        id: 'approval-1',
        version: 4,
      });
      mockPrisma.saleOrder.findMany
        .mockResolvedValueOnce([{ id: 'order-pending', version: 2, flowStatus: 'pending' }])
        .mockResolvedValueOnce([{ id: 'order-pending', serialNumber: 'DD0001' }])
        .mockResolvedValueOnce([{ id: 'order-pending', version: 2, flowStatus: 'pending' }])
        .mockResolvedValueOnce([
          {
            id: 'order-pending',
            version: 3,
            serialNumber: 'DD0001',
            orderTitle: '合同',
            orderAmount: 100,
            customer: { id: 'cust-1', customerName: '客户', shortName: '客户' },
          },
        ])
        .mockResolvedValueOnce([{ id: 'order-pending', serialNumber: 'DD0001', remark: '已修正' }]);
      mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.batchUpdate(
          {
            ids: ['order-pending'],
            versions: { 'order-pending': 2 },
            patch: { remark: '已修正' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).resolves.toEqual({ success: 1, skipped: [] });

      expect(mockBusinessApprovalService.lockPendingFormEdit).toHaveBeenCalledWith(
        expect.anything(),
        'sale_order_activate',
        'order-pending',
        'pending',
        expect.objectContaining({ id: 'user-1' })
      );
      expect(mockBusinessApprovalService.syncPendingFormEdit).toHaveBeenCalledWith(
        expect.anything(),
        { id: 'approval-1', version: 4 },
        'sale_order_activate',
        expect.objectContaining({ id: 'order-pending' }),
        expect.objectContaining({ id: 'user-1' })
      );
    });

    it('批量编辑审批中订单时拒绝非审批发起人', async () => {
      mockBusinessApprovalService.lockPendingFormEdit.mockRejectedValue(
        new ForbiddenException('只有审批发起人可在审核通过前修改表单')
      );
      mockPrisma.saleOrder.findMany.mockResolvedValueOnce([
        { id: 'order-pending', version: 2, flowStatus: 'pending' },
      ]);

      await expect(
        service.batchUpdate(
          {
            ids: ['order-pending'],
            versions: { 'order-pending': 2 },
            patch: { remark: '越权修改' },
          },
          { id: 'other-user', employeeId: 'emp-other' }
        )
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.saleOrder.updateMany).not.toHaveBeenCalled();
    });

    it.each(['审批状态', '软删除', '访问范围', 'version'])(
      '%s 在候选读取与最终写入间变化时整批 409，零部分写',
      async () => {
        mockPrisma.saleOrder.findMany
          .mockResolvedValueOnce([
            { id: 'order-1', version: 1, flowStatus: 'draft' },
            { id: 'order-2', version: 3, flowStatus: 'draft' },
          ])
          .mockResolvedValueOnce([
            { id: 'order-1', serialNumber: 'DD0001' },
            { id: 'order-2', serialNumber: 'DD0002' },
          ]);
        mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 1 });

        const error = await service
          .batchUpdate(
            {
              ids: ['order-1', 'order-2'],
              versions: { 'order-1': 1, 'order-2': 3 },
              patch: { remark: '不可部分落库' },
            },
            { id: 'user-1', employeeId: 'emp-user-1' },
            ['emp-user-1'],
            'emp-user-1'
          )
          .then(
            () => null,
            (reason: unknown) => reason
          );

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getStatus()).toBe(409);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockPrisma.saleOrder.updateMany).toHaveBeenCalledTimes(1);
        expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledTimes(2);
      }
    );

    it('候选读取已发现 expected version 陈旧时在写事务前返回 409', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValueOnce([
        { id: 'order-1', version: 2, flowStatus: 'pending' },
      ]);

      await expect(
        service.batchUpdate(
          {
            ids: ['order-1'],
            versions: { 'order-1': 1 },
            patch: { remark: '陈旧修改' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.updateMany).not.toHaveBeenCalled();
    });

    it('非法日历日不会生成 Invalid Date 或进入 Prisma', async () => {
      await expect(
        service.batchUpdate(
          {
            ids: ['order-1'],
            versions: { 'order-1': 1 },
            patch: { businessDate: '2026-02-31' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.saleOrder.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('服务层防御性拒绝倒置合同区间', async () => {
      await expect(
        service.batchUpdate(
          {
            ids: ['order-1'],
            versions: { 'order-1': 1 },
            patch: { orderBeginDate: '2026-05-02', orderEndDate: '2026-05-01' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.saleOrder.updateMany).not.toHaveBeenCalled();
    });

    it('batch partial 在候选现有日期可判定时拒绝倒置最终区间', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValueOnce([
        {
          id: 'order-1',
          version: 4,
          flowStatus: 'pending',
          orderBeginDate: new Date('2026-05-02T00:00:00.000Z'),
          orderEndDate: new Date('2026-05-10T00:00:00.000Z'),
        },
      ]);

      await expect(
        service.batchUpdate(
          {
            ids: ['order-1'],
            versions: { 'order-1': 4 },
            patch: { orderEndDate: '2026-05-01' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.saleOrder.updateMany).not.toHaveBeenCalled();
    });

    it('单边日期校验后若并发单改另一边日期，逐行 version CAS 阻止最终区间倒置', async () => {
      mockPrisma.saleOrder.findMany
        .mockResolvedValueOnce([
          {
            id: 'order-1',
            version: 5,
            flowStatus: 'pending',
            orderBeginDate: new Date('2026-05-01T00:00:00.000Z'),
            orderEndDate: new Date('2026-05-10T00:00:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([{ id: 'order-1', serialNumber: 'DD0001' }]);
      // 候选读后另一请求把 begin 改到 2026-05-20 并将 version 增至 6，本次 CAS 命中 0。
      mockPrisma.saleOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.batchUpdate(
          {
            ids: ['order-1'],
            versions: { 'order-1': 5 },
            patch: { orderEndDate: '2026-05-15' },
          },
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.saleOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ OR: [{ id: 'order-1', version: 5 }] }]),
          }),
        })
      );
      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('findAllForSelection', () => {
    it('should return simplified sale order list', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([
        {
          id: '1',
          serialNumber: 'DD001',
          orderTitle: '订单A',
          customerId: 'cust-1',
          legacyAdjustment: false,
          customer: { customerName: '客户A' },
        },
      ]);

      const result = await service.findAllForSelection({});

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('orderName', '订单A');
      expect(result[0]).toHaveProperty('customerName', '客户A');
      expect(result[0]).toHaveProperty('legacyAdjustment', false);
      expect(mockPrisma.saleOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ legacyAdjustment: false }),
          select: expect.objectContaining({ legacyAdjustment: true }),
        })
      );
    });

    it('should use serialNumber as orderName when orderTitle is null', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([
        {
          id: '1',
          serialNumber: 'DD001',
          orderTitle: null,
          customerId: 'cust-1',
          customer: null,
        },
      ]);

      const result = await service.findAllForSelection({});

      expect(result[0]).toHaveProperty('orderName', 'DD001');
    });
  });

  describe('RBAC dual-path scope', () => {
    // 验证 sale_orders 走 (chargerId IN scope OR customer.chargerId IN scope) 双路径
    // 与 payments / opportunities / keep_records / visit_records 维度统一。
    // 见 plan: ~/.claude/plans/quiet-knitting-walrus.md
    it('findAll should pass dual-path OR baseWhere when chargerScope provided', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, ['emp-B']);

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          chargerScope: null, // applier 不再注入 isScopeField AND，避免覆盖 OR
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

    it('findAll should not inject OR when chargerScope is null (ADMIN)', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);
      mockPrisma.saleOrder.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' }, null);

      const call = mockFilterApplier.buildWhere.mock.calls[0]![0] as {
        baseWhere: Record<string, unknown>;
      };
      expect(call.baseWhere).toEqual({ deletedAt: null });
      expect(call.baseWhere.OR).toBeUndefined();
    });

    it('findOne should match record via customer.chargerId path (B 接手客户后能看到 A 时代订单)', async () => {
      // 模拟 A 离职、客户转给 B：sale_order.chargerId=A，customer.chargerId=B
      const order = buildSaleOrderWithRelations({
        id: 'so-orphan',
        chargerId: 'emp-A',
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      const result = await service.findOne('so-orphan', ['emp-B']);

      expect(result.id).toBe('so-orphan');
      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'so-orphan',
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

    it('findOne should not inject OR when chargerScope is null', async () => {
      const order = buildSaleOrderWithRelations({ id: 'so-1' });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(order);

      await service.findOne('so-1', null);

      const call = mockPrisma.saleOrder.findFirst.mock.calls[0]![0] as {
        where: Record<string, unknown>;
      };
      expect(call.where).toEqual({ id: 'so-1', deletedAt: null });
    });

    it('findAllForSelection should wrap chargerScope OR in AND with keyword OR', async () => {
      mockPrisma.saleOrder.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ keyword: '订单' }, ['emp-B']);

      const call = mockPrisma.saleOrder.findMany.mock.calls[0]![0] as {
        where: { AND?: Array<Record<string, unknown>> };
      };
      // AND 包两组 OR：RBAC OR + keyword OR，否则它们会互相吞掉
      expect(call.where.AND).toHaveLength(2);
      expect(call.where.AND?.[0]).toEqual({
        OR: [
          { chargerId: { in: ['emp-B'] } },
          { customer: { chargerId: { in: ['emp-B'] } } },
          { customer: { chargerId: null } },
        ],
      });
    });
  });
});
