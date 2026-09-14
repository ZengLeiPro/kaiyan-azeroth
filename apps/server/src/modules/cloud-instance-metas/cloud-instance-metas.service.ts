import type { CloudInstanceMetaResponseOutput } from '@ky-azeroth/shared/schemas/cloud-instance-meta';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { CreateCloudInstanceMetaDto } from './dto/create-cloud-instance-meta.dto';
import { QueryCloudInstanceMetaDto } from './dto/query-cloud-instance-meta.dto';
import { UpdateCloudInstanceMetaDto } from './dto/update-cloud-instance-meta.dto';

@Injectable()
export class CloudInstanceMetasService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: Record<string, unknown>): CloudInstanceMetaResponseOutput {
    return serializeEntity<CloudInstanceMetaResponseOutput>(row);
  }

  async findAll(
    query: QueryCloudInstanceMetaDto
  ): Promise<PaginatedResponse<CloudInstanceMetaResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.CloudInstanceMetaWhereInput = { deletedAt: null };
    if (query.vendor) where.vendor = query.vendor;
    if (query.productCode) where.productCode = query.productCode;
    if (query.ownerCategory) where.ownerCategory = query.ownerCategory;
    if (query.renewalIntent) where.renewalIntent = query.renewalIntent;
    if (query.archived !== undefined) where.archived = query.archived;
    if (query.keyword) {
      where.OR = [
        { instanceId: { contains: query.keyword, mode: 'insensitive' } },
        { alias: { contains: query.keyword, mode: 'insensitive' } },
        { ownerName: { contains: query.keyword, mode: 'insensitive' } },
        { purpose: { contains: query.keyword, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.cloudInstanceMeta.count({ where }),
      this.prisma.cloudInstanceMeta.findMany({
        where,
        skip,
        take,
        orderBy: [{ updatedAt: 'desc' }],
      }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item as unknown as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<CloudInstanceMetaResponseOutput> {
    const row = await this.prisma.cloudInstanceMeta.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('云实例元数据不存在');
    return this.toResponse(row as unknown as Record<string, unknown>);
  }

  async create(
    dto: CreateCloudInstanceMetaDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CloudInstanceMetaResponseOutput> {
    const employeeId = currentUser.employeeId ?? currentUser.id ?? null;

    // 复合 unique 约束 (vendor, productCode, instanceId) 命中已存在记录时 → 409
    const existing = await this.prisma.cloudInstanceMeta.findFirst({
      where: {
        vendor: dto.vendor ?? 'aliyun',
        productCode: dto.productCode,
        instanceId: dto.instanceId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        `实例元数据已存在（vendor=${dto.vendor ?? 'aliyun'} productCode=${dto.productCode} instanceId=${dto.instanceId}）`
      );
    }

    try {
      const row = await this.prisma.cloudInstanceMeta.create({
        data: {
          vendor: dto.vendor ?? 'aliyun',
          productCode: dto.productCode,
          instanceId: dto.instanceId,
          alias: dto.alias ?? null,
          purpose: dto.purpose ?? null,
          ownerCategory: dto.ownerCategory ?? null,
          ownerName: dto.ownerName ?? null,
          renewalIntent: dto.renewalIntent ?? null,
          notes: dto.notes ?? null,
          archived: dto.archived ?? false,
          createdBy: employeeId,
          updatedBy: employeeId,
        },
      });
      return this.toResponse(row as unknown as Record<string, unknown>);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('实例元数据已存在');
      }
      throw e;
    }
  }

  async update(
    id: string,
    dto: UpdateCloudInstanceMetaDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CloudInstanceMetaResponseOutput> {
    const employeeId = currentUser.employeeId ?? currentUser.id ?? null;

    const existing = await this.prisma.cloudInstanceMeta.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, version: true },
    });
    if (!existing) throw new NotFoundException('云实例元数据不存在');

    const { version: requestVersion, ...rest } = dto;

    const data: Prisma.CloudInstanceMetaUpdateInput = {
      ...(rest.vendor !== undefined ? { vendor: rest.vendor } : {}),
      ...(rest.productCode !== undefined ? { productCode: rest.productCode } : {}),
      ...(rest.instanceId !== undefined ? { instanceId: rest.instanceId } : {}),
      ...(rest.alias !== undefined ? { alias: rest.alias ?? null } : {}),
      ...(rest.purpose !== undefined ? { purpose: rest.purpose ?? null } : {}),
      ...(rest.ownerCategory !== undefined ? { ownerCategory: rest.ownerCategory ?? null } : {}),
      ...(rest.ownerName !== undefined ? { ownerName: rest.ownerName ?? null } : {}),
      ...(rest.renewalIntent !== undefined ? { renewalIntent: rest.renewalIntent ?? null } : {}),
      ...(rest.notes !== undefined ? { notes: rest.notes ?? null } : {}),
      ...(rest.archived !== undefined ? { archived: rest.archived } : {}),
      updatedBy: employeeId,
      version: { increment: 1 },
    };

    try {
      const row = await this.prisma.cloudInstanceMeta.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data,
      });
      return this.toResponse(row as unknown as Record<string, unknown>);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('实例元数据 (vendor, productCode, instanceId) 已存在');
      }
      throw e;
    }
  }

  async remove(id: string, currentUser: { id: string; employeeId?: string | null }): Promise<void> {
    const employeeId = currentUser.employeeId ?? currentUser.id ?? null;
    const existing = await this.prisma.cloudInstanceMeta.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('云实例元数据不存在');

    await this.prisma.cloudInstanceMeta.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedBy: employeeId,
      },
    });
  }
}
