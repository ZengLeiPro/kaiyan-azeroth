import type {
  CloudUsageMetricResponseOutput,
  CloudUsageSeriesResponseOutput,
} from '@ky-azeroth/shared/schemas/cloud-usage-metric';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { fromJsonValue } from '../../common/utils/json-type-helpers';
import {
  calculatePagination,
  serializeEntity,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { QueryCloudUsageMetricDto } from './dto/query-cloud-usage-metric.dto';
import { QueryCloudUsageSeriesDto } from './dto/query-cloud-usage-series.dto';

@Injectable()
export class CloudUsageMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: Record<string, unknown>): CloudUsageMetricResponseOutput {
    return serializeEntity<CloudUsageMetricResponseOutput>({
      ...row,
      metricDate:
        row.metricDate instanceof Date ? row.metricDate.toISOString().slice(0, 10) : row.metricDate,
      value: toDecimalNumber(row.value as Prisma.Decimal | number | null),
      meta: fromJsonValue<Record<string, unknown>>(row.meta) ?? null,
    });
  }

  async findAll(
    query: QueryCloudUsageMetricDto
  ): Promise<PaginatedResponse<CloudUsageMetricResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.CloudUsageMetricWhereInput = { deletedAt: null };
    if (query.vendor) where.vendor = query.vendor;
    if (query.productCode) where.productCode = query.productCode;
    if (query.metricName) where.metricName = query.metricName;
    if (query.instanceId) where.instanceId = query.instanceId;
    if (query.startDate || query.endDate) {
      where.metricDate = {};
      if (query.startDate)
        (where.metricDate as Prisma.DateTimeFilter).gte = new Date(query.startDate);
      if (query.endDate) (where.metricDate as Prisma.DateTimeFilter).lte = new Date(query.endDate);
    }

    const [total, items] = await Promise.all([
      this.prisma.cloudUsageMetric.count({ where }),
      this.prisma.cloudUsageMetric.findMany({
        where,
        skip,
        take,
        orderBy: [{ metricDate: 'desc' }, { productCode: 'asc' }, { metricName: 'asc' }],
      }),
    ]);

    return {
      items: items.map((item) => this.toResponse(item as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 时序聚合：按日聚合 value（sum）；同日多条同维度数据求和
   */
  async getSeries(query: QueryCloudUsageSeriesDto): Promise<CloudUsageSeriesResponseOutput> {
    const where: Prisma.CloudUsageMetricWhereInput = {
      deletedAt: null,
      vendor: query.vendor,
      productCode: query.productCode,
      metricName: query.metricName,
      metricDate: {
        gte: new Date(query.startDate),
        lte: new Date(query.endDate),
      },
    };
    if (query.instanceId) where.instanceId = query.instanceId;

    const rows = await this.prisma.cloudUsageMetric.findMany({
      where,
      orderBy: { metricDate: 'asc' },
      select: { metricDate: true, value: true, unit: true },
    });

    // 按日期聚合（同日 sum）
    const pointMap = new Map<string, number>();
    let unit: string | null = null;
    for (const row of rows) {
      const date =
        row.metricDate instanceof Date
          ? row.metricDate.toISOString().slice(0, 10)
          : String(row.metricDate);
      pointMap.set(date, (pointMap.get(date) ?? 0) + toDecimalNumber(row.value));
      if (unit === null && row.unit) unit = row.unit;
    }

    const points = [...pointMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, value]) => ({ date, value }));

    return {
      productCode: query.productCode,
      metricName: query.metricName,
      unit,
      points,
    };
  }
}
