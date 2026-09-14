import { SEO_PAGE_INSIGHT_SITE_AGGREGATE } from '@ky-azeroth/shared/schemas';
import type {
  ISeoPageInsightResponse,
  ISeoSearchQueryResponse,
  ISeoSearchRankingResponse,
  ISeoSearchTrendResponse,
  ISeoSiteSummaryResponse,
  ISeoSummaryResponse,
  ISeoSyncRun,
  ISeoSyncRunCounts,
  ISeoSyncRunError,
  ISeoSyncRunResponse,
  ISeoTrafficSnapshotResponse,
  ISeoTrafficSourceBreakdown,
} from '@ky-azeroth/shared/types';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { fromJsonValue } from '../../common/utils/json-type-helpers';
import {
  calculatePagination,
  serializeEntity,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import {
  QuerySeoPageInsightDto,
  QuerySeoSearchQueryDto,
  QuerySeoSearchRankingDto,
  QuerySeoSearchTrendDto,
  QuerySeoSiteSummaryDto,
  QuerySeoSummaryDto,
  QuerySeoSyncRunDto,
  QuerySeoTrafficSnapshotDto,
} from './dto';
import { buildBeijingDateRangeFilter, prismaDateToBeijingString } from './seo-date.helper';

/**
 * SEO 监测只读服务
 *
 * 数据由 FC 子应用 `apps/seo-sync` 每日 09:00（北京时间）写入；
 * 本服务仅负责读取与序列化（Date / Decimal / Json → API 安全类型）。
 *
 * 设计要点：
 * - **明细端点**（findXxx）返回分页原始行，列表请求统一 `select` 排除大体积 `rawPayload`/`report`，
 *   减少 dashboard 首屏带宽 + 收敛敏感信息暴露面；如需调试原始数据走详情端点。
 * - **聚合端点**（getSummary / getSearchTrend / getSearchRanking / getSiteSummary）
 *   把 KPI / 趋势 / Top N 全部下推到 Prisma 层 groupBy/aggregate，避免前端拿分页明细
 *   再聚合导致 pageSize 截尾失真。
 * - **时区**：sync 侧 `+08:00 0:00` 写入触发 PG @db.Date 存为北京日 -1d；本服务通过
 *   `seo-date.helper` 在 where 构造与读出展示两侧统一校正，对外完全按北京日呈现。
 */

// ---------- 聚合端点响应类型（来源唯一：packages/shared/src/types/seo-aggregate.ts） ----------

export type SeoSummaryResponse = ISeoSummaryResponse;
export type SeoSearchTrendResponse = ISeoSearchTrendResponse;
export type SeoSearchRankingResponse = ISeoSearchRankingResponse;
export type SeoSiteSummaryResponse = ISeoSiteSummaryResponse;

/** 搜索平台关键词列表对外字段 select（排除 rawPayload） */
const SEARCH_QUERY_SELECT = {
  id: true,
  source: true,
  siteUrl: true,
  statDate: true,
  query: true,
  clicks: true,
  impressions: true,
  avgPosition: true,
  ctr: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.SeoSearchQuerySelect;

/** Clarity 页面级洞察列表对外字段 select（排除 rawPayload） */
const PAGE_INSIGHT_SELECT = {
  id: true,
  source: true,
  siteUrl: true,
  statDate: true,
  pageUrl: true,
  sessions: true,
  uniqueUsers: true,
  pageViews: true,
  avgEngagementMs: true,
  scrollDepthAvg: true,
  deadClicks: true,
  rageClicks: true,
  quickbacks: true,
  excessiveScroll: true,
  jsErrors: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.SeoPageInsightSelect;

/** 百度统计整站快照列表 select（排除 rawPayload） */
const TRAFFIC_SNAPSHOT_SELECT = {
  id: true,
  source: true,
  siteUrl: true,
  statDate: true,
  pv: true,
  uv: true,
  ip: true,
  visitCount: true,
  newVisitor: true,
  bounceRate: true,
  avgVisitTime: true,
  avgVisitPages: true,
  sourceBreakdown: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.SeoTrafficSnapshotSelect;

/** SyncRun 列表 select（排除 report 大对象） */
const SYNC_RUN_LIST_SELECT = {
  id: true,
  triggerSource: true,
  status: true,
  startedAt: true,
  finishedAt: true,
  elapsedMs: true,
  counts: true,
  errors: true,
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.SeoSyncRunSelect;

/** POST /seo/sync-runs/trigger —— 手动触发同步返回结构 */
export interface SeoManualSyncResult {
  /** 搜索平台 + Clarity 写入条数合计（与 ManualSyncButton 约定字段一致） */
  count: number;
  /** FC 端 elapsedMs（不含 NestJS→FC 网络耗时） */
  durationMs: number;
  /** FC 报告原文（前端不依赖具体形状，留作 toast 文案/调试用） */
  bingWritten: number;
  googleWritten: number;
  clarityWritten: number;
  errorCount: number;
}

/** FC seo-sync handler 通过运行时 guard 后的报告字段。 */
interface ValidatedSeoSyncFcReport {
  bingWritten: number;
  googleWritten: number;
  clarityWritten: number;
  errorCount: number;
  elapsedMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invalidFcResponse(httpStatus: number, reason: string): never {
  throw new BadGatewayException(`SEO 同步 FC 响应契约无效（HTTP ${httpStatus}）：${reason}`);
}

function readWrittenCount(
  report: Record<string, unknown>,
  source: 'bing' | 'google' | 'clarity',
  httpStatus: number
): number {
  const sourceReport = report[source];
  // FC 在来源未配置或该来源失败时会返回 null；只有这种显式 null 可按 0 条处理。
  if (sourceReport === null) return 0;
  if (!isRecord(sourceReport) || !isNonNegativeSafeInteger(sourceReport.written)) {
    return invalidFcResponse(httpStatus, `report.${source}.written 必须是非负安全整数`);
  }
  return sourceReport.written;
}

/**
 * 对 FC 的 JSON body 做显式运行时校验，不能用 TypeScript cast 代替边界校验。
 * 200 表示完整成功；207 表示明确的部分失败（success=false 且 errors 非空）。
 */
function validateFcResponse(payload: unknown, httpStatus: 200 | 207): ValidatedSeoSyncFcReport {
  if (!isRecord(payload)) {
    return invalidFcResponse(httpStatus, '响应 body 必须是 JSON 对象');
  }

  const expectedSuccess = httpStatus === 200;
  if (payload.success !== expectedSuccess) {
    return invalidFcResponse(httpStatus, `success 必须为 ${String(expectedSuccess)}`);
  }
  if (!isRecord(payload.report)) {
    return invalidFcResponse(httpStatus, '缺少合法 report 对象');
  }

  const report = payload.report;
  const bingWritten = readWrittenCount(report, 'bing', httpStatus);
  const googleWritten = readWrittenCount(report, 'google', httpStatus);
  const clarityWritten = readWrittenCount(report, 'clarity', httpStatus);

  if (!isNonNegativeSafeInteger(report.elapsedMs)) {
    return invalidFcResponse(httpStatus, 'report.elapsedMs 必须是非负安全整数');
  }
  if (
    !Array.isArray(report.errors) ||
    !report.errors.every(
      (error) =>
        isRecord(error) &&
        typeof error.source === 'string' &&
        typeof error.stage === 'string' &&
        typeof error.message === 'string'
    )
  ) {
    return invalidFcResponse(httpStatus, 'report.errors 结构无效');
  }
  if (httpStatus === 200 && report.errors.length > 0) {
    return invalidFcResponse(httpStatus, '完整成功不得包含 report.errors');
  }
  if (httpStatus === 207 && report.errors.length === 0) {
    return invalidFcResponse(httpStatus, '部分失败必须包含非空 report.errors');
  }

  const count = bingWritten + googleWritten + clarityWritten;
  if (!Number.isSafeInteger(count)) {
    return invalidFcResponse(httpStatus, '写入总数超出安全整数范围');
  }

  return {
    bingWritten,
    googleWritten,
    clarityWritten,
    errorCount: report.errors.length,
    elapsedMs: report.elapsedMs,
  };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

@Injectable()
export class SeoMonitorService {
  private readonly logger = new Logger(SeoMonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  // ---------- toResponse helpers ----------

  private toSearchQueryResponse(row: Record<string, unknown>): ISeoSearchQueryResponse {
    return serializeEntity<ISeoSearchQueryResponse>({
      ...row,
      statDate: prismaDateToBeijingString(row.statDate as Date | null),
      avgPosition:
        row.avgPosition == null ? null : toDecimalNumber(row.avgPosition as Prisma.Decimal),
      ctr: row.ctr == null ? null : toDecimalNumber(row.ctr as Prisma.Decimal),
      rawPayload:
        row.rawPayload === undefined
          ? undefined
          : (fromJsonValue<Record<string, unknown>>(row.rawPayload) ?? null),
    });
  }

  private toPageInsightResponse(row: Record<string, unknown>): ISeoPageInsightResponse {
    return serializeEntity<ISeoPageInsightResponse>({
      ...row,
      statDate: prismaDateToBeijingString(row.statDate as Date | null),
      rawPayload:
        row.rawPayload === undefined
          ? undefined
          : (fromJsonValue<Record<string, unknown>>(row.rawPayload) ?? null),
    });
  }

  private toTrafficSnapshotResponse(row: Record<string, unknown>): ISeoTrafficSnapshotResponse {
    return serializeEntity<ISeoTrafficSnapshotResponse>({
      ...row,
      statDate: prismaDateToBeijingString(row.statDate as Date | null),
      bounceRate: row.bounceRate == null ? null : toDecimalNumber(row.bounceRate as Prisma.Decimal),
      avgVisitPages:
        row.avgVisitPages == null ? null : toDecimalNumber(row.avgVisitPages as Prisma.Decimal),
      sourceBreakdown: fromJsonValue<ISeoTrafficSourceBreakdown[]>(row.sourceBreakdown) ?? [],
      rawPayload:
        row.rawPayload === undefined
          ? undefined
          : (fromJsonValue<Record<string, unknown>>(row.rawPayload) ?? null),
    });
  }

  private toSyncRunResponse(row: Record<string, unknown>): ISeoSyncRunResponse {
    const counts = fromJsonValue<ISeoSyncRunCounts>(row.counts) ?? {};
    const errors = fromJsonValue<ISeoSyncRunError[]>(row.errors) ?? [];
    return serializeEntity<ISeoSyncRunResponse>({
      ...row,
      counts,
      errors,
      report:
        row.report === undefined
          ? undefined
          : (fromJsonValue<Record<string, unknown>>(row.report) ?? null),
    });
  }

  // ---------- search queries (明细) ----------

  async findSearchQueries(
    query: QuerySeoSearchQueryDto
  ): Promise<PaginatedResponse<ISeoSearchQueryResponse>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.SeoSearchQueryWhereInput = { deletedAt: null };
    if (query.siteUrl) where.siteUrl = query.siteUrl;
    if (query.source) where.source = query.source;
    if (query.keyword) where.query = { contains: query.keyword };
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);
    if (dateFilter) where.statDate = dateFilter;

    const [total, items] = await Promise.all([
      this.prisma.seoSearchQuery.count({ where }),
      this.prisma.seoSearchQuery.findMany({
        where,
        select: SEARCH_QUERY_SELECT,
        skip,
        take,
        orderBy: [{ statDate: 'desc' }, { impressions: 'desc' }],
      }),
    ]);

    return {
      items: items.map((item) => this.toSearchQueryResponse(item as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------- page insights (明细) ----------

  async findPageInsights(
    query: QuerySeoPageInsightDto
  ): Promise<PaginatedResponse<ISeoPageInsightResponse>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.SeoPageInsightWhereInput = { deletedAt: null };
    if (query.siteUrl) where.siteUrl = query.siteUrl;
    if (query.source) where.source = query.source;
    if (query.pageUrl) where.pageUrl = query.pageUrl;
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);
    if (dateFilter) where.statDate = dateFilter;

    const [total, items] = await Promise.all([
      this.prisma.seoPageInsight.count({ where }),
      this.prisma.seoPageInsight.findMany({
        where,
        select: PAGE_INSIGHT_SELECT,
        skip,
        take,
        orderBy: [{ statDate: 'desc' }, { sessions: 'desc' }],
      }),
    ]);

    return {
      items: items.map((item) => this.toPageInsightResponse(item as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------- traffic snapshots (明细) ----------

  async findTrafficSnapshots(
    query: QuerySeoTrafficSnapshotDto
  ): Promise<PaginatedResponse<ISeoTrafficSnapshotResponse>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.SeoTrafficSnapshotWhereInput = { deletedAt: null };
    if (query.siteUrl) where.siteUrl = query.siteUrl;
    if (query.source) where.source = query.source;
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);
    if (dateFilter) where.statDate = dateFilter;

    const [total, items] = await Promise.all([
      this.prisma.seoTrafficSnapshot.count({ where }),
      this.prisma.seoTrafficSnapshot.findMany({
        where,
        select: TRAFFIC_SNAPSHOT_SELECT,
        skip,
        take,
        orderBy: { statDate: 'desc' },
      }),
    ]);

    return {
      items: items.map((item) => this.toTrafficSnapshotResponse(item as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------- sync runs (明细 + 详情 + latest) ----------

  async findSyncRuns(query: QuerySeoSyncRunDto): Promise<PaginatedResponse<ISeoSyncRunResponse>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.SeoSyncRunWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.triggerSource) where.triggerSource = query.triggerSource;
    if (query.startedAtFrom || query.startedAtTo) {
      where.startedAt = {};
      if (query.startedAtFrom)
        (where.startedAt as Prisma.DateTimeFilter).gte = new Date(query.startedAtFrom);
      if (query.startedAtTo)
        (where.startedAt as Prisma.DateTimeFilter).lte = new Date(query.startedAtTo);
    }

    const [total, items] = await Promise.all([
      this.prisma.seoSyncRun.count({ where }),
      this.prisma.seoSyncRun.findMany({
        where,
        select: SYNC_RUN_LIST_SELECT,
        skip,
        take,
        orderBy: { startedAt: 'desc' },
      }),
    ]);

    return {
      items: items.map((item) => this.toSyncRunResponse(item as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 取最新一次同步记录（看板顶部「上次同步：X 秒前」用）。
   * 列表 select 排除 report，避免顶部 banner 每次都拉完整调试报告。
   */
  async findLatestSyncRun(): Promise<ISeoSyncRun | null> {
    const latest = await this.prisma.seoSyncRun.findFirst({
      where: { deletedAt: null },
      select: SYNC_RUN_LIST_SELECT,
      orderBy: { startedAt: 'desc' },
    });
    if (!latest) return null;
    return this.toSyncRunResponse(latest as unknown as Record<string, unknown>);
  }

  /**
   * 同步任务详情（含完整 report JSON），用于 SyncLogs 页面点击行后弹 dialog 展示。
   */
  async findSyncRunById(id: string): Promise<ISeoSyncRunResponse> {
    const row = await this.prisma.seoSyncRun.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`SeoSyncRun ${id} 不存在`);
    return this.toSyncRunResponse(row as unknown as Record<string, unknown>);
  }

  // ---------- by-id (CLI 自动派生 GET /:id 的承接端点) ----------
  //
  // 与 list 视图（findSearchQueries 等）的关键差异：**不传 select**，让
  // findFirst 返回全字段（含 rawPayload）。by-id 是 CLI / agent 想拿原始
  // 调试 payload 的主入口，list 排除 rawPayload 减带宽是另一回事。
  // 与 findSyncRunById（上方）风格保持一致。

  async findSearchQueryById(id: string): Promise<ISeoSearchQueryResponse> {
    const row = await this.prisma.seoSearchQuery.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`SeoSearchQuery ${id} 不存在`);
    return this.toSearchQueryResponse(row as unknown as Record<string, unknown>);
  }

  async findPageInsightById(id: string): Promise<ISeoPageInsightResponse> {
    const row = await this.prisma.seoPageInsight.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`SeoPageInsight ${id} 不存在`);
    return this.toPageInsightResponse(row as unknown as Record<string, unknown>);
  }

  async findTrafficSnapshotById(id: string): Promise<ISeoTrafficSnapshotResponse> {
    const row = await this.prisma.seoTrafficSnapshot.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException(`SeoTrafficSnapshot ${id} 不存在`);
    return this.toTrafficSnapshotResponse(row as unknown as Record<string, unknown>);
  }

  // ---------- 聚合端点 ----------

  /** 搜索平台权威 KPI + Clarity 行为 KPI。Google 总量读取 site 维度，避免 query 匿名化少算。 */
  async getSummary(query: QuerySeoSummaryDto): Promise<SeoSummaryResponse> {
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);
    const keywordWhere: Prisma.SeoSearchQueryWhereInput = { deletedAt: null };
    if (query.source) keywordWhere.source = query.source;
    if (dateFilter) keywordWhere.statDate = dateFilter;

    const includeGoogle = !query.source || query.source === 'google';
    const includeOtherSources = query.source !== 'google';
    const otherSearchWhere: Prisma.SeoSearchQueryWhereInput = {
      deletedAt: null,
      source: query.source ?? { not: 'google' },
    };
    if (dateFilter) otherSearchWhere.statDate = dateFilter;

    const googleWhere: Prisma.SeoSearchPerformanceWhereInput = {
      deletedAt: null,
      source: 'google',
      dimension: 'site',
      dimensionValue: '__SITE__',
    };
    if (dateFilter) googleWhere.statDate = dateFilter;

    const clarityWhere: Prisma.SeoPageInsightWhereInput = {
      deletedAt: null,
      pageUrl: SEO_PAGE_INSIGHT_SITE_AGGREGATE,
    };
    if (dateFilter) clarityWhere.statDate = dateFilter;

    const [
      searchDistinct,
      otherAgg,
      otherSourceAggs,
      otherPositionRows,
      googleRows,
      claritySiteAgg,
      claritySiteCount,
    ] = await Promise.all([
      this.prisma.seoSearchQuery.findMany({
        where: keywordWhere,
        select: { source: true, query: true },
        distinct: ['source', 'query'],
      }),
      includeOtherSources
        ? this.prisma.seoSearchQuery.aggregate({
            where: otherSearchWhere,
            _sum: { impressions: true, clicks: true },
          })
        : Promise.resolve({ _sum: { impressions: 0, clicks: 0 } }),
      includeOtherSources
        ? this.prisma.seoSearchQuery.groupBy({
            by: ['source'],
            where: otherSearchWhere,
            _sum: { impressions: true, clicks: true },
            orderBy: { source: 'asc' },
          })
        : Promise.resolve([]),
      includeOtherSources
        ? this.prisma.seoSearchQuery.groupBy({
            by: ['source', 'query'],
            where: {
              ...otherSearchWhere,
              avgPosition: { not: null },
              impressions: { gt: 0 },
            },
            _sum: { impressions: true },
            _avg: { avgPosition: true },
          })
        : Promise.resolve([]),
      includeGoogle
        ? this.prisma.seoSearchPerformance.findMany({
            where: googleWhere,
            select: { source: true, impressions: true, clicks: true, avgPosition: true },
          })
        : Promise.resolve([]),
      this.prisma.seoPageInsight.aggregate({
        where: clarityWhere,
        _sum: { sessions: true, pageViews: true, jsErrors: true, rageClicks: true },
      }),
      this.prisma.seoPageInsight.count({ where: clarityWhere }),
    ]);

    let posWeight = 0;
    let posWeighted = 0;
    for (const r of otherPositionRows) {
      const w = r._sum.impressions ?? 0;
      const p = r._avg.avgPosition ? toDecimalNumber(r._avg.avgPosition) : null;
      if (p == null || w <= 0) continue;
      posWeight += w;
      posWeighted += p * w;
    }
    for (const row of googleRows) {
      const w = row.impressions ?? 0;
      const p = row.avgPosition ? toDecimalNumber(row.avgPosition) : null;
      if (p == null || w <= 0) continue;
      posWeight += w;
      posWeighted += p * w;
    }
    const avgPosition = posWeight > 0 ? posWeighted / posWeight : null;

    const googleImpressions = googleRows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);
    const googleClicks = googleRows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
    const totalImpressions = (otherAgg._sum.impressions ?? 0) + googleImpressions;
    const totalClicks = (otherAgg._sum.clicks ?? 0) + googleClicks;
    const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : null;
    const keywordCountBySource = new Map<string, number>();
    for (const row of searchDistinct) {
      keywordCountBySource.set(row.source, (keywordCountBySource.get(row.source) ?? 0) + 1);
    }

    return {
      range: { startDate: query.startDate, endDate: query.endDate },
      search: {
        totalImpressions,
        totalClicks,
        avgCtr,
        avgPosition,
        keywordCount: new Set(searchDistinct.map((row) => row.query)).size,
      },
      searchSources: [
        ...otherSourceAggs.map((row) => ({
          source: row.source,
          totalImpressions: row._sum.impressions ?? 0,
          totalClicks: row._sum.clicks ?? 0,
          keywordCount: keywordCountBySource.get(row.source) ?? 0,
        })),
        ...(includeGoogle && googleRows.length > 0
          ? [
              {
                source: 'google',
                totalImpressions: googleImpressions,
                totalClicks: googleClicks,
                keywordCount: keywordCountBySource.get('google') ?? 0,
              },
            ]
          : []),
      ].sort((a, b) => a.source.localeCompare(b.source)),
      clarity: {
        totalSessions: claritySiteAgg._sum.sessions ?? 0,
        totalPageViews: claritySiteAgg._sum.pageViews ?? 0,
        totalJsErrors: claritySiteAgg._sum.jsErrors ?? 0,
        totalRageClicks: claritySiteAgg._sum.rageClicks ?? 0,
        siteDays: claritySiteCount,
      },
    };
  }

  /** 搜索表现按日趋势。Google 读取 site 维度，其他平台读取具名查询聚合。 */
  async getSearchTrend(query: QuerySeoSearchTrendDto): Promise<SeoSearchTrendResponse> {
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);
    const includeGoogle = !query.source || query.source === 'google';
    const includeOtherSources = query.source !== 'google';
    const where: Prisma.SeoSearchQueryWhereInput = {
      deletedAt: null,
      source: query.source ?? { not: 'google' },
    };
    if (dateFilter) where.statDate = dateFilter;

    const [grouped, positionRows, googleRows] = await Promise.all([
      includeOtherSources
        ? this.prisma.seoSearchQuery.groupBy({
            by: ['statDate'],
            where,
            _sum: { impressions: true, clicks: true },
            orderBy: { statDate: 'asc' },
          })
        : Promise.resolve([]),
      includeOtherSources
        ? this.prisma.seoSearchQuery.groupBy({
            by: ['statDate', 'query'],
            where: { ...where, avgPosition: { not: null }, impressions: { gt: 0 } },
            _sum: { impressions: true },
            _avg: { avgPosition: true },
          })
        : Promise.resolve([]),
      includeGoogle
        ? this.prisma.seoSearchPerformance.findMany({
            where: {
              deletedAt: null,
              source: 'google',
              dimension: 'site',
              dimensionValue: '__SITE__',
              ...(dateFilter ? { statDate: dateFilter } : {}),
            },
            select: { statDate: true, impressions: true, clicks: true, avgPosition: true },
            orderBy: { statDate: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const byDate = new Map<
      string,
      { impressions: number; clicks: number; positionSum: number; positionWeight: number }
    >();
    for (const row of grouped) {
      const dateKey = prismaDateToBeijingString(row.statDate as Date | null) ?? '';
      if (!dateKey) continue;
      byDate.set(dateKey, {
        impressions: row._sum.impressions ?? 0,
        clicks: row._sum.clicks ?? 0,
        positionSum: 0,
        positionWeight: 0,
      });
    }
    for (const r of positionRows) {
      const dateKey = prismaDateToBeijingString(r.statDate as Date | null) ?? '';
      if (!dateKey) continue;
      const w = r._sum.impressions ?? 0;
      const p = r._avg.avgPosition ? toDecimalNumber(r._avg.avgPosition) : null;
      if (p == null || w <= 0) continue;
      const cur = byDate.get(dateKey) ?? {
        impressions: 0,
        clicks: 0,
        positionSum: 0,
        positionWeight: 0,
      };
      cur.positionSum += p * w;
      cur.positionWeight += w;
      byDate.set(dateKey, cur);
    }
    for (const row of googleRows) {
      const dateKey = prismaDateToBeijingString(row.statDate as Date | null) ?? '';
      if (!dateKey) continue;
      const cur = byDate.get(dateKey) ?? {
        impressions: 0,
        clicks: 0,
        positionSum: 0,
        positionWeight: 0,
      };
      const impressions = row.impressions ?? 0;
      cur.impressions += impressions;
      cur.clicks += row.clicks ?? 0;
      const position = row.avgPosition ? toDecimalNumber(row.avgPosition) : null;
      if (position != null && impressions > 0) {
        cur.positionSum += position * impressions;
        cur.positionWeight += impressions;
      }
      byDate.set(dateKey, cur);
    }

    const points = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, row]) => {
        const imp = row.impressions;
        const clk = row.clicks;
        return {
          date,
          impressions: imp,
          clicks: clk,
          ctr: imp > 0 ? clk / imp : null,
          avgPosition: row.positionWeight > 0 ? row.positionSum / row.positionWeight : null,
        };
      });

    return {
      range: { startDate: query.startDate, endDate: query.endDate },
      points,
    };
  }

  /** Top N 排行：具名关键词读取 query 维度；落地页读取 Google page 权威维度。 */
  async getSearchRanking(query: QuerySeoSearchRankingDto): Promise<SeoSearchRankingResponse> {
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);

    if (query.dim === 'keyword') {
      const where: Prisma.SeoSearchQueryWhereInput = { deletedAt: null };
      if (query.source) where.source = query.source;
      if (dateFilter) where.statDate = dateFilter;

      const grouped = await this.prisma.seoSearchQuery.groupBy({
        by: ['query'],
        where,
        _sum: { impressions: true, clicks: true },
        orderBy: { _sum: { impressions: 'desc' } },
        take: query.limit,
      });

      return {
        range: { startDate: query.startDate, endDate: query.endDate },
        dim: 'keyword',
        items: grouped.map((g) => {
          const imp = g._sum.impressions ?? 0;
          const clk = g._sum.clicks ?? 0;
          const ctr = imp > 0 ? clk / imp : 0;
          return {
            id: g.query,
            name: g.query,
            value: imp,
            hint: `点击 ${clk.toLocaleString('zh-CN')} · CTR ${(ctr * 100).toFixed(2)}%`,
          };
        }),
      };
    }

    // dim === 'page'
    const where: Prisma.SeoSearchPerformanceWhereInput = {
      deletedAt: null,
      dimension: 'page',
    };
    where.source = query.source ?? 'google';
    if (dateFilter) where.statDate = dateFilter;

    const grouped = await this.prisma.seoSearchPerformance.groupBy({
      by: ['dimensionValue'],
      where,
      _sum: { impressions: true, clicks: true },
      _avg: { avgPosition: true },
      orderBy: { _sum: { impressions: 'desc' } },
      take: query.limit,
    });

    return {
      range: { startDate: query.startDate, endDate: query.endDate },
      dim: 'page',
      items: grouped.map((g) => {
        const impressions = g._sum.impressions ?? 0;
        const clicks = g._sum.clicks ?? 0;
        const position = g._avg.avgPosition ? toDecimalNumber(g._avg.avgPosition) : null;
        return {
          id: g.dimensionValue,
          name: g.dimensionValue,
          value: impressions,
          hint: `点击 ${clicks.toLocaleString('zh-CN')} · 平均排名 ${position?.toFixed(2) ?? '-'}`,
        };
      }),
    };
  }

  /**
   * Clarity 全站聚合行（pageUrl='__SITE__'）按日序列，用于「用户行为趋势」图
   */
  async getSiteSummary(query: QuerySeoSiteSummaryDto): Promise<SeoSiteSummaryResponse> {
    const dateFilter = buildBeijingDateRangeFilter(query.startDate, query.endDate);
    const where: Prisma.SeoPageInsightWhereInput = {
      deletedAt: null,
      pageUrl: SEO_PAGE_INSIGHT_SITE_AGGREGATE,
    };
    if (query.source) where.source = query.source;
    if (dateFilter) where.statDate = dateFilter;

    const rows = await this.prisma.seoPageInsight.findMany({
      where,
      select: {
        statDate: true,
        sessions: true,
        uniqueUsers: true,
        pageViews: true,
        avgEngagementMs: true,
        scrollDepthAvg: true,
        deadClicks: true,
        rageClicks: true,
        jsErrors: true,
      },
      orderBy: { statDate: 'asc' },
    });

    return {
      range: { startDate: query.startDate, endDate: query.endDate },
      points: rows.map((r) => ({
        date: prismaDateToBeijingString(r.statDate as Date | null) ?? '',
        sessions: r.sessions ?? 0,
        uniqueUsers: r.uniqueUsers ?? 0,
        pageViews: r.pageViews ?? 0,
        // ⚠️ avgEngagementMs 字段名带 Ms 但 sync-clarity 实际写入秒，直接返回不要除 1000
        avgEngagementSeconds: r.avgEngagementMs ?? null,
        scrollDepthAvg: r.scrollDepthAvg ?? null,
        deadClicks: r.deadClicks ?? 0,
        rageClicks: r.rageClicks ?? 0,
        jsErrors: r.jsErrors ?? 0,
      })),
    };
  }

  // ---------- FC 同步触发（手动 / cron 兜底） ----------

  /**
   * 前端 ManualSyncButton 触发的 FC 全量同步。
   *
   * 单次 FC 同步约几十秒，前端 axios timeout 5min；本方法给 fetch 自己再加 4min
   * AbortController，确保 NestJS 层先于前端超时返回。
   */
  async triggerManualSync(): Promise<SeoManualSyncResult> {
    return this.executeFcSync('manual');
  }

  /**
   * azeroth 内置 cron 兜底触发的 FC 全量同步（SeoBackupCronService 调用）。
   *
   * 存在原因：FC daily-sync 定时触发器历史上多次「重挂后触发一次、下一 tick 又哑」，
   * 07-04 已确认 方案 B —— 由 NestJS `@Cron('0 9 * * *', {timeZone: 'Asia/Shanghai'})`
   * 每天 09:00 CST 内网 POST FC http-trigger 兜底，FC 端不做改动。
   *
   * FC runtime 只根据平台注入的 control path 判定 HTTP 调用并校验 header secret，
   * 不信任请求 body 的 source/action 作为身份。最终 DB 统一记录 `triggerSource='http'`；
   * 与前端手动同步在 DB 上不做区分，`azeroth-cron` 仅保留在 Server 侧日志中。
   */
  async triggerAutomaticBackup(): Promise<SeoManualSyncResult> {
    return this.executeFcSync('azeroth-cron');
  }

  /**
   * NestJS → 阿里云 FC HTTP 触发器（匿名网关 + secret 校验）的核心调用。
   *
   * @param sourceTag 仅用于 Server 侧日志区分 manual / azeroth-cron，不发送给 FC，
   *                  更不作为调用方身份；FC runtime 只信任平台 control path。
   *
   * 失败处理：
   *   - 仅接受契约一致的 200 完整成功或 207 明确部分失败；任何畸形 body 都抛
   *     BadGatewayException（cron 兜底由外层 catch 并记录）。
   *   - Abort 超时映射 504；其它非 200/207、非 JSON、网络异常维持 502/契约语义。
   */
  private async executeFcSync(sourceTag: string): Promise<SeoManualSyncResult> {
    const fcUrl = this.config.get<string>('SEO_SYNC_FC_URL');
    const secret = this.config.get<string>('SEO_TRIGGER_SECRET');
    if (!fcUrl) {
      throw new BadGatewayException('SEO_SYNC_FC_URL 未配置，无法触发 FC 同步');
    }
    if (!secret) {
      throw new BadGatewayException('SEO_TRIGGER_SECRET 未配置，无法通过 FC 鉴权');
    }

    const controller = new AbortController();
    // 4min hard cap，留 1min buffer 给前端 axios（5min timeout）先超时返回错误
    const timer = setTimeout(() => controller.abort(), 4 * 60 * 1000);

    let httpStatus = 0;
    let payload: unknown;
    try {
      const res = await fetch(fcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trigger-secret': secret,
        },
        // 身份只由 FC runtime 的 control path + header secret 判定，body 不承载身份。
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      httpStatus = res.status;
      if (httpStatus !== 200 && httpStatus !== 207) {
        const message = `SEO 同步 FC 返回异常状态（HTTP ${httpStatus}）`;
        this.logger.error(`[${sourceTag}] ${message}`);
        throw new BadGatewayException(message);
      }

      const text = await res.text();
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // 不回显上游正文，避免畸形响应把触发密钥带入 API 错误。
        throw new BadGatewayException(`FC 返回非 JSON（HTTP ${httpStatus}）`);
      }
    } catch (err: unknown) {
      if (err instanceof BadGatewayException) throw err;
      if (controller.signal.aborted || isAbortError(err)) {
        const message = '调用 SEO 同步 FC 超时，请稍后重试';
        this.logger.error(`[${sourceTag}] ${message}`);
        throw new GatewayTimeoutException(message);
      }
      // 不回显底层 fetch 文本；其中可能含 FC URL query、鉴权信息或运行时细节。
      this.logger.error(`[${sourceTag}] 调用 SEO 同步 FC 失败`);
      throw new BadGatewayException('调用 SEO 同步 FC 失败');
    } finally {
      clearTimeout(timer);
    }

    const report = validateFcResponse(payload, httpStatus);
    const {
      bingWritten,
      googleWritten,
      clarityWritten,
      errorCount,
      elapsedMs: durationMs,
    } = report;

    if (errorCount > 0) {
      this.logger.warn(
        `[${sourceTag}] 同步部分失败: Bing ${bingWritten} + Google ${googleWritten} + Clarity ${clarityWritten} 条, 耗时 ${durationMs}ms, 错误 ${errorCount}`
      );
    } else {
      this.logger.log(
        `[${sourceTag}] 同步完成: Bing ${bingWritten} + Google ${googleWritten} + Clarity ${clarityWritten} 条, 耗时 ${durationMs}ms, 错误 0`
      );
    }

    return {
      count: bingWritten + googleWritten + clarityWritten,
      durationMs,
      bingWritten,
      googleWritten,
      clarityWritten,
      errorCount,
    };
  }
}
