import type { CrmProductResponseOutput } from '@ky-azeroth/shared/schemas/crm-product';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import {
  calculatePagination,
  serializeEntity,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import { CRM_PRODUCT_FILTER_REGISTRY } from './crm-products.filter-registry';
import { CreateCrmProductDto } from './dto/create-crm-product.dto';
import { QueryCrmProductDto } from './dto/query-crm-product.dto';
import { UpdateCrmProductDto } from './dto/update-crm-product.dto';

/**
 * 产品列表允许的排序字段白名单。
 * 历史：findAll 曾硬编码 createdAt desc 忽略前端 sortBy，schema 上 productName/updatedAt
 * 标了 sortable 也点不动；此处补齐白名单 + resolveOrderBy 路径。
 */
const CRM_PRODUCT_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'productName',
  'createdAt',
  'updatedAt',
]);

@Injectable()
export class CrmProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  /**
   * 创建产品
   */
  async create(
    dto: CreateCrmProductDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CrmProductResponseOutput> {
    const product = await this.prisma.crmProduct.create({
      data: {
        productName: dto.productName,
        productNumber: dto.productNumber ?? undefined,
        productTypes: dto.productTypes ?? undefined,
        productUnit: dto.productUnit ?? undefined,
        standardPrice: dto.standardPrice != null ? String(dto.standardPrice) : undefined,
        productStatus: dto.productStatus ?? undefined,
        remark: dto.remark ?? undefined,
        ...auditCreate(currentUser),
      },
    });

    const response = serializeEntity<CrmProductResponseOutput>({
      ...product,
      standardPrice: toDecimalNumber(product.standardPrice),
    });

    await this.changeLog?.logChange({
      module: 'crm-products',
      action: 'create',
      target: response.id,
      targetName: response.productName,
      currentUser,
      after: response,
    });

    return response;
  }

  /**
   * 查询产品列表
   */
  async findAll(
    query: QueryCrmProductDto,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<CrmProductResponseOutput>> {
    const { page = 1, pageSize = 20, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where = await this.filterApplier.buildWhere<Prisma.CrmProductWhereInput>({
      registry: CRM_PRODUCT_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: { productStatus: query.productStatus },
      chargerScope: null,
      baseWhere: { deletedAt: null },
    });

    const orderBy = resolveOrderBy<Prisma.CrmProductOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: CRM_PRODUCT_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [total, items] = await Promise.all([
      this.prisma.crmProduct.count({ where }),
      this.prisma.crmProduct.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
      }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<CrmProductResponseOutput>({
          ...item,
          standardPrice: toDecimalNumber(item.standardPrice),
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询产品详情
   */
  async findOne(id: string): Promise<CrmProductResponseOutput> {
    const product = await this.prisma.crmProduct.findFirst({
      where: { id, deletedAt: null },
    });

    if (!product) {
      throw new NotFoundException(`产品 ${id} 不存在`);
    }

    return serializeEntity<CrmProductResponseOutput>({
      ...product,
      standardPrice: toDecimalNumber(product.standardPrice),
    });
  }

  /**
   * 更新产品
   */
  async update(
    id: string,
    dto: UpdateCrmProductDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CrmProductResponseOutput> {
    const existing = await this.findOne(id);

    const { version: requestVersion } = dto;

    try {
      const product = await this.prisma.crmProduct.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data: {
          ...(dto.productName !== undefined && { productName: dto.productName }),
          ...(dto.productNumber !== undefined && { productNumber: dto.productNumber }),
          ...(dto.productTypes !== undefined && { productTypes: dto.productTypes }),
          ...(dto.productUnit !== undefined && { productUnit: dto.productUnit }),
          ...(dto.standardPrice !== undefined && { standardPrice: String(dto.standardPrice) }),
          ...(dto.productStatus !== undefined && { productStatus: dto.productStatus }),
          ...(dto.remark !== undefined && { remark: dto.remark }),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });

      const response = serializeEntity<CrmProductResponseOutput>({
        ...product,
        standardPrice: toDecimalNumber(product.standardPrice),
      });

      await this.changeLog?.logChange({
        module: 'crm-products',
        action: 'update',
        target: id,
        targetName: response.productName,
        currentUser,
        before: existing,
        after: response,
      });

      return response;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 删除产品（软删除）
   */
  async remove(id: string, currentUser: { id: string; employeeId?: string | null }): Promise<void> {
    const existing = await this.findOne(id);

    const deleted = await this.prisma.crmProduct.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(currentUser),
      },
    });

    await this.changeLog?.logChange({
      module: 'crm-products',
      action: 'delete',
      target: id,
      targetName: existing.productName,
      currentUser,
      before: existing,
      after: deleted,
    });
  }

  /**
   * 查询回收站产品列表（已软删除）
   */
  async findTrashed(
    query: QueryCrmProductDto
  ): Promise<PaginatedResponse<CrmProductResponseOutput>> {
    const { keyword, page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where: Prisma.CrmProductWhereInput = {
      deletedAt: { not: null },
      ...(keyword && {
        OR: [
          { productName: { contains: keyword, mode: 'insensitive' as const } },
          { productNumber: { contains: keyword, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, items] = await Promise.all([
      this.prisma.crmProduct.count({ where }),
      this.prisma.crmProduct.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { deletedAt: 'desc' },
      }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<CrmProductResponseOutput>({
          ...item,
          standardPrice: toDecimalNumber(item.standardPrice),
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 恢复软删除产品
   */
  async restore(
    id: string,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CrmProductResponseOutput> {
    const product = await this.prisma.crmProduct.findFirst({
      where: { id, deletedAt: { not: null } },
    });

    if (!product) {
      throw new NotFoundException(`产品 ${id} 不存在或未被删除`);
    }

    const restored = await this.prisma.crmProduct.update({
      where: { id },
      data: {
        deletedAt: null,
        ...auditUpdate(currentUser),
      },
    });

    const response = serializeEntity<CrmProductResponseOutput>({
      ...restored,
      standardPrice: toDecimalNumber(restored.standardPrice),
    });

    await this.changeLog?.logChange({
      module: 'crm-products',
      action: 'restore',
      target: id,
      targetName: response.productName,
      currentUser,
      before: product,
      after: response,
    });

    return response;
  }

  /**
   * 永久删除产品（物理删除）
   */
  async permanentRemove(id: string): Promise<void> {
    const product = await this.prisma.crmProduct.findFirst({
      where: { id, deletedAt: { not: null } },
    });

    if (!product) {
      throw new NotFoundException(`产品 ${id} 不存在或未被删除`);
    }

    await this.prisma.crmProduct.delete({ where: { id } });
  }

  /**
   * 查询所有产品（用于下拉框等场景）
   */
  async findAllForSelection(keyword?: string, productStatus?: string) {
    const where: Prisma.CrmProductWhereInput = {
      deletedAt: null,
      ...(productStatus && { productStatus }),
      ...(keyword && {
        OR: [
          { productName: { contains: keyword, mode: 'insensitive' as const } },
          { productNumber: { contains: keyword, mode: 'insensitive' as const } },
        ],
      }),
    };

    const products = await this.prisma.crmProduct.findMany({
      where,
      orderBy: { productName: 'asc' },
      select: {
        id: true,
        productName: true,
        productNumber: true,
        productUnit: true,
        standardPrice: true,
      },
    });

    return products.map((p) => ({
      ...p,
      standardPrice: toDecimalNumber(p.standardPrice),
    }));
  }
}
