/**
 * CRM 经营盘聚合 service（7 个端点完整实现）
 *
 * 数据源：customers / opportunities / sale_orders / payments / keep_records /
 *         order_products
 *
 * RBAC：通过 chargerScope: string[] | null 注入；
 *   - null   → ADMIN，无过滤
 *   - []     → 无可见数据（早返回空）
 *   - 非空数组 → 业绩 KPI、趋势及排行均只按业务记录自身固化的 chargerId 归因，
 *     避免客户转交后把原负责人的历史业绩计入新负责人。
 *
 * 节假日/工作日：维持 5/7 粗算（M1 决策）。
 */

import {
  CRM_RANKING_METRIC_IS_AMOUNT,
  CRM_TREND_METRIC_IS_AMOUNT,
  CUSTOMER_LEVEL,
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_RELATIONSHIP_LABELS,
  CUSTOMER_SOURCE_LABELS,
  DEAL_STATUS,
  INDUSTRY_LABELS,
  OPPORTUNITY_STAGE,
} from '@ky-azeroth/shared/constants';
import type {
  AnalyticsRangeInput,
  CrmRankingQueryInput,
  CrmTrendQueryInput,
} from '@ky-azeroth/shared/schemas';
import type {
  ICrmAgingResponse,
  ICrmDistributionResponse,
  ICrmFunnelResponse,
  ICrmKpisResponse,
  ICrmRankingResponse,
  ICrmSleepingResponse,
  ICrmTrendResponse,
  IDistributionItem,
  ITrendPoint,
} from '@ky-azeroth/shared/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveAnalyticsRange } from '../helpers/date-range.helper';
import { bucketizeTrend } from '../helpers/trend-bucket.helper';

const SLEEPING_DAYS_THRESHOLD = 90;
const DECIMAL_2 = (n: number): number => Math.round(n * 100) / 100;

/** 经营归因按单据自身 chargerId 固化，禁止受客户当前负责人流转影响。 */
const applyAttributionScope = <T extends Record<string, unknown>>(
  where: T,
  chargerScope: string[] | null
): T & { chargerId?: { in: string[] } } =>
  chargerScope === null ? where : { ...where, chargerId: { in: chargerScope } };

/** 安全把 Prisma.Decimal | null | undefined 转 number */
const dec = (v: Prisma.Decimal | number | null | undefined): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // Prisma.Decimal 有 toNumber 方法
  const t = v as { toNumber?: () => number };
  return typeof t.toNumber === 'function' ? t.toNumber() : Number(v);
};

@Injectable()
export class CrmAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== KPIs ====================

  async getKpis(
    range: AnalyticsRangeInput,
    chargerScope: string[] | null
  ): Promise<ICrmKpisResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    // 空 scope 早返回（resolveChargerScope 返回 [] 代表无任何可见）
    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return {
        range: meta,
        customerCount: 0,
        opportunityCount: 0,
        saleOrderCount: 0,
        paymentAmount: 0,
        accountsReceivableTotal: 0,
        sleepingSaCount: 0,
      };
    }

    const customerWhere = this.customerScopeWhere(chargerScope);
    const attributionWhere = (extra: Record<string, unknown>) =>
      applyAttributionScope({ ...extra, deletedAt: null }, chargerScope);

    const sleepingCutoff = new Date(startDate);
    sleepingCutoff.setDate(sleepingCutoff.getDate()); // 占位（仅为消除变量未用警告）
    const nowMinusThreshold = new Date();
    nowMinusThreshold.setDate(nowMinusThreshold.getDate() - SLEEPING_DAYS_THRESHOLD);

    const [
      customerCount,
      opportunityCount,
      saleOrderCount,
      paymentInAgg,
      paymentOutAgg,
      accountsReceivableAgg,
      sleepingSaCount,
    ] = await Promise.all([
      this.prisma.customer.count({ where: customerWhere }),
      this.prisma.opportunity.count({ where: attributionWhere({}) }),
      this.prisma.saleOrder.count({ where: attributionWhere({}) }),
      this.prisma.payment.aggregate({
        where: attributionWhere({
          flowStatus: 'approved',
          direction: 'IN',
          businessDate: { gte: startDate, lt: endDate },
        }),
        _sum: { paymentAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: attributionWhere({
          flowStatus: 'approved',
          direction: 'OUT',
          businessDate: { gte: startDate, lt: endDate },
        }),
        _sum: { paymentAmount: true },
      }),
      this.prisma.customer.aggregate({
        where: customerWhere,
        _sum: { accountsReceivable: true },
      }),
      this.prisma.customer.count({
        where: {
          ...customerWhere,
          customerLevel: { in: [CUSTOMER_LEVEL.S, CUSTOMER_LEVEL.A] },
          OR: [{ lastKeepRecordTime: null }, { lastKeepRecordTime: { lt: nowMinusThreshold } }],
          NOT: { dealStatus: { in: [DEAL_STATUS.WON, DEAL_STATUS.MULTI_WON] } },
        },
      }),
    ]);

    return {
      range: meta,
      customerCount,
      opportunityCount,
      saleOrderCount,
      paymentAmount: DECIMAL_2(
        dec(paymentInAgg._sum.paymentAmount) - dec(paymentOutAgg._sum.paymentAmount)
      ),
      accountsReceivableTotal: DECIMAL_2(dec(accountsReceivableAgg._sum.accountsReceivable)),
      sleepingSaCount,
    };
  }

  // ==================== 商机阶段漏斗 ====================

  async getFunnel(
    range: AnalyticsRangeInput,
    chargerScope: string[] | null
  ): Promise<ICrmFunnelResponse> {
    const { meta } = resolveAnalyticsRange(range);

    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return { range: meta, stages: [] };
    }

    const where = applyAttributionScope({ deletedAt: null }, chargerScope);

    const grouped = await this.prisma.opportunity.groupBy({
      by: ['opportunityStage'],
      where,
      _count: { _all: true },
      _sum: { opportunityAmount: true },
    });

    const map = new Map<string, { count: number; amount: number }>();
    for (const row of grouped) {
      const stage = row.opportunityStage ?? '未分类';
      map.set(stage, {
        count: row._count._all,
        amount: DECIMAL_2(dec(row._sum.opportunityAmount)),
      });
    }

    const orderedStages = [
      OPPORTUNITY_STAGE.DISCOVER,
      OPPORTUNITY_STAGE.SOLUTION,
      OPPORTUNITY_STAGE.NEGOTIATION,
      OPPORTUNITY_STAGE.CONTRACT,
      OPPORTUNITY_STAGE.WON,
      OPPORTUNITY_STAGE.LOST,
    ];

    const stages = orderedStages.map((stage) => {
      const v = map.get(stage) ?? { count: 0, amount: 0 };
      return { stage, count: v.count, amount: v.amount };
    });

    return { range: meta, stages };
  }

  // ==================== 趋势（5 metric × 3 bucket） ====================

  async getTrend(
    query: CrmTrendQueryInput,
    chargerScope: string[] | null
  ): Promise<ICrmTrendResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(query);

    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return { range: meta, metric: query.metric, bucket: query.bucket, points: [] };
    }

    const points = await this.computeTrendPoints(
      query.metric,
      query.bucket,
      startDate,
      endDate,
      chargerScope
    );
    return { range: meta, metric: query.metric, bucket: query.bucket, points };
  }

  private async computeTrendPoints(
    metric: CrmTrendQueryInput['metric'],
    bucket: CrmTrendQueryInput['bucket'],
    startDate: Date,
    endDate: Date,
    chargerScope: string[] | null
  ): Promise<ITrendPoint[]> {
    const isAmount = CRM_TREND_METRIC_IS_AMOUNT[metric];

    // 拉每个 metric 对应的原始时间序列（select 时间字段 + 值字段）
    if (metric === 'new_customers') {
      const rows = await this.prisma.customer.findMany({
        where: {
          ...this.customerScopeWhere(chargerScope),
          createdAt: { gte: startDate, lt: endDate },
        },
        select: { createdAt: true },
      });
      return bucketizeTrend(
        rows.map((r) => ({ at: r.createdAt, value: 1 })),
        startDate,
        endDate,
        bucket
      );
    }

    if (metric === 'new_opportunity_amount') {
      const rows = await this.prisma.opportunity.findMany({
        where: applyAttributionScope(
          { deletedAt: null, createdAt: { gte: startDate, lt: endDate } },
          chargerScope
        ),
        select: { createdAt: true, opportunityAmount: true },
      });
      return bucketizeTrend(
        rows.map((r) => ({ at: r.createdAt, value: dec(r.opportunityAmount), count: 1 })),
        startDate,
        endDate,
        bucket
      );
    }

    if (metric === 'new_order_amount') {
      const rows = await this.prisma.saleOrder.findMany({
        where: applyAttributionScope(
          { deletedAt: null, createdAt: { gte: startDate, lt: endDate } },
          chargerScope
        ),
        select: { createdAt: true, orderAmount: true },
      });
      return bucketizeTrend(
        rows.map((r) => ({ at: r.createdAt, value: dec(r.orderAmount), count: 1 })),
        startDate,
        endDate,
        bucket
      );
    }

    if (metric === 'payment_amount') {
      // 趋势口径：净回款 = SUM(IN) - SUM(OUT)。
      // 把 OUT 当作负值参与桶聚合，单条 OUT 行对单日 bucket 贡献 -paymentAmount。
      const rows = await this.prisma.payment.findMany({
        where: applyAttributionScope(
          {
            deletedAt: null,
            flowStatus: 'approved',
            businessDate: { gte: startDate, lt: endDate },
          },
          chargerScope
        ),
        select: { businessDate: true, paymentAmount: true, direction: true },
      });
      return bucketizeTrend(
        rows
          .filter(
            (r): r is { businessDate: Date; paymentAmount: Prisma.Decimal; direction: string } =>
              Boolean(r.businessDate)
          )
          .map((r) => {
            const raw = dec(r.paymentAmount);
            // direction='OUT' 取负，使净回款= sum(IN paymentAmount) - sum(OUT paymentAmount)
            const signed = r.direction === 'OUT' ? -raw : raw;
            return { at: r.businessDate, value: signed, count: 1 };
          }),
        startDate,
        endDate,
        bucket
      );
    }

    // keep_records
    const rows = await this.prisma.keepRecord.findMany({
      where: applyAttributionScope(
        { deletedAt: null, keepRecordTime: { gte: startDate, lt: endDate } },
        chargerScope
      ),
      select: { keepRecordTime: true },
    });
    return bucketizeTrend(
      rows
        .filter((r): r is { keepRecordTime: Date } => Boolean(r.keepRecordTime))
        .map((r) => ({ at: r.keepRecordTime, value: 1 })),
      startDate,
      endDate,
      bucket
    );
    void isAmount; // metric → amount 标志由前端的 metric-labels 用，不在 service 输出
  }

  // ==================== 客户分布 ====================

  async getDistribution(dimension: string): Promise<ICrmDistributionResponse> {
    // 按维度显式分支，避免动态字段名带来的 TS 类型断言泛型问题
    if (dimension === 'level') {
      const rows = await this.prisma.customer.groupBy({
        by: ['customerLevel'],
        where: { deletedAt: null, NOT: { customerLevel: null } },
        _count: { _all: true },
      });
      const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
      const items: IDistributionItem[] = rows
        .map((r) => {
          const key = r.customerLevel ?? '未分类';
          return {
            key,
            label: CUSTOMER_LEVEL_LABELS[key as 'S'] ?? key,
            count: r._count._all,
            percentage: DECIMAL_2((r._count._all / total) * 100),
          };
        })
        .sort((a, b) => b.count - a.count);
      return { dimension, items };
    }

    if (dimension === 'source') {
      const rows = await this.prisma.customer.groupBy({
        by: ['customerSource'],
        where: { deletedAt: null, NOT: { customerSource: null } },
        _count: { _all: true },
      });
      const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
      const items: IDistributionItem[] = rows
        .map((r) => {
          const key = r.customerSource ?? '未分类';
          return {
            key,
            label: CUSTOMER_SOURCE_LABELS[key as '自我开拓'] ?? key,
            count: r._count._all,
            percentage: DECIMAL_2((r._count._all / total) * 100),
          };
        })
        .sort((a, b) => b.count - a.count);
      return { dimension, items };
    }

    if (dimension === 'industry') {
      const rows = await this.prisma.customer.groupBy({
        by: ['industry'],
        where: { deletedAt: null, NOT: { industry: null } },
        _count: { _all: true },
      });
      const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
      const items: IDistributionItem[] = rows
        .map((r) => {
          const key = r.industry ?? '未分类';
          return {
            key,
            label: INDUSTRY_LABELS[key as '制造'] ?? key,
            count: r._count._all,
            percentage: DECIMAL_2((r._count._all / total) * 100),
          };
        })
        .sort((a, b) => b.count - a.count);
      return { dimension, items };
    }

    if (dimension === 'relationship') {
      const rows = await this.prisma.customer.groupBy({
        by: ['customerRelationship'],
        where: { deletedAt: null, NOT: { customerRelationship: null } },
        _count: { _all: true },
      });
      const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
      const items: IDistributionItem[] = rows
        .map((r) => {
          const key = r.customerRelationship ?? '未分类';
          return {
            key,
            label: CUSTOMER_RELATIONSHIP_LABELS[key as '合作客户'] ?? key,
            count: r._count._all,
            percentage: DECIMAL_2((r._count._all / total) * 100),
          };
        })
        .sort((a, b) => b.count - a.count);
      return { dimension, items };
    }

    return { dimension, items: [] };
  }

  // ==================== 排行榜 ====================

  async getRanking(
    query: CrmRankingQueryInput,
    chargerScope: string[] | null
  ): Promise<ICrmRankingResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(query);

    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return {
        range: meta,
        dimension: query.dimension,
        metric: query.metric,
        items: [],
      };
    }

    const items =
      query.dimension === 'salesperson'
        ? await this.rankSalespeople(query.metric, query.limit, startDate, endDate, chargerScope)
        : query.dimension === 'customer'
          ? await this.rankCustomers(query.metric, query.limit, startDate, endDate, chargerScope)
          : await this.rankProducts(query.metric, query.limit, startDate, endDate, chargerScope);

    return { range: meta, dimension: query.dimension, metric: query.metric, items };
  }

  private async rankSalespeople(
    metric: CrmRankingQueryInput['metric'],
    limit: number,
    startDate: Date,
    endDate: Date,
    chargerScope: string[] | null
  ): Promise<ICrmRankingResponse['items']> {
    const scopeIds = chargerScope ?? undefined;
    const isAmount = CRM_RANKING_METRIC_IS_AMOUNT[metric];

    if (metric === 'paid_amount') {
      // 净回款 = sum(IN) - sum(OUT)。完整聚合两个方向后合并 ID，
      // 确保 OUT-only 和负净值也参与最终排序。
      const [inGrouped, outGrouped] = await Promise.all([
        this.prisma.payment.groupBy({
          by: ['chargerId'],
          where: {
            deletedAt: null,
            flowStatus: 'approved',
            direction: 'IN',
            businessDate: { gte: startDate, lt: endDate },
            ...(scopeIds && { chargerId: { in: scopeIds } }),
          },
          _sum: { paymentAmount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['chargerId'],
          where: {
            deletedAt: null,
            flowStatus: 'approved',
            direction: 'OUT',
            businessDate: { gte: startDate, lt: endDate },
            ...(scopeIds && { chargerId: { in: scopeIds } }),
          },
          _sum: { paymentAmount: true },
        }),
      ]);
      const netByCharger = new Map<string | null, number>();
      for (const row of inGrouped) {
        netByCharger.set(row.chargerId, dec(row._sum.paymentAmount));
      }
      for (const row of outGrouped) {
        netByCharger.set(
          row.chargerId,
          (netByCharger.get(row.chargerId) ?? 0) - dec(row._sum.paymentAmount)
        );
      }
      const netRanking = Array.from(netByCharger, ([id, value]) => ({ id, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
      return this.attachEmployeeNames(netRanking);
    }

    if (metric === 'order_amount') {
      const grouped = await this.prisma.saleOrder.groupBy({
        by: ['chargerId'],
        where: {
          deletedAt: null,
          createdAt: { gte: startDate, lt: endDate },
          ...(scopeIds && { chargerId: { in: scopeIds } }),
        },
        _sum: { orderAmount: true },
        orderBy: { _sum: { orderAmount: 'desc' } },
        take: limit,
      });
      return this.attachEmployeeNames(
        grouped.map((g) => ({ id: g.chargerId, value: dec(g._sum.orderAmount) }))
      );
    }

    if (metric === 'opportunity_amount') {
      const grouped = await this.prisma.opportunity.groupBy({
        by: ['chargerId'],
        where: {
          deletedAt: null,
          createdAt: { gte: startDate, lt: endDate },
          ...(scopeIds && { chargerId: { in: scopeIds } }),
        },
        _sum: { opportunityAmount: true },
        orderBy: { _sum: { opportunityAmount: 'desc' } },
        take: limit,
      });
      return this.attachEmployeeNames(
        grouped.map((g) => ({ id: g.chargerId, value: dec(g._sum.opportunityAmount) }))
      );
    }

    // keep_records
    const grouped = await this.prisma.keepRecord.groupBy({
      by: ['chargerId'],
      where: {
        deletedAt: null,
        keepRecordTime: { gte: startDate, lt: endDate },
        ...(scopeIds && { chargerId: { in: scopeIds } }),
      },
      _count: { _all: true },
      orderBy: { _count: { chargerId: 'desc' } },
      take: limit,
    });
    void isAmount;
    return this.attachEmployeeNames(
      grouped.map((g) => ({ id: g.chargerId, value: g._count._all }))
    );
  }

  private async rankCustomers(
    metric: CrmRankingQueryInput['metric'],
    limit: number,
    startDate: Date,
    endDate: Date,
    chargerScope: string[] | null
  ): Promise<ICrmRankingResponse['items']> {
    const scopeWhere = applyAttributionScope(
      { deletedAt: null, createdAt: { gte: startDate, lt: endDate } },
      chargerScope
    );

    if (metric === 'paid_amount') {
      // Payment 排名只按业务日期归期，不能叠加 createdAt；历史导入记录的创建时间
      // 可能晚于业务日期。业绩归因仍只使用回款记录自身的固化负责人。
      const paymentScope = applyAttributionScope({ deletedAt: null }, chargerScope);
      // 净回款 = sum(IN) - sum(OUT)。完整聚合两个方向后合并 ID，
      // 确保 OUT-only 和负净值也参与最终排序。
      const [inGrouped, outGrouped] = await Promise.all([
        this.prisma.payment.groupBy({
          by: ['customerId'],
          where: {
            ...paymentScope,
            flowStatus: 'approved',
            direction: 'IN',
            businessDate: { gte: startDate, lt: endDate },
          },
          _sum: { paymentAmount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['customerId'],
          where: {
            ...paymentScope,
            flowStatus: 'approved',
            direction: 'OUT',
            businessDate: { gte: startDate, lt: endDate },
          },
          _sum: { paymentAmount: true },
        }),
      ]);
      const netByCustomer = new Map<string, number>();
      for (const row of inGrouped) {
        netByCustomer.set(row.customerId, dec(row._sum.paymentAmount));
      }
      for (const row of outGrouped) {
        netByCustomer.set(
          row.customerId,
          (netByCustomer.get(row.customerId) ?? 0) - dec(row._sum.paymentAmount)
        );
      }
      const netRanking = Array.from(netByCustomer, ([id, value]) => ({ id, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
      return this.attachCustomerNames(netRanking);
    }

    if (metric === 'order_amount') {
      const grouped = await this.prisma.saleOrder.groupBy({
        by: ['customerId'],
        where: scopeWhere,
        _sum: { orderAmount: true },
        orderBy: { _sum: { orderAmount: 'desc' } },
        take: limit,
      });
      return this.attachCustomerNames(
        grouped.map((g) => ({ id: g.customerId, value: dec(g._sum.orderAmount) }))
      );
    }

    if (metric === 'opportunity_amount') {
      const grouped = await this.prisma.opportunity.groupBy({
        by: ['customerId'],
        where: scopeWhere,
        _sum: { opportunityAmount: true },
        orderBy: { _sum: { opportunityAmount: 'desc' } },
        take: limit,
      });
      return this.attachCustomerNames(
        grouped.map((g) => ({ id: g.customerId, value: dec(g._sum.opportunityAmount) }))
      );
    }

    // keep_records
    const grouped = await this.prisma.keepRecord.groupBy({
      by: ['customerId'],
      where: {
        ...scopeWhere,
        keepRecordTime: { gte: startDate, lt: endDate },
      },
      _count: { _all: true },
      orderBy: { _count: { customerId: 'desc' } },
      take: limit,
    });
    return this.attachCustomerNames(
      grouped.map((g) => ({ id: g.customerId, value: g._count._all }))
    );
  }

  private async rankProducts(
    metric: CrmRankingQueryInput['metric'],
    limit: number,
    startDate: Date,
    endDate: Date,
    chargerScope: string[] | null
  ): Promise<ICrmRankingResponse['items']> {
    // 产品排行仅支持 order_amount 维度，其它 metric 回退到 order_amount
    if (metric === 'keep_records' || metric === 'opportunity_amount') {
      // 暂不支持，按 order 计算
    }

    // 拉 OrderProduct，按 productName 聚合 subtotalAmount，仅取 chargerScope 内订单
    const scopeWhere = applyAttributionScope(
      { deletedAt: null, createdAt: { gte: startDate, lt: endDate } },
      chargerScope
    );
    const orders = await this.prisma.saleOrder.findMany({
      where: scopeWhere,
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];

    const grouped = await this.prisma.orderProduct.groupBy({
      by: ['productName'],
      where: {
        deletedAt: null,
        saleOrderId: { in: orderIds },
      },
      _sum: { subtotalAmount: true, quantity: true },
      orderBy: { _sum: { subtotalAmount: 'desc' } },
      take: limit,
    });

    return grouped.map((g) => ({
      id: g.productName ?? '未命名',
      name: g.productName ?? '未命名',
      value: DECIMAL_2(dec(g._sum.subtotalAmount)),
      hint: `数量 ${dec(g._sum.quantity)}`,
    }));
  }

  private async attachEmployeeNames(
    rows: Array<{ id: string | null; value: number }>
  ): Promise<ICrmRankingResponse['items']> {
    const ids = rows.map((r) => r.id).filter((x): x is string => Boolean(x));
    if (ids.length === 0) {
      return rows.map((r) => ({
        id: r.id ?? '',
        name: '（未指派）',
        value: DECIMAL_2(r.value),
      }));
    }
    const emps = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const map = new Map(emps.map((e) => [e.id, e.name]));
    return rows.map((r) => ({
      id: r.id ?? '',
      name: r.id ? (map.get(r.id) ?? '（已离职）') : '（未指派）',
      value: DECIMAL_2(r.value),
    }));
  }

  private async attachCustomerNames(
    rows: Array<{ id: string; value: number }>
  ): Promise<ICrmRankingResponse['items']> {
    const ids = rows.map((r) => r.id);
    const cs = await this.prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, customerName: true, chargerName: true },
    });
    const map = new Map(cs.map((c) => [c.id, c]));
    return rows.map((r) => {
      const c = map.get(r.id);
      return {
        id: r.id,
        name: c?.customerName ?? '（未知客户）',
        value: DECIMAL_2(r.value),
        hint: c?.chargerName ? `负责人：${c.chargerName}` : undefined,
      };
    });
  }

  // ==================== 应收账款账龄 ====================

  async getAging(chargerScope: string[] | null): Promise<ICrmAgingResponse> {
    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return {
        buckets: [
          { label: '0-30 天', customerCount: 0, amount: 0 },
          { label: '31-60 天', customerCount: 0, amount: 0 },
          { label: '61-90 天', customerCount: 0, amount: 0 },
          { label: '90 天以上', customerCount: 0, amount: 0 },
        ],
        total: { customerCount: 0, amount: 0 },
      };
    }

    // 应收账龄：以 sale_orders.totalUncollected > 0 + businessDate 距 NOW() 的天数桶
    const where = applyAttributionScope(
      { deletedAt: null, totalUncollected: { gt: 0 } },
      chargerScope
    );
    const orders = await this.prisma.saleOrder.findMany({
      where,
      select: {
        customerId: true,
        totalUncollected: true,
        businessDate: true,
        orderEndDate: true,
        createdAt: true,
      },
    });

    const now = Date.now();
    const buckets = {
      '0-30 天': { customerSet: new Set<string>(), amount: 0 },
      '31-60 天': { customerSet: new Set<string>(), amount: 0 },
      '61-90 天': { customerSet: new Set<string>(), amount: 0 },
      '90 天以上': { customerSet: new Set<string>(), amount: 0 },
    };

    const allCustomers = new Set<string>();
    let totalAmount = 0;

    for (const o of orders) {
      const refDate = o.businessDate ?? o.createdAt;
      const days = Math.floor((now - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24));
      const amount = dec(o.totalUncollected);
      const label: keyof typeof buckets =
        days <= 30 ? '0-30 天' : days <= 60 ? '31-60 天' : days <= 90 ? '61-90 天' : '90 天以上';
      buckets[label].customerSet.add(o.customerId);
      buckets[label].amount += amount;
      allCustomers.add(o.customerId);
      totalAmount += amount;
    }

    return {
      buckets: (['0-30 天', '31-60 天', '61-90 天', '90 天以上'] as const).map((label) => ({
        label,
        customerCount: buckets[label].customerSet.size,
        amount: DECIMAL_2(buckets[label].amount),
      })),
      total: { customerCount: allCustomers.size, amount: DECIMAL_2(totalAmount) },
    };
  }

  // ==================== 沉睡 S+A 级客户 ====================

  async getSleeping(chargerScope: string[] | null): Promise<ICrmSleepingResponse> {
    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return { items: [], total: 0 };
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - SLEEPING_DAYS_THRESHOLD);

    const where: Prisma.CustomerWhereInput = {
      ...this.customerScopeWhere(chargerScope),
      customerLevel: { in: [CUSTOMER_LEVEL.S, CUSTOMER_LEVEL.A] },
      OR: [{ lastKeepRecordTime: null }, { lastKeepRecordTime: { lt: cutoff } }],
      NOT: { dealStatus: { in: [DEAL_STATUS.WON, DEAL_STATUS.MULTI_WON] } },
    };

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        select: {
          id: true,
          customerName: true,
          customerLevel: true,
          chargerId: true,
          chargerName: true,
          lastKeepRecordTime: true,
        },
        orderBy: [
          // null lastKeepRecordTime 排最前面（PG 默认 nulls last 升序，desc nulls first）
          { lastKeepRecordTime: 'asc' },
        ],
        take: 200,
      }),
    ]);

    const now = Date.now();
    return {
      items: items.map((c) => ({
        customerId: c.id,
        customerName: c.customerName,
        customerLevel: c.customerLevel ?? '',
        chargerId: c.chargerId,
        chargerName: c.chargerName,
        lastKeepRecordTime: c.lastKeepRecordTime?.toISOString() ?? null,
        daysSinceLastKeep: c.lastKeepRecordTime
          ? Math.floor((now - c.lastKeepRecordTime.getTime()) / (1000 * 60 * 60 * 24))
          : null,
      })),
      total,
    };
  }

  // ==================== 内部 helper ====================

  /** Customer 表自身 chargerId 单路径 scope（customer 没有"客户的客户"概念） */
  private customerScopeWhere(chargerScope: string[] | null): Prisma.CustomerWhereInput {
    if (chargerScope === null) return { deletedAt: null };
    return { deletedAt: null, chargerId: { in: chargerScope } };
  }
}
