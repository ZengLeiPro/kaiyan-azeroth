import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';

import type { FilterApplierService } from '../../../common/filter-scheme';
import { buildCrmProduct } from '../../../test/factories';
import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { CrmProductsService } from '../crm-products.service';

describe('CrmProductsService', () => {
  let service: CrmProductsService;
  let mockPrisma: MockPrismaService;
  let mockFilterApplier: { buildWhere: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    mockFilterApplier = {
      buildWhere: vi.fn().mockResolvedValue({ deletedAt: null }),
    };
    service = new CrmProductsService(
      asPrismaService(mockPrisma),
      mockFilterApplier as unknown as FilterApplierService
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a product and return it with decimal conversion', async () => {
      const product = buildCrmProduct({ createdBy: 'user-1', updatedBy: 'user-1' });
      mockPrisma.crmProduct.create.mockResolvedValue(product);

      const result = await service.create(
        { productName: '测试产品', standardPrice: 99.9 } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(result).toBeDefined();
      expect(result.productName).toBe(product.productName);
      expect(mockPrisma.crmProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productName: '测试产品',
          }),
        })
      );
    });

    it('should convert standardPrice to String when creating', async () => {
      const product = buildCrmProduct({ standardPrice: 199.5 });
      mockPrisma.crmProduct.create.mockResolvedValue(product);

      await service.create(
        { productName: '价格产品', standardPrice: 199.5 } as Parameters<typeof service.create>[0],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.crmProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            standardPrice: '199.5',
          }),
        })
      );
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return paginated products with default params', async () => {
      const products = [buildCrmProduct(), buildCrmProduct()];
      mockPrisma.crmProduct.findMany.mockResolvedValue(products);
      mockPrisma.crmProduct.count.mockResolvedValue(2);

      const result = await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      );
    });

    it('should forward keyword to FilterApplier (legacyKeyword)', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([]);
      mockPrisma.crmProduct.count.mockResolvedValue(0);

      await service.findAll({ keyword: 'ABC', page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({ legacyKeyword: 'ABC' })
      );
    });

    it('should forward productStatus to FilterApplier (legacyFilters)', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([]);
      mockPrisma.crmProduct.count.mockResolvedValue(0);

      await service.findAll({
        productStatus: ['on_sale'],
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      });

      expect(mockFilterApplier.buildWhere).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyFilters: expect.objectContaining({ productStatus: ['on_sale'] }),
        })
      );
    });

    it('should exclude soft-deleted records (deletedAt: null)', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([]);
      mockPrisma.crmProduct.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 20, sortOrder: 'desc' as const });

      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        })
      );
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return product detail', async () => {
      const product = buildCrmProduct({ id: 'prod-1' });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(product);

      const result = await service.findOne('prod-1');

      expect(result).toBeDefined();
      expect(mockPrisma.crmProduct.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: null },
      });
    });

    it('should throw NotFoundException when product does not exist', async () => {
      mockPrisma.crmProduct.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update product with optimistic lock (version check)', async () => {
      const existing = buildCrmProduct({ id: 'prod-1', version: 1 });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(existing);
      mockPrisma.crmProduct.update.mockResolvedValue({ ...existing, version: 2 });

      await service.update(
        'prod-1',
        { productName: '更新产品', version: 1, standardPrice: 250 } as Parameters<
          typeof service.update
        >[1],
        { id: 'user-1', employeeId: 'emp-' + 'user-1' }
      );

      expect(mockPrisma.crmProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-1', version: 1 },
          data: expect.objectContaining({
            productName: '更新产品',
            standardPrice: '250',
            version: { increment: 1 },
          }),
        })
      );
    });

    it('should throw ConflictException on P2025 error (optimistic lock)', async () => {
      const existing = buildCrmProduct({ id: 'prod-1', version: 1 });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(existing);

      const prismaError = new Prisma.PrismaClientKnownRequestError('', {
        code: 'P2025',
        clientVersion: '0',
      });
      mockPrisma.crmProduct.update.mockRejectedValue(prismaError);

      await expect(
        service.update(
          'prod-1',
          { productName: '冲突', version: 1 } as Parameters<typeof service.update>[1],
          { id: 'user-1', employeeId: 'emp-' + 'user-1' }
        )
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-P2025 errors', async () => {
      const existing = buildCrmProduct({ id: 'prod-1' });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(existing);
      mockPrisma.crmProduct.update.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.update('prod-1', { productName: '更新' } as Parameters<typeof service.update>[1], {
          id: 'user-1',
          employeeId: 'emp-' + 'user-1',
        })
      ).rejects.toThrow('DB connection lost');
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should soft delete by setting deletedAt', async () => {
      const product = buildCrmProduct({ id: 'prod-1' });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(product);
      mockPrisma.crmProduct.update.mockResolvedValue(product);

      await service.remove('prod-1', { id: 'user-1', employeeId: 'emp-' + 'user-1' });

      expect(mockPrisma.crmProduct.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });
  });

  // ─── findTrashed ──────────────────────────────────────────────────────

  describe('findTrashed', () => {
    it('should return paginated soft-deleted products', async () => {
      const trashedProducts = [
        buildCrmProduct({ deletedAt: new Date() }),
        buildCrmProduct({ deletedAt: new Date() }),
      ];
      mockPrisma.crmProduct.findMany.mockResolvedValue(trashedProducts);
      mockPrisma.crmProduct.count.mockResolvedValue(2);

      const result = await service.findTrashed({
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: { not: null } }),
          orderBy: { deletedAt: 'desc' },
        })
      );
    });

    it('should filter trashed products by keyword', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([]);
      mockPrisma.crmProduct.count.mockResolvedValue(0);

      await service.findTrashed({
        keyword: '产品',
        page: 1,
        pageSize: 20,
        sortOrder: 'desc' as const,
      });

      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: { not: null },
            OR: [
              { productName: { contains: '产品', mode: 'insensitive' } },
              { productNumber: { contains: '产品', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });
  });

  // ─── restore ──────────────────────────────────────────────────────────

  describe('restore', () => {
    it('should restore a soft-deleted product', async () => {
      const trashedProduct = buildCrmProduct({ id: 'prod-1', deletedAt: new Date() });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(trashedProduct);
      mockPrisma.crmProduct.update.mockResolvedValue({ ...trashedProduct, deletedAt: null });

      const result = await service.restore('prod-1', {
        id: 'user-1',
        employeeId: 'emp-' + 'user-1',
      });

      expect(result).toBeDefined();
      expect(mockPrisma.crmProduct.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: { not: null } },
      });
      expect(mockPrisma.crmProduct.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: {
          deletedAt: null,
          updaterEmployeeId: 'emp-user-1',
        },
      });
    });

    it('should throw NotFoundException when product is not in trash', async () => {
      mockPrisma.crmProduct.findFirst.mockResolvedValue(null);

      await expect(
        service.restore('non-exist', { id: 'user-1', employeeId: 'emp-' + 'user-1' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── permanentRemove ──────────────────────────────────────────────────

  describe('permanentRemove', () => {
    it('should physically delete a trashed product', async () => {
      const trashedProduct = buildCrmProduct({ id: 'prod-1', deletedAt: new Date() });
      mockPrisma.crmProduct.findFirst.mockResolvedValue(trashedProduct);
      mockPrisma.crmProduct.delete.mockResolvedValue(trashedProduct);

      await service.permanentRemove('prod-1');

      expect(mockPrisma.crmProduct.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', deletedAt: { not: null } },
      });
      expect(mockPrisma.crmProduct.delete).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
      });
    });

    it('should throw NotFoundException when product is not in trash', async () => {
      mockPrisma.crmProduct.findFirst.mockResolvedValue(null);

      await expect(service.permanentRemove('non-exist')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── findAllForSelection ──────────────────────────────────────────────

  describe('findAllForSelection', () => {
    it('should return products with selected fields for dropdown', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([
        {
          id: '1',
          productName: '产品A',
          productNumber: 'P001',
          productUnit: '个',
          standardPrice: 100,
        },
      ]);

      const result = await service.findAllForSelection();

      expect(result).toHaveLength(1);
      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
          select: {
            id: true,
            productName: true,
            productNumber: true,
            productUnit: true,
            standardPrice: true,
          },
          orderBy: { productName: 'asc' },
        })
      );
    });

    it('should filter selection by keyword', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([]);

      await service.findAllForSelection('产品A');

      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            OR: [
              { productName: { contains: '产品A', mode: 'insensitive' } },
              { productNumber: { contains: '产品A', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });

    it('should filter selection by product status', async () => {
      mockPrisma.crmProduct.findMany.mockResolvedValue([]);

      await service.findAllForSelection(undefined, 'on_sale');

      expect(mockPrisma.crmProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null, productStatus: 'on_sale' },
        })
      );
    });
  });
});
