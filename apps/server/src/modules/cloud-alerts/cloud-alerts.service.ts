import type { CloudAlertResponseOutput } from '@ky-azeroth/shared/schemas/cloud-alert';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { fromJsonValue } from '../../common/utils/json-type-helpers';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { QueryCloudAlertDto } from './dto/query-cloud-alert.dto';
import { UpdateCloudAlertDto } from './dto/update-cloud-alert.dto';

@Injectable()
export class CloudAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: Record<string, unknown>): CloudAlertResponseOutput {
    return serializeEntity<CloudAlertResponseOutput>({
      ...row,
      payload: fromJsonValue<Record<string, unknown>>(row.payload) ?? null,
    });
  }

  async findAll(query: QueryCloudAlertDto): Promise<PaginatedResponse<CloudAlertResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.CloudAlertWhereInput = { deletedAt: null };
    if (query.vendor) where.vendor = query.vendor;
    if (query.level) where.level = query.level;
    if (query.category) where.category = query.category;
    if (query.status) where.status = query.status;
    if (query.startDate || query.endDate) {
      where.triggeredAt = {};
      if (query.startDate)
        (where.triggeredAt as Prisma.DateTimeFilter).gte = new Date(query.startDate);
      if (query.endDate) (where.triggeredAt as Prisma.DateTimeFilter).lte = new Date(query.endDate);
    }

    const [total, items] = await Promise.all([
      this.prisma.cloudAlert.count({ where }),
      this.prisma.cloudAlert.findMany({
        where,
        skip,
        take,
        orderBy: { triggeredAt: 'desc' },
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

  async findOne(id: string): Promise<CloudAlertResponseOutput> {
    const row = await this.prisma.cloudAlert.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('云预警事件不存在');
    return this.toResponse(row as unknown as Record<string, unknown>);
  }

  /**
   * 处理预警（resolve / dismiss），带乐观锁
   */
  async update(
    id: string,
    dto: UpdateCloudAlertDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CloudAlertResponseOutput> {
    const employeeId = currentUser.employeeId ?? currentUser.id ?? null;

    const existing = await this.prisma.cloudAlert.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, version: true, status: true },
    });
    if (!existing) throw new NotFoundException('云预警事件不存在');

    const { version: requestVersion, status, resolutionNote } = dto;

    const data: Prisma.CloudAlertUpdateInput = {
      ...(status !== undefined ? { status } : {}),
      ...(resolutionNote !== undefined ? { resolutionNote: resolutionNote ?? null } : {}),
      resolvedAt: new Date(),
      resolvedBy: employeeId,
      updatedBy: employeeId,
      version: { increment: 1 },
    };

    try {
      const row = await this.prisma.cloudAlert.update({
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
      throw e;
    }
  }
}
