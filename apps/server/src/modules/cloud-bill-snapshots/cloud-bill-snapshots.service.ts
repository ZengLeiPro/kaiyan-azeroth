import { CLOUD_METRIC_NAME, CLOUD_VENDOR } from '@ky-azeroth/shared/constants/cloud-cost';
import type {
  CloudBillSnapshotResponseOutput,
  CloudCostOverviewResponseOutput,
  CloudPackageProjectionOutput,
} from '@ky-azeroth/shared/schemas/cloud-bill-snapshot';
import type {
  ICloudBillProductBreakdown,
  ICloudResourcePackageSnapshot,
  ICloudSubscriptionSnapshot,
} from '@ky-azeroth/shared/types/cloud-bill-snapshot';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { fromJsonValue } from '../../common/utils/json-type-helpers';
import {
  calculatePagination,
  serializeEntity,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { QueryCloudBillSnapshotDto } from './dto/query-cloud-bill-snapshot.dto';
import { QueryCloudCostOverviewDto } from './dto/query-cloud-cost-overview.dto';
import { QueryCloudPackageProjectionDto } from './dto/query-cloud-package-projection.dto';

/**
 * productCode → 该产品最主要的「日消耗」指标 metricName 映射
 *
 * 用于资源包预测耗尽日：从近 7 日 cloudUsageMetric 取均值作为日均消耗。
 */
const PRODUCT_CODE_TO_USAGE_METRIC: Record<string, string> = {
  fc: CLOUD_METRIC_NAME.FC_CU_USAGE,
  oss: CLOUD_METRIC_NAME.OSS_STORAGE_SIZE,
  cdt: CLOUD_METRIC_NAME.CDT_TRAFFIC_OUT,
  ecs: CLOUD_METRIC_NAME.ECS_TRAFFIC_OUT,
  sls: CLOUD_METRIC_NAME.SLS_LOG_SIZE,
  bailian: CLOUD_METRIC_NAME.BAILIAN_TOKEN_INPUT,
};

@Injectable()
export class CloudBillSnapshotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 把 Prisma CloudBillSnapshot 行序列化为 API 响应（统一处理 Decimal/Date/JSON）
   */
  private toResponse(row: Record<string, unknown>): CloudBillSnapshotResponseOutput {
    return serializeEntity<CloudBillSnapshotResponseOutput>({
      ...row,
      snapshotDate:
        row.snapshotDate instanceof Date
          ? (row.snapshotDate as Date).toISOString().slice(0, 10)
          : row.snapshotDate,
      balanceAvailable:
        row.balanceAvailable == null
          ? null
          : toDecimalNumber(row.balanceAvailable as Prisma.Decimal),
      balanceCash:
        row.balanceCash == null ? null : toDecimalNumber(row.balanceCash as Prisma.Decimal),
      mtdAmount: row.mtdAmount == null ? null : toDecimalNumber(row.mtdAmount as Prisma.Decimal),
      mtdGrossAmount:
        row.mtdGrossAmount == null ? null : toDecimalNumber(row.mtdGrossAmount as Prisma.Decimal),
      productBills: fromJsonValue<ICloudBillProductBreakdown[]>(row.productBills) ?? [],
      resourcePackages: fromJsonValue<ICloudResourcePackageSnapshot[]>(row.resourcePackages) ?? [],
      subscriptions: fromJsonValue<ICloudSubscriptionSnapshot[]>(row.subscriptions) ?? [],
      rawPayload: fromJsonValue<Record<string, unknown>>(row.rawPayload) ?? null,
    });
  }

  async findAll(
    query: QueryCloudBillSnapshotDto
  ): Promise<PaginatedResponse<CloudBillSnapshotResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.CloudBillSnapshotWhereInput = { deletedAt: null };
    if (query.vendor) where.vendor = query.vendor;
    if (query.billingCycle) where.billingCycle = query.billingCycle;
    if (query.startDate || query.endDate) {
      where.snapshotDate = {};
      if (query.startDate)
        (where.snapshotDate as Prisma.DateTimeFilter).gte = new Date(query.startDate);
      if (query.endDate)
        (where.snapshotDate as Prisma.DateTimeFilter).lte = new Date(query.endDate);
    }

    const [total, items] = await Promise.all([
      this.prisma.cloudBillSnapshot.count({ where }),
      this.prisma.cloudBillSnapshot.findMany({
        where,
        skip,
        take,
        orderBy: { snapshotDate: 'desc' },
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

  async findLatest(): Promise<CloudBillSnapshotResponseOutput> {
    const latest = await this.prisma.cloudBillSnapshot.findFirst({
      where: { deletedAt: null },
      orderBy: { snapshotDate: 'desc' },
    });
    if (!latest) {
      throw new NotFoundException('暂无云账单快照');
    }
    return this.toResponse(latest as unknown as Record<string, unknown>);
  }

  async findOne(id: string): Promise<CloudBillSnapshotResponseOutput> {
    const row = await this.prisma.cloudBillSnapshot.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('云账单快照不存在');
    return this.toResponse(row as unknown as Record<string, unknown>);
  }

  /**
   * 仪表盘聚合：最新快照 + 活跃预警数 + 6 个月趋势 + 资源包健康度 + 30 天到期清单
   *
   * 查询次数：6（latest 快照、活跃预警 count、近 6 月趋势 findMany、当前快照已含 productBills/resourcePackages/subscriptions）
   */
  async getOverview(query: QueryCloudCostOverviewDto): Promise<CloudCostOverviewResponseOutput> {
    const vendor = query.vendor ?? CLOUD_VENDOR.ALIYUN;

    const latest = await this.prisma.cloudBillSnapshot.findFirst({
      where: { vendor, deletedAt: null },
      orderBy: { snapshotDate: 'desc' },
    });

    if (!latest) {
      throw new NotFoundException('暂无云账单快照');
    }

    const [activeAlertCount, recentSnapshots] = await Promise.all([
      this.prisma.cloudAlert.count({
        where: { status: 'active', deletedAt: null, vendor },
      }),
      // 取近 12 条快照，按 billingCycle 去重后取最近 6 个月（每月取最新一条）
      this.prisma.cloudBillSnapshot.findMany({
        where: { vendor, deletedAt: null },
        orderBy: { snapshotDate: 'desc' },
        take: 200,
        select: {
          billingCycle: true,
          snapshotDate: true,
          mtdAmount: true,
          mtdGrossAmount: true,
        },
      }),
    ]);

    // 按月聚合：每月取该月最新一条快照
    const monthlyMap = new Map<string, { paidAmount: number; grossAmount: number }>();
    for (const s of recentSnapshots) {
      if (monthlyMap.has(s.billingCycle)) continue;
      monthlyMap.set(s.billingCycle, {
        paidAmount: s.mtdAmount == null ? 0 : toDecimalNumber(s.mtdAmount),
        grossAmount: s.mtdGrossAmount == null ? 0 : toDecimalNumber(s.mtdGrossAmount),
      });
    }
    const monthlyTrend = [...monthlyMap.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6)
      .map(([billingCycle, v]) => ({ billingCycle, ...v }));

    // 资源包健康度：按 totalAmount 加权平均的剩余比例
    const resourcePackages =
      fromJsonValue<ICloudResourcePackageSnapshot[]>(latest.resourcePackages) ?? [];
    let weightSum = 0;
    let weightedRemaining = 0;
    for (const pkg of resourcePackages) {
      const total = Number(pkg.totalAmount);
      if (!Number.isFinite(total) || total <= 0) continue;
      const remaining = Number(pkg.remainingAmount);
      if (!Number.isFinite(remaining)) continue;
      weightSum += total;
      weightedRemaining += remaining;
    }
    const resourcePackageHealthScore =
      weightSum > 0 ? Math.max(0, Math.min(100, (weightedRemaining / weightSum) * 100)) : 0;

    // Top 5 产品
    const productBills = fromJsonValue<ICloudBillProductBreakdown[]>(latest.productBills) ?? [];
    const topProducts = [...productBills]
      .sort((a, b) => Number(b.paidAmount) - Number(a.paidAmount))
      .slice(0, 5)
      .map((p) => ({
        productCode: p.productCode,
        productName: p.productName,
        paidAmount: Number(p.paidAmount),
        grossAmount: Number(p.grossAmount),
        subscriptionType: p.subscriptionType ?? null,
      }));

    // 30 天内到期：合并资源包 + 订阅
    const now = Date.now();
    const threshold = 30 * 24 * 60 * 60 * 1000;
    const subscriptions = fromJsonValue<ICloudSubscriptionSnapshot[]>(latest.subscriptions) ?? [];

    const upcomingExpirations: CloudCostOverviewResponseOutput['upcomingExpirations'] = [];
    for (const pkg of resourcePackages) {
      if (!pkg.expiryTime) continue;
      const expiry = new Date(pkg.expiryTime).getTime();
      if (Number.isNaN(expiry)) continue;
      const diff = expiry - now;
      if (diff < 0 || diff > threshold) continue;
      upcomingExpirations.push({
        kind: 'package',
        instanceId: pkg.instanceId,
        productCode: pkg.productCode,
        expiryTime: pkg.expiryTime,
        daysLeft: Math.ceil(diff / (24 * 60 * 60 * 1000)),
        label: pkg.packageType ?? `${pkg.productCode} 资源包`,
      });
    }
    for (const sub of subscriptions) {
      if (!sub.expireTime) continue;
      const expiry = new Date(sub.expireTime).getTime();
      if (Number.isNaN(expiry)) continue;
      const diff = expiry - now;
      if (diff < 0 || diff > threshold) continue;
      upcomingExpirations.push({
        kind: 'subscription',
        instanceId: sub.instanceId,
        productCode: sub.productCode,
        expiryTime: sub.expireTime,
        daysLeft: Math.ceil(diff / (24 * 60 * 60 * 1000)),
        label: sub.productName ?? sub.productCode,
      });
    }
    upcomingExpirations.sort((a, b) => a.daysLeft - b.daysLeft);

    return {
      latestSnapshotDate:
        latest.snapshotDate instanceof Date
          ? latest.snapshotDate.toISOString().slice(0, 10)
          : String(latest.snapshotDate),
      vendor: latest.vendor as CloudCostOverviewResponseOutput['vendor'],
      balanceAvailable:
        latest.balanceAvailable == null ? null : toDecimalNumber(latest.balanceAvailable),
      mtdAmount: latest.mtdAmount == null ? null : toDecimalNumber(latest.mtdAmount),
      mtdGrossAmount: latest.mtdGrossAmount == null ? null : toDecimalNumber(latest.mtdGrossAmount),
      activeAlertCount,
      resourcePackageHealthScore,
      topProducts,
      monthlyTrend,
      upcomingExpirations,
    };
  }

  /**
   * 资源包预测耗尽日
   *
   * 思路：最新快照取 resourcePackages → 每个包按 productCode 找近 7 日 metric 均值
   *      → 估算 projectedRunoutDate = today + remaining / dailyAvg。
   */
  async getPackageProjection(
    query: QueryCloudPackageProjectionDto
  ): Promise<CloudPackageProjectionOutput[]> {
    const vendor = query.vendor ?? CLOUD_VENDOR.ALIYUN;

    const latest = await this.prisma.cloudBillSnapshot.findFirst({
      where: { vendor, deletedAt: null },
      orderBy: { snapshotDate: 'desc' },
    });
    if (!latest) return [];

    const packages = fromJsonValue<ICloudResourcePackageSnapshot[]>(latest.resourcePackages) ?? [];
    const filtered = query.productCode
      ? packages.filter((p) => p.productCode === query.productCode)
      : packages;

    if (filtered.length === 0) return [];

    // 拉取这些 productCode 近 7 日的 metric 数据，做一次性查询
    const productCodes = [...new Set(filtered.map((p) => p.productCode))];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const metrics = await this.prisma.cloudUsageMetric.findMany({
      where: {
        vendor,
        deletedAt: null,
        productCode: { in: productCodes },
        metricDate: { gte: sevenDaysAgo, lt: today },
      },
      select: {
        productCode: true,
        metricName: true,
        value: true,
        metricDate: true,
      },
    });

    // 聚合 productCode → 7 日总消耗
    const usageByProduct = new Map<string, number>();
    for (const m of metrics) {
      const expectedMetric = PRODUCT_CODE_TO_USAGE_METRIC[m.productCode];
      if (!expectedMetric || m.metricName !== expectedMetric) continue;
      const v = toDecimalNumber(m.value);
      usageByProduct.set(m.productCode, (usageByProduct.get(m.productCode) ?? 0) + v);
    }

    return filtered.map<CloudPackageProjectionOutput>((pkg) => {
      const total7d = usageByProduct.get(pkg.productCode) ?? 0;
      const recentDailyAvg = total7d / 7;
      const remaining = Number(pkg.remainingAmount);

      let projectedRunoutDate: string | null = null;
      let runoutSurplusDays: number | null = null;

      if (recentDailyAvg > 0 && Number.isFinite(remaining) && remaining > 0) {
        const daysToRunout = remaining / recentDailyAvg;
        const runoutMs = today.getTime() + daysToRunout * 24 * 60 * 60 * 1000;
        projectedRunoutDate = new Date(runoutMs).toISOString().slice(0, 10);

        if (pkg.expiryTime) {
          const expiry = new Date(pkg.expiryTime).getTime();
          if (!Number.isNaN(expiry)) {
            runoutSurplusDays = Math.round((expiry - runoutMs) / (24 * 60 * 60 * 1000));
          }
        }
      }

      return {
        instanceId: pkg.instanceId,
        productCode: pkg.productCode,
        packageType: pkg.packageType ?? null,
        region: pkg.region ?? null,
        totalAmount: Number(pkg.totalAmount),
        remainingAmount: remaining,
        unit: pkg.unit ?? null,
        recentDailyAvg,
        projectedRunoutDate,
        expiryTime: pkg.expiryTime ?? null,
        runoutSurplusDays,
        applicableProducts: pkg.applicableProducts ?? null,
        status: pkg.status ?? null,
        remark: pkg.remark ?? null,
      };
    });
  }
}
