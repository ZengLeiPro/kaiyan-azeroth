import { PROJECT_STATUS } from '@ky-azeroth/shared/constants';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildOpportunity } from '../../../test/factories';
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
import type { CustomersService } from '../../customers/customers.service';
import { OpportunitiesService } from '../opportunities.service';

describe('OpportunitiesService', () => {
  let service: OpportunitiesService;
  let mockPrisma: MockPrismaService;
  let mockSerialNumber: MockSerialNumberService;
  let mockCustomersService: { refreshCustomerLifecycle: ReturnType<typeof vi.fn> };
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockSerialNumber = createMockSerialNumberService('SJ');

    mockCustomersService = {
      refreshCustomerLifecycle: vi.fn().mockResolvedValue(undefined),
    };

    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
    mockPrisma.saleOrder.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.$executeRaw.mockResolvedValue(0);

    service = new OpportunitiesService(
      asPrismaService(mockPrisma),
      asSerialNumberService(mockSerialNumber),
      mockCustomersService as unknown as CustomersService,
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated opportunities', async () => {
      const items = [buildOpportunity()];
      mockPrisma.opportunity.findMany.mockResolvedValue(items);
      mockPrisma.opportunity.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          include: expect.objectContaining({
            customer: expect.anything(),
            contact: expect.anything(),
          }),
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);
      mockPrisma.opportunity.count.mockResolvedValue(0);

      await service.findAll({ keyword: '商机', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: '商机' })
      );
    });

    it('should forward chargerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);
      mockPrisma.opportunity.count.mockResolvedValue(0);

      await service.findAll({ chargerId: 'charger-1', page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ chargerId: 'charger-1' }),
        })
      );
    });

    it('should forward customerId to FilterApplier (legacyFilters)', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);
      mockPrisma.opportunity.count.mockResolvedValue(0);

      await service.findAll({ customerId: ['cust-1'], page: 1, pageSize: 10, sortOrder: 'desc' });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ customerId: ['cust-1'] }),
        })
      );
    });

    it('should forward opportunityStage to FilterApplier (legacyFilters)', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);
      mockPrisma.opportunity.count.mockResolvedValue(0);

      await service.findAll({
        opportunityStage: ['negotiation'],
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ opportunityStage: ['negotiation'] }),
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return opportunity with products and complete WON provenance mapping', async () => {
      const opp = buildOpportunity({
        id: 'opp-1',
        wonSourceType: 'sale_order',
        wonSourceSaleOrderId: 'order-1',
        wonSourcePreviousStage: '商务谈判',
        wonSourcePreviousDealDate: new Date('2026-08-01T00:00:00.000Z'),
        wonSourcePreviousWinRate: 45,
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...opp,
        customer: null,
        contact: null,
        products: [],
      });

      const result = await service.findOne('opp-1');

      expect(result).toMatchObject({
        wonSourceType: 'sale_order',
        wonSourceSaleOrderId: 'order-1',
        wonSourcePreviousStage: '商务谈判',
        wonSourcePreviousDealDate: '2026-08-01',
        wonSourcePreviousWinRate: 45,
      });
      expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith({
        where: { id: 'opp-1', deletedAt: null },
        include: expect.objectContaining({
          products: expect.objectContaining({
            where: { deletedAt: null },
          }),
        }),
      });
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('拒绝向当前数据范围之外的客户创建商机', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          { customerId: 'cust-outside' } as Parameters<typeof service.create>[0],
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

    it('拒绝把商机负责人指定到当前数据范围之外', async () => {
      await expect(
        service.create(
          {
            customerId: 'cust-1',
            chargerId: 'emp-outside',
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(ForbiddenException);

      expect(mockSerialNumber.generate).not.toHaveBeenCalled();
    });

    it('拒绝关联不属于目标客户的联系人', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.create(
          {
            customerId: 'cust-1',
            contactId: 'contact-other-customer',
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-1' },
          ['emp-1'],
          'emp-1'
        )
      ).rejects.toThrow(/联系人不存在、已删除，或不属于当前客户/);

      expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'contact-other-customer',
          customerId: 'cust-1',
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(mockSerialNumber.generate).not.toHaveBeenCalled();
    });

    it('should create opportunity in transaction with products', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-new' });

      // $transaction 会调用回调，内部使用 mock 的 tx
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunityProduct.createMany.mockResolvedValue({ count: 2 });

      // findOne 在事务后被调用
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [],
      });

      const dto = {
        opportunityName: '新商机',
        customerId: 'cust-1',
        opportunityAmount: 1,
        winRate: 50,
        products: [
          { productName: '产品A', quantity: 10, unitPrice: 5000, subtotalAmount: 50000 },
          { productName: '产品B', quantity: 5, unitPrice: 10000, subtotalAmount: 50000 },
        ],
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockSerialNumber.generate).toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // 金额服务端权威重算：客户端传入的 opportunityAmount(1) 与 subtotalAmount 被忽略，
      // 由行小计 Decimal 求和得出：10×5000 + 5×10000 = 100000，固定 2 位小数。
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          opportunityName: '新商机',
          customerId: 'cust-1',
          opportunityAmount: '100000.00',
          winRate: '50',
        }),
      });
      expect(mockPrisma.opportunityProduct.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ productName: '产品A' }),
          expect.objectContaining({ productName: '产品B' }),
        ]),
      });
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        createdOpp.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.opportunity.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.opportunityProduct.createMany.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.opportunityProduct.createMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('客户生命周期重算失败时商机、产品与项目主事务整体失败', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-rollback', customerId: 'cust-1' });
      let rolledBack = false;
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunityProduct.createMany.mockResolvedValue({ count: 1 });
      mockCustomersService.refreshCustomerLifecycle.mockRejectedValue(
        new Error('lifecycle refresh failed')
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
          {
            customerId: 'cust-1',
            products: [{ productName: '产品A', quantity: 1, unitPrice: 1000 }],
          } as Parameters<typeof service.create>[0],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('lifecycle refresh failed');

      expect(rolledBack).toBe(true);
      expect(mockPrisma.opportunity.create).toHaveBeenCalled();
      expect(mockPrisma.opportunityProduct.createMany).toHaveBeenCalled();
      expect(mockPrisma.opportunity.findFirst).not.toHaveBeenCalled();
    });

    it('does not create a project when a custom-development opportunity is created as lost', async () => {
      const createdOpp = buildOpportunity({
        id: 'opp-lost',
        customerId: 'cust-1',
        chargerId: 'emp-user-1',
        opportunityStage: '输单流失',
      });
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunityProduct.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [{ productName: '定制开发' }],
      });

      await service.create(
        {
          customerId: 'cust-1',
          opportunityStage: '输单流失',
          loseReason: '竞品胜出',
          products: [{ productName: '定制开发', quantity: 1, unitPrice: 1000 }],
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.create).not.toHaveBeenCalled();
    });

    it('should authoritatively recompute amount from line items, ignoring client subtotalAmount', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-new' });
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunityProduct.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [],
      });

      // 行小计 = quantity × unitPrice × (1 − discount/100)，保留 2 位，再 Decimal 求和：
      //   行1：4 × 250 × (1 − 10%) = 900；行2：1 × 99.99 = 99.99；总额 = 999.99。
      // 客户端传入的 opportunityAmount(123) 与每行 subtotalAmount(999) 必须被完全忽略。
      const dto = {
        opportunityName: '重算商机',
        customerId: 'cust-1',
        opportunityAmount: 123,
        products: [
          { productName: '折扣品', quantity: 4, unitPrice: 250, discount: 10, subtotalAmount: 999 },
          { productName: '零头品', quantity: 1, unitPrice: 99.99, subtotalAmount: 999 },
        ],
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-user-1' });

      // 商机总额 = 服务端重算的行小计之和，而非客户端传入值
      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ opportunityAmount: '999.99' }),
      });
      // 每行 subtotalAmount 也由服务端按重算值写入（非客户端传入的 999）
      expect(mockPrisma.opportunityProduct.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ productName: '折扣品', subtotalAmount: '900.00' }),
          expect.objectContaining({ productName: '零头品', subtotalAmount: '99.99' }),
        ]),
      });
    });

    it('should reject products missing quantity or unitPrice', async () => {
      const dto = {
        opportunityName: '缺字段商机',
        customerId: 'cust-1',
        products: [{ productName: '无数量品', unitPrice: 100, subtotalAmount: 500 }],
      } as Parameters<typeof service.create>[0];

      // quantity 缺失 → computeProductSubtotal 抛 BadRequestException（服务端兜底必填校验）
      await expect(service.create(dto, { id: 'user-1', employeeId: 'emp-user-1' })).rejects.toThrow(
        /必须填写数量和单价/
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create opportunity without products', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-new' });
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [],
      });

      const dto = {
        opportunityName: '无产品商机',
        customerId: 'cust-1',
      } as Parameters<typeof service.create>[0];

      await service.create(dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.opportunityProduct.createMany).not.toHaveBeenCalled();
    });

    it('P1-15: 创建赢单商机且未传 winRate 时自动置 100', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-won' });
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [],
      });

      await service.create(
        {
          opportunityName: '直接赢单',
          customerId: 'cust-1',
          opportunityStage: '赢单',
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ opportunityStage: '赢单', winRate: '100' }),
      });
    });

    it('P1-15: 创建赢单商机但 caller 显式传 winRate 时尊重 caller', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-won-2' });
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [],
      });

      await service.create(
        {
          opportunityName: '部分赢单',
          customerId: 'cust-1',
          opportunityStage: '赢单',
          winRate: 80,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ winRate: '80' }),
      });
    });

    it('should convert Decimal fields to String on create', async () => {
      const createdOpp = buildOpportunity({ id: 'opp-new' });
      mockPrisma.opportunity.create.mockResolvedValue(createdOpp);
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...createdOpp,
        customer: null,
        contact: null,
        products: [],
      });

      await service.create(
        {
          opportunityName: '精度商机',
          customerId: 'cust-1',
          opportunityAmount: 99999.99,
          winRate: 75.5,
        } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.opportunity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          opportunityAmount: '99999.99',
          winRate: '75.5',
        }),
      });
    });
  });

  describe('update', () => {
    it('商机迁移在主事务内按 [旧, 新] 客户完整刷新生命周期', async () => {
      const existing = buildOpportunity({
        id: 'opp-move',
        version: 2,
        customerId: 'cust-a',
      });
      const withRelations = {
        ...existing,
        customer: null,
        contact: null,
        products: [],
      };
      mockPrisma.opportunity.findFirst
        .mockResolvedValueOnce(withRelations)
        .mockResolvedValueOnce(withRelations)
        .mockResolvedValueOnce({ ...withRelations, customerId: 'cust-b', version: 3 });
      mockPrisma.opportunity.update.mockResolvedValue({
        ...existing,
        customerId: 'cust-b',
        version: 3,
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue(null);

      await service.update(
        'opp-move',
        { customerId: 'cust-b', version: 2 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'opp-move', version: 2, deletedAt: null } })
      );
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        ['cust-a', 'cust-b'],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith({
        where: { opportunityId: 'opp-move', deletedAt: null },
        select: { serialNumber: true, orderTitle: true },
      });
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.opportunity.update.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.opportunity.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('有关联有效订单时拒绝改绑客户，且检查发生在 CAS 与生命周期之前', async () => {
      const existing = buildOpportunity({
        id: 'opp-linked-move',
        version: 3,
        customerId: 'cust-a',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        serialNumber: 'DD-LINKED',
        orderTitle: '已关联合同',
      });

      await expect(
        service.update(
          'opp-linked-move',
          { customerId: 'cust-b', version: 3 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith({
        where: { opportunityId: 'opp-linked-move', deletedAt: null },
        select: { serialNumber: true, orderTitle: true },
      });
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('A→C 成功后，陈旧版本的 A→B 更新与删除均冲突且不污染生命周期', async () => {
      const initialA = buildOpportunity({
        id: 'opp-aba',
        version: 1,
        customerId: 'cust-a',
      });
      const currentC = buildOpportunity({
        ...initialA,
        version: 2,
        customerId: 'cust-c',
      });
      const withRelations = (opportunity: typeof initialA) => ({
        ...opportunity,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.findFirst
        .mockResolvedValueOnce(withRelations(initialA))
        .mockResolvedValueOnce(withRelations(initialA))
        .mockResolvedValueOnce(withRelations(currentC))
        .mockResolvedValueOnce(withRelations(currentC))
        .mockResolvedValueOnce(withRelations(currentC));
      mockPrisma.opportunity.update.mockResolvedValueOnce(currentC);

      await service.update(
        'opp-aba',
        { customerId: 'cust-c', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      await expect(
        service.update(
          'opp-aba',
          { customerId: 'cust-b', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow(ConflictException);
      await expect(
        service.remove(
          'opp-aba',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          1
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.opportunity.update).toHaveBeenCalledTimes(1);
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledTimes(1);
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        ['cust-a', 'cust-c'],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
    });

    it('更新主写后的生命周期重算失败时商机事务整体回滚', async () => {
      const existing = buildOpportunity({ id: 'opp-rollback', version: 2 });
      let rolledBack = false;
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 3 });
      mockCustomersService.refreshCustomerLifecycle.mockRejectedValue(
        new Error('update lifecycle failed')
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
          'opp-rollback',
          { remark: '原子更新', version: 2 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-user-1' }
        )
      ).rejects.toThrow('update lifecycle failed');

      expect(rolledBack).toBe(true);
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'opp-rollback', version: 2, deletedAt: null } })
      );
      expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledTimes(2);
    });

    it('should update in transaction with products replacement', async () => {
      const existing = buildOpportunity({ id: 'opp-1', version: 1 });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });
      mockPrisma.opportunityProduct.findMany.mockResolvedValue([
        {
          id: 'old-product',
          version: 4,
          productName: '旧产品',
          productNumber: null,
          productPrice: null,
          quantity: 1,
          unitPrice: 100,
          discount: null,
          subtotalAmount: 100,
          remark: null,
        },
      ]);
      mockPrisma.opportunityProduct.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.opportunityProduct.createMany.mockResolvedValue({ count: 2 });

      const dto = {
        opportunityName: '更新商机',
        version: 1,
        opportunityAmount: 1,
        // 行替换：服务端按行小计 Decimal 求和重算总额，忽略客户端 opportunityAmount/subtotalAmount。
        // 行1：3×4000×(1−20%) = 9600；行2：2×5000 = 10000；总额 = 19600.00。
        products: [
          { productName: '新产品', quantity: 3, unitPrice: 4000, discount: 20, subtotalAmount: 1 },
          { productName: '新产品2', quantity: 2, unitPrice: 5000, subtotalAmount: 1 },
        ],
      } as Parameters<typeof service.update>[1];

      await service.update('opp-1', dto, { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            updater: { connect: { id: 'emp-user-1' } },
            opportunityAmount: '19600.00',
          }),
        })
      );
      // 旧产品软删除
      expect(mockPrisma.opportunityProduct.updateMany).toHaveBeenCalledWith({
        where: {
          opportunityId: 'opp-1',
          deletedAt: null,
          OR: [{ id: 'old-product', version: 4 }],
        },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      // 新产品创建及完整生命周期重算都在同一 tx，且生命周期最后执行。
      expect(mockPrisma.opportunityProduct.createMany).toHaveBeenCalled();
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        [existing.customerId, existing.customerId],
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.opportunityProduct.createMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('should not touch products when products is undefined', async () => {
      const existing = buildOpportunity({ id: 'opp-1', version: 1 });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'opp-1',
        { opportunityName: '只更新名称', version: 1 } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.opportunityProduct.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.opportunityProduct.createMany).not.toHaveBeenCalled();
    });

    it('should clear all products when products is empty array', async () => {
      const existing = buildOpportunity({ id: 'opp-1', version: 1 });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [{ id: 'prod-1', productName: '钉钉专业版' }],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });
      mockPrisma.opportunityProduct.findMany.mockResolvedValue([
        {
          id: 'prod-1',
          version: 2,
          productName: '钉钉专业版',
          productNumber: null,
          productPrice: null,
          quantity: 1,
          unitPrice: 100,
          discount: null,
          subtotalAmount: 100,
          remark: null,
        },
      ]);
      mockPrisma.opportunityProduct.updateMany.mockResolvedValue({ count: 1 });

      await service.update(
        'opp-1',
        { version: 1, opportunityAmount: 8888, products: [] } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      // 旧产品软删除
      expect(mockPrisma.opportunityProduct.updateMany).toHaveBeenCalled();
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ opportunityAmount: '8888' }),
        })
      );
      // 不创建新产品
      expect(mockPrisma.opportunityProduct.createMany).not.toHaveBeenCalled();
    });

    it('does not backfill a project when an existing custom-development opportunity is only edited', async () => {
      const existing = buildOpportunity({
        id: 'opp-history',
        version: 1,
        customerId: 'cust-1',
        opportunityStage: '解决方案',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [{ productName: '定制开发' }],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });
      mockPrisma.project.findUnique.mockResolvedValue(null);

      await service.update(
        'opp-history',
        { version: 1, remark: '只改备注' } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.create).not.toHaveBeenCalled();
    });

    it('creates a project when products explicitly change from non-custom to custom development', async () => {
      const existing = buildOpportunity({
        id: 'opp-new-custom',
        version: 1,
        customerId: 'cust-1',
        chargerId: 'emp-user-1',
        opportunityStage: '解决方案',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [{ productName: '钉钉专业版' }],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });
      mockPrisma.opportunityProduct.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.opportunityProduct.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockPrisma.project.create.mockResolvedValue({ id: 'project-1' });

      await service.update(
        'opp-new-custom',
        {
          version: 1,
          products: [{ productName: '定制开发', quantity: 1, unitPrice: 1000 }],
        } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          opportunityId: 'opp-new-custom',
          status: PROJECT_STATUS.OPPORTUNITY,
        }),
      });
    });

    it('P1-15: update 切到 WON 且 caller 未传 winRate 时自动置 100', async () => {
      const existing = buildOpportunity({
        id: 'opp-1',
        version: 1,
        opportunityStage: '商务谈判',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'opp-1',
        { version: 1, opportunityStage: '赢单' } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            opportunityStage: '赢单',
            winRate: '100',
            wonSourceType: 'manual',
            wonSourceSaleOrderId: null,
            wonSourcePreviousStage: null,
            wonSourcePreviousDealDate: null,
            wonSourcePreviousWinRate: null,
          }),
        })
      );
    });

    it('does not create a project when a custom-development opportunity becomes lost', async () => {
      const existing = buildOpportunity({
        id: 'opp-lost',
        version: 1,
        customerId: 'cust-1',
        chargerId: 'emp-user-1',
        opportunityStage: '解决方案',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [{ productName: '定制开发' }],
      });
      mockPrisma.opportunity.update.mockResolvedValue({
        ...existing,
        version: 2,
        opportunityStage: '输单流失',
      });
      mockPrisma.project.findUnique.mockResolvedValue(null);

      await service.update(
        'opp-lost',
        { version: 1, opportunityStage: '输单流失', loseReason: '竞品胜出' } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.create).not.toHaveBeenCalled();
    });

    it('reactivates the opportunity-only project when a lost opportunity is explicitly reopened', async () => {
      const existing = buildOpportunity({
        id: 'opp-reopen',
        version: 1,
        customerId: 'cust-1',
        chargerId: 'emp-user-1',
        opportunityStage: '输单流失',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [{ productName: '定制开发' }],
      });
      mockPrisma.opportunity.update.mockResolvedValue({
        ...existing,
        version: 2,
        opportunityStage: '解决方案',
      });
      mockPrisma.project.findUnique
        .mockResolvedValueOnce({
          id: 'project-1',
          customerId: 'cust-1',
          opportunityId: 'opp-reopen',
          saleOrderId: null,
          status: PROJECT_STATUS.LOST,
        })
        .mockResolvedValueOnce(null);
      mockPrisma.project.update.mockResolvedValue({ id: 'project-1' });

      await service.update(
        'opp-reopen',
        { version: 1, opportunityStage: '解决方案' } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: expect.objectContaining({ status: PROJECT_STATUS.OPPORTUNITY }),
      });
    });

    it('P1-15: update 切到 WON 但 caller 显式传 winRate 时尊重 caller', async () => {
      const existing = buildOpportunity({
        id: 'opp-1',
        version: 1,
        opportunityStage: '商务谈判',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'opp-1',
        { version: 1, opportunityStage: '赢单', winRate: 80 } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ winRate: '80' }),
        })
      );
    });

    it('P1-15: update 已经是 WON 维持 WON 不重复置 winRate', async () => {
      const existing = buildOpportunity({
        id: 'opp-1',
        version: 1,
        opportunityStage: '赢单',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'opp-1',
        { version: 1, opportunityStage: '赢单' } as Parameters<typeof service.update>[1],
        { id: 'user-1', employeeId: 'emp-user-1' }
      );

      const updateCall = mockPrisma.opportunity.update.mock.calls[0]?.[0];
      const data = updateCall?.data as Record<string, unknown>;
      // 已 WON 重复 update 时不应注入 winRate（避免覆盖业务侧手填）
      expect(data).not.toHaveProperty('winRate');
    });

    it('should throw ConflictException on P2025 (version mismatch)', async () => {
      const existing = buildOpportunity({ id: 'opp-1', version: 1 });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...existing,
        customer: null,
        contact: null,
        products: [],
      });

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.opportunity.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'opp-1',
          { version: 1, opportunityName: '冲突' } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'opp-1', version: 1, deletedAt: null } })
      );
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft delete opportunity', async () => {
      const opp = buildOpportunity({ id: 'opp-1' });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...opp,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue(opp);
      mockPrisma.saleOrder.findFirst.mockResolvedValue(null);

      await service.remove(
        'opp-1',
        { id: 'user-1', employeeId: 'emp-' + 'user-1' },
        undefined,
        undefined,
        opp.version
      );

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith({
        where: { id: 'opp-1', version: opp.version, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
          updaterEmployeeId: 'emp-user-1',
        }),
      });
      expect(mockPrisma.opportunityProduct.updateMany).toHaveBeenCalledWith({
        where: { opportunityId: 'opp-1', deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          version: { increment: 1 },
          updaterEmployeeId: 'emp-user-1',
        }),
      });
      expect(mockCustomersService.refreshCustomerLifecycle).toHaveBeenCalledWith(
        opp.customerId,
        { id: 'user-1', employeeId: 'emp-user-1' },
        mockPrisma
      );
      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith({
        where: { opportunityId: 'opp-1', deletedAt: null },
        select: { serialNumber: true, orderTitle: true },
      });
      expect(mockPrisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.saleOrder.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.opportunity.update.mock.invocationCallOrder[0]!
      );
      expect(mockPrisma.opportunity.update.mock.invocationCallOrder[0]).toBeLessThan(
        mockCustomersService.refreshCustomerLifecycle.mock.invocationCallOrder[0]!
      );
    });

    it('有关联有效订单时拒绝软删，且不执行 CAS 或生命周期', async () => {
      const opp = buildOpportunity({ id: 'opp-linked-delete', version: 5 });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...opp,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.saleOrder.findFirst.mockResolvedValue({
        serialNumber: 'DD-LINKED-DELETE',
        orderTitle: null,
      });

      await expect(
        service.remove(
          'opp-linked-delete',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          5
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.saleOrder.findFirst).toHaveBeenCalledWith({
        where: { opportunityId: 'opp-linked-delete', deletedAt: null },
        select: { serialNumber: true, orderTitle: true },
      });
      expect(mockPrisma.opportunity.update).not.toHaveBeenCalled();
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('删除后的生命周期重算失败时商机软删事务整体回滚', async () => {
      const opp = buildOpportunity({ id: 'opp-rollback' });
      let rolledBack = false;
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...opp,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockResolvedValue(opp);
      mockCustomersService.refreshCustomerLifecycle.mockRejectedValue(
        new Error('remove lifecycle failed')
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
        service.remove(
          'opp-rollback',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          opp.version
        )
      ).rejects.toThrow('remove lifecycle failed');

      expect(rolledBack).toBe(true);
      expect(mockPrisma.opportunity.update).toHaveBeenCalled();
    });

    it('软删 CAS 在并发改绑后 P2025 转 409，且不使用陈旧 customerId 重算', async () => {
      const stale = buildOpportunity({
        id: 'opp-delete-race',
        version: 4,
        customerId: 'cust-a',
      });
      mockPrisma.opportunity.findFirst.mockResolvedValue({
        ...stale,
        customer: null,
        contact: null,
        products: [],
      });
      mockPrisma.opportunity.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('', {
          code: 'P2025',
          clientVersion: '0',
        })
      );

      await expect(
        service.remove(
          'opp-delete-race',
          { id: 'user-1', employeeId: 'emp-user-1' },
          undefined,
          undefined,
          4
        )
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.opportunity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'opp-delete-race', version: 4, deletedAt: null },
        })
      );
      expect(mockCustomersService.refreshCustomerLifecycle).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrisma.opportunity.findFirst.mockResolvedValue(null);

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

  describe('findAllForSelection', () => {
    it('should return simplified opportunity list', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([
        {
          id: '1',
          serialNumber: 'SJ001',
          opportunityName: '商机A',
          customer: { customerName: '客户A' },
          products: [{ productName: '产品A' }, { productName: '产品B' }],
        },
      ]);

      const result = await service.findAllForSelection({});

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('customerName', '客户A');
      expect(result[0]).toHaveProperty('productNames', ['产品A', '产品B']);
    });

    it('订单新建场景只返回尚未关联有效订单的商机', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ availableForSaleOrder: true });

      expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            AND: [{ saleOrders: { none: { deletedAt: null } } }],
          },
        })
      );
    });

    it('订单编辑场景额外保留当前订单已关联的商机', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);

      await service.findAllForSelection({
        availableForSaleOrder: true,
        currentSaleOrderId: 'so-1',
      });

      expect(mockPrisma.opportunity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            AND: [
              {
                OR: [
                  { saleOrders: { none: { deletedAt: null } } },
                  { saleOrders: { some: { id: 'so-1', deletedAt: null } } },
                ],
              },
            ],
          },
        })
      );
    });
  });

  describe('RBAC dual-path scope', () => {
    it('findAll should pass dual-path OR baseWhere when chargerScope provided', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);
      mockPrisma.opportunity.count.mockResolvedValue(0);

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
      const opp = {
        ...buildOpportunity({ id: 'opp-orphan', chargerId: 'emp-A' }),
        customer: null,
        contact: null,
        products: [],
      };
      mockPrisma.opportunity.findFirst.mockResolvedValue(opp);

      const result = await service.findOne('opp-orphan', ['emp-B']);

      expect(result.id).toBe('opp-orphan');
      expect(mockPrisma.opportunity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'opp-orphan',
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

    it('findAllForSelection should wrap chargerScope OR in AND with keyword OR', async () => {
      mockPrisma.opportunity.findMany.mockResolvedValue([]);

      await service.findAllForSelection({ keyword: '商机' }, ['emp-B']);

      const call = mockPrisma.opportunity.findMany.mock.calls[0]![0] as {
        where: { AND?: Array<Record<string, unknown>> };
      };
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
