import { XIAOHONGSHU_DATA_CALIBERS, XIAOHONGSHU_REPORT_LEVELS } from '@ky-azeroth/shared/constants';
import type {
  IXiaohongshuAdvertiserResponse,
  IXiaohongshuConnectionResponse,
  IXiaohongshuDailyReportResponse,
  IXiaohongshuManualSyncResult,
  IXiaohongshuMetricCoverage,
  IXiaohongshuMetrics,
  IXiaohongshuRankingResponse,
  IXiaohongshuSummaryResponse,
  IXiaohongshuSyncRun,
  IXiaohongshuSyncRunDetail,
  IXiaohongshuSyncRunReport,
  IXiaohongshuTrendResponse,
  PaginatedResponse,
  XiaohongshuDataCaliber,
  XiaohongshuMetricCoverageStatus,
  XiaohongshuReportLevel,
  XiaohongshuReportRawPayload,
} from '@ky-azeroth/shared/types';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import type {
  XiaohongshuJsonValue,
  XiaohongshuNote,
  XiaohongshuNoteType,
} from '../xiaohongshu-core';
import { XiaohongshuApiClient } from '../xiaohongshu-core';
import type {
  XiaohongshuDailyReportQueryDto,
  XiaohongshuManualSyncDto,
  XiaohongshuRankingQueryDto,
  XiaohongshuSummaryQueryDto,
  XiaohongshuSyncRunQueryDto,
  XiaohongshuTrendQueryDto,
} from './dto';
import {
  type ParsedXiaohongshuReportRow,
  parseXiaohongshuReportRow,
} from './xiaohongshu-report.mapper';
import { XiaohongshuTokenService } from './xiaohongshu-token.service';

const XIAOHONGSHU_NOTE_TYPES = [
  1, 2, 4, 6, 11, 12, 14,
] as const satisfies readonly XiaohongshuNoteType[];
const NOTE_METADATA_PREFIX = 'note_meta__';

const NULLABLE_METRICS = [
  'landingPageVisit',
  'formImpression',
  'formSubmit',
  'validFormSubmit',
  'combinedLead',
  'messageUser',
  'messageConsult',
  'messageOpen',
  'messageLead',
] as const;
type NullableMetric = (typeof NULLABLE_METRICS)[number];

interface SyncError {
  advertiserId?: string;
  level?: XiaohongshuReportLevel;
  dataCaliber?: XiaohongshuDataCaliber;
  message: string;
}

class SyncRunLeaseLostError extends Error {
  constructor() {
    super('小红书同步任务已被关闭，停止后续处理');
  }
}

interface MetricTotals {
  fee: number;
  impression: number;
  click: number;
  interaction: number;
  like: number;
  comment: number;
  collect: number;
  follow: number;
  share: number;
  landingPageVisit: number | null;
  formImpression: number | null;
  formSubmit: number | null;
  validFormSubmit: number | null;
  combinedLead: number | null;
  messageUser: number | null;
  messageConsult: number | null;
  messageOpen: number | null;
  messageLead: number | null;
  rowCount: number;
  knownCounts: Record<NullableMetric, number>;
}

interface NoteReportRow {
  id: string;
  entityId: string;
  rawPayload: unknown;
}

interface HistoricalReportRow {
  statDate: Date;
  level: string;
  entityId: string;
  dataCaliber: number;
  advertiserAccount: {
    advertiserId: string;
    updatedAt: Date;
  };
}

interface MetricRow {
  fee: Prisma.Decimal | number;
  impression: number;
  click: number;
  interaction: number;
  like: number;
  comment: number;
  collect: number;
  follow: number;
  share: number;
  landingPageVisit?: number | null;
  formImpression?: number | null;
  formSubmit?: number | null;
  validFormSubmit?: number | null;
  combinedLead?: number | null;
  messageUser?: number | null;
  messageConsult?: number | null;
  messageOpen?: number | null;
  messageLead?: number | null;
}

@Injectable()
export class XiaohongshuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: XiaohongshuApiClient,
    private readonly tokens: XiaohongshuTokenService
  ) {}

  async getConnection(): Promise<IXiaohongshuConnectionResponse | null> {
    const row = await this.prisma.xiaohongshuConnection.findFirst({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row) return null;
    return {
      id: row.id,
      status: row.status as IXiaohongshuConnectionResponse['status'],
      scopes: this.stringArray(row.scopes) as IXiaohongshuConnectionResponse['scopes'],
      expiresAt: row.accessTokenExpiresAt?.toISOString() ?? null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      errorMessage: row.lastError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getAdvertisers(): Promise<IXiaohongshuAdvertiserResponse[]> {
    const rows = await this.prisma.xiaohongshuAdvertiser.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        connection: { deletedAt: null, status: 'active' },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.advertiserId)) latest.set(row.advertiserId, row);
    }
    return [...latest.values()]
      .sort((a, b) => a.advertiserName.localeCompare(b.advertiserName, 'zh-CN'))
      .map((row) => ({
        advertiserId: row.advertiserId,
        advertiserName: row.advertiserName,
        connectionId: row.connectionId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
  }

  async getReports(
    query: XiaohongshuDailyReportQueryDto
  ): Promise<IXiaohongshuDailyReportResponse> {
    const [pageIndex, rawFieldKeys] = await Promise.all([
      this.reportPageIndex(query),
      this.reportRawFieldKeys(query),
    ]);
    const total = pageIndex[0]?.total ?? 0;
    const pageIds = pageIndex.flatMap((row) => (row.id ? [row.id] : []));
    const unorderedRows = await this.prisma.xiaohongshuDailyReport.findMany({
      where: { id: { in: pageIds } },
      include: { advertiserAccount: true },
    });
    const rowById = new Map(unorderedRows.map((row) => [row.id, row]));
    const pageRows = pageIds.flatMap((id) => {
      const row = rowById.get(id);
      return row ? [row] : [];
    });
    return {
      items: pageRows.map((row) => {
        const fee = Number(row.fee);
        const rawPayload = this.reportRawPayload(row.rawPayload);
        const isNote = row.level === 'note';
        return {
          id: row.id,
          statDate: this.dateString(row.statDate),
          advertiserId: row.advertiserAccount.advertiserId,
          advertiserName: row.advertiserAccount.advertiserName,
          level: row.level as XiaohongshuReportLevel,
          dataCaliber: row.dataCaliber as XiaohongshuDataCaliber,
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          unitId: row.unitId,
          unitName: row.unitName,
          creativeId: row.creativeId,
          creativeName: row.creativeName,
          noteId: isNote
            ? (this.rawString(rawPayload, 'note_id') ??
              this.rawString(rawPayload, 'note_meta__note_id') ??
              row.entityId)
            : null,
          noteTitle: isNote
            ? (this.rawString(rawPayload, 'note_title') ??
              this.rawString(rawPayload, 'note_meta__title') ??
              row.entityName)
            : null,
          noteImage: isNote
            ? (this.rawString(rawPayload, 'note_image') ??
              this.rawString(rawPayload, 'note_meta__image'))
            : null,
          noteJumpUrl: isNote
            ? (this.rawString(rawPayload, 'note_jump_url') ??
              this.rawString(rawPayload, 'note_meta__note_url'))
            : null,
          rawPayload,
          fee,
          impression: row.impression,
          click: row.click,
          interaction: row.interaction,
          like: row.like,
          comment: row.comment,
          collect: row.collect,
          follow: row.follow,
          share: row.share,
          landingPageVisit: row.landingPageVisit,
          formImpression: row.formImpression,
          formSubmit: row.formSubmit,
          validFormSubmit: row.validFormSubmit,
          combinedLead: row.combinedLead,
          messageUser: row.messageUser,
          messageConsult: row.messageConsult,
          messageOpen: row.messageOpen,
          messageLead: row.messageLead,
          ctr: row.impression ? row.click / row.impression : null,
          cpc: row.click ? fee / row.click : null,
          cpm: row.impression ? (fee / row.impression) * 1000 : null,
          cpi: row.interaction ? fee / row.interaction : null,
          interactionRate: row.impression ? row.interaction / row.impression : null,
          likeRate: row.impression ? row.like / row.impression : null,
          collectRate: row.impression ? row.collect / row.impression : null,
          commentRate: row.impression ? row.comment / row.impression : null,
          followRate: row.impression ? row.follow / row.impression : null,
          shareRate: row.impression ? row.share / row.impression : null,
          messageConsultRate: this.ratio(row.messageConsult, row.click),
          messageOpenRate: this.ratio(row.messageOpen, row.messageConsult),
          messageLeadRate: this.ratio(row.messageLead, row.messageOpen),
          messageConsultCost: this.ratio(fee, row.messageConsult),
          messageLeadCost: this.ratio(fee, row.messageLead),
          landingPageVisitRate: this.ratio(row.landingPageVisit, row.click),
          formImpressionRate: this.ratio(row.formImpression, row.landingPageVisit),
          formSubmitRate: this.ratio(row.formSubmit, row.formImpression),
          validFormSubmitRate: this.ratio(row.validFormSubmit, row.formSubmit),
          formSubmitCost: this.ratio(fee, row.formSubmit),
          validFormSubmitCost: this.ratio(fee, row.validFormSubmit),
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
      dataCaliber: query.dataCaliber,
      rawFieldKeys,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  private async reportPageIndex(
    query: XiaohongshuDailyReportQueryDto
  ): Promise<Array<{ id: string | null; total: number }>> {
    const filters = this.reportFilters(query);
    const order = query.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (query.page - 1) * query.pageSize;
    // @prisma-raw-sql: 需用 PostgreSQL 窗口函数先跨历史授权连接去重，再在数据库内稳定分页。
    return this.prisma.$queryRaw<Array<{ id: string | null; total: number }>>(Prisma.sql`
      WITH ranked AS (
        SELECT
          r."id",
          r."statDate",
          ROW_NUMBER() OVER (
            PARTITION BY
              a."advertiserId",
              r."statDate",
              r."level",
              r."entityId",
              r."dataCaliber"
            ORDER BY a."updatedAt" DESC, r."updatedAt" DESC, r."id" DESC
          ) AS row_rank
        FROM "xiaohongshu_daily_reports" r
        INNER JOIN "xiaohongshu_advertisers" a ON a."id" = r."advertiserAccountId"
        WHERE ${Prisma.join(filters, ' AND ')}
      ),
      deduplicated AS (
        SELECT "id", "statDate"
        FROM ranked
        WHERE row_rank = 1
      ),
      paged AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (ORDER BY "statDate" ${order}, "id" ${order}) AS page_order
        FROM deduplicated
        ORDER BY "statDate" ${order}, "id" ${order}
        OFFSET ${offset}
        LIMIT ${query.pageSize}
      )
      SELECT paged."id", totals.total
      FROM (SELECT COUNT(*)::INTEGER AS total FROM deduplicated) totals
      LEFT JOIN paged ON TRUE
      ORDER BY paged.page_order NULLS LAST
    `);
  }

  private async reportRawFieldKeys(query: XiaohongshuDailyReportQueryDto): Promise<string[]> {
    const filters = this.reportFilters(query);
    // @prisma-raw-sql: 原始字段目录必须覆盖完整过滤结果，并与日报相同地跨历史授权连接去重。
    const rows = await this.prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
      WITH ranked AS (
        SELECT
          r."rawPayload",
          ROW_NUMBER() OVER (
            PARTITION BY
              a."advertiserId",
              r."statDate",
              r."level",
              r."entityId",
              r."dataCaliber"
            ORDER BY a."updatedAt" DESC, r."updatedAt" DESC, r."id" DESC
          ) AS row_rank
        FROM "xiaohongshu_daily_reports" r
        INNER JOIN "xiaohongshu_advertisers" a ON a."id" = r."advertiserAccountId"
        WHERE ${Prisma.join(filters, ' AND ')}
      )
      SELECT DISTINCT fields."key"
      FROM ranked
      CROSS JOIN LATERAL jsonb_object_keys(
        CASE
          WHEN jsonb_typeof(ranked."rawPayload") = 'object' THEN ranked."rawPayload"
          ELSE '{}'::jsonb
        END
      ) AS fields("key")
      WHERE ranked.row_rank = 1
      ORDER BY fields."key"
    `);
    return rows.map((row) => row.key);
  }

  private reportFilters(query: XiaohongshuDailyReportQueryDto): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [
      Prisma.sql`r."deletedAt" IS NULL`,
      Prisma.sql`a."deletedAt" IS NULL`,
      Prisma.sql`r."dataCaliber" = ${query.dataCaliber}`,
    ];
    if (query.advertiserId) {
      filters.push(Prisma.sql`a."advertiserId" = ${query.advertiserId}`);
    }
    if (query.level) filters.push(Prisma.sql`r."level" = ${query.level}`);
    if (query.startDate) {
      filters.push(Prisma.sql`r."statDate" >= ${this.date(query.startDate)}`);
    }
    if (query.endDate) {
      filters.push(Prisma.sql`r."statDate" <= ${this.date(query.endDate)}`);
    }
    return filters;
  }

  async getSummary(query: XiaohongshuSummaryQueryDto): Promise<IXiaohongshuSummaryResponse> {
    const totals = await this.aggregate(
      query.startDate,
      query.endDate,
      query.level,
      query.dataCaliber,
      query.advertiserId
    );
    const response: IXiaohongshuSummaryResponse = {
      range: {
        startDate: query.startDate,
        endDate: query.endDate,
        dataCaliber: query.dataCaliber,
      },
      level: query.level,
      totals: this.metrics(totals),
    };
    if (query.compareStartDate && query.compareEndDate) {
      const previous = await this.aggregate(
        query.compareStartDate,
        query.compareEndDate,
        query.level,
        query.dataCaliber,
        query.advertiserId
      );
      response.comparison = {
        range: {
          startDate: query.compareStartDate,
          endDate: query.compareEndDate,
          dataCaliber: query.dataCaliber,
        },
        totals: this.metrics(previous),
      };
      response.deltas = this.deltas(totals, previous);
    }
    return response;
  }

  async getTrend(query: XiaohongshuTrendQueryDto): Promise<IXiaohongshuTrendResponse> {
    const rows = await this.analyticsRows(
      query.startDate,
      query.endDate,
      query.level,
      query.dataCaliber,
      query.advertiserId
    );
    const grouped = new Map<string, MetricTotals>();
    for (const row of rows) this.add(grouped, this.dateString(row.statDate), row);
    return {
      range: {
        startDate: query.startDate,
        endDate: query.endDate,
        dataCaliber: query.dataCaliber,
      },
      level: query.level,
      points: [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, totals]) => ({ date, ...this.metrics(totals) })),
    };
  }

  async getRanking(query: XiaohongshuRankingQueryDto): Promise<IXiaohongshuRankingResponse> {
    const rows = await this.analyticsRows(
      query.startDate,
      query.endDate,
      query.level,
      query.dataCaliber,
      query.advertiserId
    );
    const grouped = new Map<
      string,
      MetricTotals & { name: string; noteImage: string | null; noteJumpUrl: string | null }
    >();
    for (const row of rows) {
      const rawPayload = this.reportRawPayload(row.rawPayload);
      const current = grouped.get(row.entityId) ?? {
        name:
          (query.level === 'note'
            ? (this.rawString(rawPayload, 'note_title') ??
              this.rawString(rawPayload, 'note_meta__title'))
            : null) ??
          row.entityName ??
          row.entityId,
        noteImage:
          this.rawString(rawPayload, 'note_image') ??
          this.rawString(rawPayload, 'note_meta__image'),
        noteJumpUrl:
          this.rawString(rawPayload, 'note_jump_url') ??
          this.rawString(rawPayload, 'note_meta__note_url'),
        ...this.emptyTotals(),
      };
      current.noteImage ??=
        this.rawString(rawPayload, 'note_image') ?? this.rawString(rawPayload, 'note_meta__image');
      current.noteJumpUrl ??=
        this.rawString(rawPayload, 'note_jump_url') ??
        this.rawString(rawPayload, 'note_meta__note_url');
      this.addTotals(current, row);
      grouped.set(row.entityId, current);
    }
    const items = [...grouped.entries()]
      .map(([id, totals]) => {
        const metrics = this.metrics(totals);
        const rawValue = metrics[query.metric];
        return {
          id,
          name: totals.name,
          level: query.level,
          ...(query.level === 'note'
            ? { noteImage: totals.noteImage, noteJumpUrl: totals.noteJumpUrl }
            : {}),
          ...metrics,
          value: rawValue ?? 0,
          ...(this.isNullableMetric(query.metric)
            ? { valueCoverage: metrics.metricCoverage[query.metric] }
            : {}),
        };
      })
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, query.limit);
    return {
      range: {
        startDate: query.startDate,
        endDate: query.endDate,
        dataCaliber: query.dataCaliber,
      },
      level: query.level,
      metric: query.metric,
      items,
    };
  }

  async getSyncRuns(
    query: XiaohongshuSyncRunQueryDto
  ): Promise<PaginatedResponse<IXiaohongshuSyncRun>> {
    const where: Prisma.XiaohongshuSyncRunWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.advertiserId ? { advertiserIds: { array_contains: [query.advertiserId] } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.xiaohongshuSyncRun.findMany({
        where,
        orderBy: { startedAt: query.sortOrder },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.xiaohongshuSyncRun.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.mapSyncRun(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async getLatestSyncRun(advertiserId?: string): Promise<IXiaohongshuSyncRun | null> {
    const row = await this.prisma.xiaohongshuSyncRun.findFirst({
      where: {
        deletedAt: null,
        ...(advertiserId ? { advertiserIds: { array_contains: [advertiserId] } } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
    return row ? this.mapSyncRun(row) : null;
  }

  async getSyncRun(id: string): Promise<IXiaohongshuSyncRunDetail> {
    const row = await this.prisma.xiaohongshuSyncRun.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) throw new NotFoundException('同步任务不存在');
    return {
      ...this.mapSyncRun(row),
      counts: this.numberRecord(row.counts),
      report: this.syncReport(row.report),
    };
  }

  async triggerSync(
    input: XiaohongshuManualSyncDto,
    triggerSource = 'manual',
    createdBy?: string
  ): Promise<IXiaohongshuManualSyncResult> {
    const range = this.resolveRange(input.startDate, input.endDate);
    const levels = input.levels ?? [...XIAOHONGSHU_REPORT_LEVELS];
    const advertiserRows = await this.prisma.xiaohongshuAdvertiser.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        connection: { deletedAt: null, status: 'active' },
        ...(input.advertiserIds ? { advertiserId: { in: input.advertiserIds } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });
    const latestAdvertisers = new Map<string, (typeof advertiserRows)[number]>();
    for (const row of advertiserRows) {
      if (!latestAdvertisers.has(row.advertiserId)) latestAdvertisers.set(row.advertiserId, row);
    }
    const advertisers = [...latestAdvertisers.values()];
    const run = await this.prisma.xiaohongshuSyncRun.create({
      data: {
        connectionId: advertisers[0]?.connectionId,
        triggerSource,
        status: 'running',
        startDate: this.date(range.startDate),
        endDate: this.date(range.endDate),
        levels: toJsonValue(levels),
        advertiserIds: toJsonValue(advertisers.map((item) => item.advertiserId)),
        createdBy,
      },
    });

    try {
      const started = Date.now();
      let syncedRows = 0;
      let succeeded = 0;
      let reportSucceeded = 0;
      let shardCount = advertisers.length * levels.length * XIAOHONGSHU_DATA_CALIBERS.length;
      const errors: SyncError[] = advertisers.length
        ? []
        : [{ message: '没有可同步的已授权广告主' }];
      const counts: Record<string, number> = {};
      for (const advertiser of advertisers) {
        for (const level of levels) {
          let levelReportSucceeded = 0;
          for (const dataCaliber of XIAOHONGSHU_DATA_CALIBERS) {
            const shard = `${advertiser.advertiserId}:${level}:${dataCaliber}`;
            try {
              const count = await this.syncShard(
                run.id,
                advertiser.id,
                advertiser.connectionId,
                advertiser.advertiserId,
                level,
                dataCaliber,
                range.startDate,
                range.endDate
              );
              counts[shard] = count;
              syncedRows += count;
              succeeded++;
              reportSucceeded++;
              levelReportSucceeded++;
            } catch (error: unknown) {
              if (error instanceof SyncRunLeaseLostError) throw error;
              counts[shard] = 0;
              errors.push({
                advertiserId: advertiser.advertiserId,
                level,
                dataCaliber,
                message: this.sanitizeError(error),
              });
            }
          }
          if (level === 'note') {
            shardCount += XIAOHONGSHU_NOTE_TYPES.length;
            const metadataResult = await this.syncNoteMetadata(
              run.id,
              advertiser.id,
              advertiser.connectionId,
              advertiser.advertiserId,
              range.startDate,
              range.endDate,
              levelReportSucceeded > 0
            );
            Object.assign(counts, metadataResult.counts);
            errors.push(...metadataResult.errors);
            succeeded += metadataResult.succeeded;
          }
        }
      }
      const status = errors.length === 0 ? 'success' : reportSucceeded === 0 ? 'failed' : 'partial';
      const finishedAt = new Date();
      const finalized = await this.prisma.xiaohongshuSyncRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: {
          status,
          syncedRows,
          counts: toJsonValue(counts),
          errors: toJsonValue(errors),
          report: toJsonValue({ shardCount, succeeded, failed: shardCount - succeeded }),
          finishedAt,
          elapsedMs: Date.now() - started,
        },
      });
      if (finalized.count !== 1) throw new SyncRunLeaseLostError();
      if (advertisers.length && reportSucceeded > 0) {
        await this.prisma.xiaohongshuConnection.updateMany({
          where: { id: { in: [...new Set(advertisers.map((item) => item.connectionId))] } },
          data: { lastSyncedAt: finishedAt },
        });
      }
      return {
        runId: run.id,
        status,
        startDate: range.startDate,
        endDate: range.endDate,
        levels,
        advertiserIds: advertisers.map((item) => item.advertiserId),
      };
    } catch (error: unknown) {
      if (error instanceof SyncRunLeaseLostError) throw error;
      const finishedAt = new Date();
      await this.prisma.xiaohongshuSyncRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: {
          status: 'failed',
          errors: toJsonValue([{ message: this.sanitizeError(error) }]),
          finishedAt,
        },
      });
      throw error;
    }
  }

  async failStaleRuns(staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000)): Promise<number> {
    const result = await this.prisma.xiaohongshuSyncRun.updateMany({
      where: { status: 'running', deletedAt: null, startedAt: { lt: staleBefore } },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errors: toJsonValue([{ message: '同步任务超过 6 小时未完成，已由看门狗关闭' }]),
      },
    });
    return result.count;
  }

  private async syncShard(
    runId: string,
    advertiserAccountId: string,
    connectionId: string,
    advertiserId: string,
    level: XiaohongshuReportLevel,
    dataCaliber: XiaohongshuDataCaliber,
    startDate: string,
    endDate: string
  ): Promise<number> {
    const accessToken = await this.tokens.getAccessToken(connectionId);
    const parsedRows: ParsedXiaohongshuReportRow[] = [];
    let parseFailureCount = 0;
    let authoritativeTotalCount: number | null = null;
    let page = 1;
    for (;;) {
      await this.assertSyncRunActive(runId);
      const response = await this.api.fetchOfflineReport(accessToken, level, {
        advertiser_id: advertiserId,
        start_date: startDate,
        end_date: endDate,
        page_num: page,
        page_size: 500,
        time_unit: 'DAY',
        data_caliber: dataCaliber,
      });
      authoritativeTotalCount ??= response.total_count;
      for (const row of response.data_list) {
        try {
          const parsed = parseXiaohongshuReportRow(row, level, advertiserId, dataCaliber);
          if (!parsed) parseFailureCount++;
          else if (authoritativeTotalCount !== 0) parsedRows.push(parsed);
        } catch {
          parseFailureCount++;
        }
      }
      if (parseFailureCount > 0) break;
      if (
        authoritativeTotalCount === 0 ||
        parsedRows.length >= authoritativeTotalCount ||
        response.data_list.length === 0
      ) {
        break;
      }
      page++;
    }

    if (parseFailureCount > 0) {
      throw new Error(
        `小红书报表解析失败：${parseFailureCount} 行（层级 ${level}，口径 ${dataCaliber}）`
      );
    }
    if (parsedRows.length !== (authoritativeTotalCount ?? 0)) {
      throw new Error(
        `小红书报表分页不完整：应有 ${authoritativeTotalCount ?? 0} 行，实际 ${parsedRows.length} 行` +
          `（层级 ${level}，口径 ${dataCaliber}）`
      );
    }

    await this.prisma.$transaction(
      async (transaction) => {
        await this.lockActiveSyncRun(transaction, runId);
        await transaction.xiaohongshuDailyReport.deleteMany({
          where: {
            advertiserAccountId,
            level,
            dataCaliber,
            statDate: { gte: this.date(startDate), lte: this.date(endDate) },
          },
        });
        for (let index = 0; index < parsedRows.length; index += 500) {
          await transaction.xiaohongshuDailyReport.createMany({
            data: parsedRows
              .slice(index, index + 500)
              .map((parsed) => ({ advertiserAccountId, ...parsed })),
          });
        }
        await transaction.xiaohongshuAdvertiser.updateMany({
          where: { id: advertiserAccountId },
          data: { lastSyncedAt: new Date() },
        });
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
    return parsedRows.length;
  }

  private async syncNoteMetadata(
    runId: string,
    advertiserAccountId: string,
    connectionId: string,
    advertiserId: string,
    startDate: string,
    endDate: string,
    canSync: boolean
  ): Promise<{ counts: Record<string, number>; errors: SyncError[]; succeeded: number }> {
    const counts: Record<string, number> = {};
    const errors: SyncError[] = [];
    const failAll = (error: unknown) => {
      const reason = this.sanitizeError(error);
      for (const noteType of XIAOHONGSHU_NOTE_TYPES) {
        counts[this.noteMetadataShard(advertiserId, noteType)] = 0;
        errors.push({
          advertiserId,
          level: 'note',
          message: `笔记元数据 note_type=${noteType} 同步失败：${reason}`,
        });
      }
      return { counts, errors, succeeded: 0 };
    };

    if (!canSync) return failAll(new Error('笔记报表分片均失败，已跳过元数据查询'));

    let rows: NoteReportRow[];
    let accessToken: string;
    try {
      rows = await this.prisma.xiaohongshuDailyReport.findMany({
        where: {
          advertiserAccountId,
          deletedAt: null,
          level: 'note',
          statDate: { gte: this.date(startDate), lte: this.date(endDate) },
        },
        select: { id: true, entityId: true, rawPayload: true },
      });
      if (rows.length === 0) {
        for (const noteType of XIAOHONGSHU_NOTE_TYPES) {
          counts[this.noteMetadataShard(advertiserId, noteType)] = 0;
        }
        return { counts, errors, succeeded: XIAOHONGSHU_NOTE_TYPES.length };
      }
      accessToken = await this.tokens.getAccessToken(connectionId);
    } catch (error: unknown) {
      if (error instanceof SyncRunLeaseLostError) throw error;
      return failAll(error);
    }

    const targetIds = [...new Set(rows.map((row) => row.entityId))];
    const targetIdSet = new Set(targetIds);
    const metadata = this.existingNoteMetadata(rows);
    let succeeded = 0;

    for (const noteType of XIAOHONGSHU_NOTE_TYPES) {
      const shard = this.noteMetadataShard(advertiserId, noteType);
      try {
        const staged = new Map<string, XiaohongshuNote>();
        for (let index = 0; index < targetIds.length; index += 100) {
          await this.assertSyncRunActive(runId);
          const batch = targetIds.slice(index, index + 100);
          const response = await this.api.fetchNoteList(accessToken, {
            advertiser_id: advertiserId,
            note_type: noteType,
            keyword: batch.join(','),
            page: 1,
            page_size: 100,
            base_only: false,
          });
          const notes = Array.isArray(response.notes) ? response.notes : [];
          for (const note of notes) {
            const noteId = this.noteMetadataId(note);
            if (!noteId || !targetIdSet.has(noteId)) continue;
            const current = staged.get(noteId) ?? metadata.get(noteId);
            staged.set(noteId, this.mergeNoteMetadata(current, note));
          }
        }
        await this.persistNoteMetadata(runId, rows, staged);
        for (const [noteId, note] of staged) metadata.set(noteId, note);
        counts[shard] = staged.size;
        succeeded++;
      } catch (error: unknown) {
        if (error instanceof SyncRunLeaseLostError) throw error;
        counts[shard] = 0;
        errors.push({
          advertiserId,
          level: 'note',
          message: `笔记元数据 note_type=${noteType} 同步失败：${this.sanitizeError(error)}`,
        });
      }
    }
    return { counts, errors, succeeded };
  }

  private async persistNoteMetadata(
    runId: string,
    rows: NoteReportRow[],
    metadata: Map<string, XiaohongshuNote>
  ): Promise<void> {
    if (metadata.size === 0) return;
    await this.prisma.$transaction(
      async (transaction) => {
        await this.lockActiveSyncRun(transaction, runId);
        for (const row of rows) {
          const note = metadata.get(row.entityId);
          if (!note) continue;
          const prefixed = Object.fromEntries(
            Object.entries(note).map(([key, value]) => [`${NOTE_METADATA_PREFIX}${key}`, value])
          );
          await transaction.xiaohongshuDailyReport.update({
            where: { id: row.id },
            data: {
              rawPayload: toJsonValue({ ...this.reportRawPayload(row.rawPayload), ...prefixed }),
            },
          });
        }
      },
      { maxWait: 10_000, timeout: 120_000 }
    );
  }

  private async assertSyncRunActive(runId: string): Promise<void> {
    const active = await this.prisma.xiaohongshuSyncRun.findFirst({
      where: { id: runId, status: 'running', deletedAt: null },
      select: { id: true },
    });
    if (!active) throw new SyncRunLeaseLostError();
  }

  private async lockActiveSyncRun(
    transaction: Prisma.TransactionClient,
    runId: string
  ): Promise<void> {
    const locked = await transaction.xiaohongshuSyncRun.updateMany({
      where: { id: runId, status: 'running', deletedAt: null },
      data: { updatedAt: new Date() },
    });
    if (locked.count !== 1) throw new SyncRunLeaseLostError();
  }

  private existingNoteMetadata(rows: NoteReportRow[]): Map<string, XiaohongshuNote> {
    const result = new Map<string, XiaohongshuNote>();
    for (const row of rows) {
      const note = Object.fromEntries(
        Object.entries(this.reportRawPayload(row.rawPayload))
          .filter(([key]) => key.startsWith(NOTE_METADATA_PREFIX))
          .map(([key, value]) => [key.slice(NOTE_METADATA_PREFIX.length), value])
      );
      if (Object.keys(note).length > 0) {
        result.set(row.entityId, this.mergeNoteMetadata(result.get(row.entityId), note));
      }
    }
    return result;
  }

  private mergeNoteMetadata(
    existing: XiaohongshuNote | undefined,
    incoming: XiaohongshuNote
  ): XiaohongshuNote {
    if (!existing) return incoming;
    return this.jsonCompleteness(incoming) > this.jsonCompleteness(existing)
      ? this.mergeJsonObjects(existing, incoming)
      : this.mergeJsonObjects(incoming, existing);
  }

  private mergeJsonObjects(fallback: XiaohongshuNote, preferred: XiaohongshuNote): XiaohongshuNote {
    const merged: XiaohongshuNote = { ...fallback };
    for (const [key, value] of Object.entries(preferred)) {
      const fallbackValue = merged[key];
      if (this.isJsonObject(fallbackValue) && this.isJsonObject(value)) {
        merged[key] = this.mergeJsonObjects(fallbackValue, value);
      } else if (this.jsonCompleteness(value) > 0 || this.jsonCompleteness(fallbackValue) === 0) {
        merged[key] = value;
      }
    }
    return merged;
  }

  private jsonCompleteness(value: XiaohongshuJsonValue | undefined): number {
    if (value === null || value === undefined || value === '') return 0;
    if (Array.isArray(value))
      return value.reduce<number>((sum, item) => sum + this.jsonCompleteness(item), 0);
    if (this.isJsonObject(value)) {
      return Object.values(value).reduce<number>(
        (sum, item) => sum + this.jsonCompleteness(item),
        0
      );
    }
    return 1;
  }

  private isJsonObject(value: XiaohongshuJsonValue | undefined): value is XiaohongshuNote {
    return (
      value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    );
  }

  private noteMetadataId(note: XiaohongshuNote): string | null {
    const value = note.note_id;
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  }

  private noteMetadataShard(advertiserId: string, noteType: XiaohongshuNoteType): string {
    return `${advertiserId}:note-meta:${noteType}`;
  }

  private async analyticsRows(
    startDate: string,
    endDate: string,
    level: string,
    dataCaliber: XiaohongshuDataCaliber,
    advertiserId?: string
  ) {
    const rows = await this.prisma.xiaohongshuDailyReport.findMany({
      where: {
        deletedAt: null,
        level,
        dataCaliber,
        advertiserAccount: {
          is: {
            deletedAt: null,
            ...(advertiserId ? { advertiserId } : {}),
          },
        },
        statDate: { gte: this.date(startDate), lte: this.date(endDate) },
      },
      select: {
        statDate: true,
        level: true,
        dataCaliber: true,
        entityId: true,
        entityName: true,
        fee: true,
        impression: true,
        click: true,
        interaction: true,
        like: true,
        comment: true,
        collect: true,
        follow: true,
        share: true,
        landingPageVisit: true,
        formImpression: true,
        formSubmit: true,
        validFormSubmit: true,
        combinedLead: true,
        messageUser: true,
        messageConsult: true,
        messageOpen: true,
        messageLead: true,
        rawPayload: true,
        advertiserAccount: {
          select: { advertiserId: true, updatedAt: true },
        },
      },
    });
    return this.deduplicateHistoricalRows(rows);
  }

  private deduplicateHistoricalRows<T extends HistoricalReportRow>(rows: T[]): T[] {
    const deduplicated = new Map<string, T>();
    for (const row of rows) {
      const key = JSON.stringify([
        row.advertiserAccount.advertiserId,
        row.statDate.toISOString(),
        row.level,
        row.entityId,
        row.dataCaliber,
      ]);
      const existing = deduplicated.get(key);
      if (
        !existing ||
        row.advertiserAccount.updatedAt.getTime() > existing.advertiserAccount.updatedAt.getTime()
      ) {
        deduplicated.set(key, row);
      }
    }
    return [...deduplicated.values()];
  }

  private async aggregate(
    startDate: string,
    endDate: string,
    level: string,
    dataCaliber: XiaohongshuDataCaliber,
    advertiserId?: string
  ): Promise<MetricTotals> {
    const rows = await this.analyticsRows(startDate, endDate, level, dataCaliber, advertiserId);
    const totals = this.emptyTotals();
    for (const row of rows) this.addTotals(totals, row);
    return totals;
  }

  private add(grouped: Map<string, MetricTotals>, key: string, row: MetricRow): void {
    const totals = grouped.get(key) ?? this.emptyTotals();
    this.addTotals(totals, row);
    grouped.set(key, totals);
  }

  private addTotals(totals: MetricTotals, row: MetricRow): void {
    totals.rowCount++;
    totals.fee += Number(row.fee);
    totals.impression += row.impression;
    totals.click += row.click;
    totals.interaction += row.interaction;
    totals.like += row.like;
    totals.comment += row.comment;
    totals.collect += row.collect;
    totals.follow += row.follow;
    totals.share += row.share;
    for (const metric of NULLABLE_METRICS) {
      const value = row[metric];
      if (value !== null && value !== undefined) {
        totals[metric] = (totals[metric] ?? 0) + value;
        totals.knownCounts[metric]++;
      }
    }
  }

  private emptyTotals(): MetricTotals {
    return {
      fee: 0,
      impression: 0,
      click: 0,
      interaction: 0,
      like: 0,
      comment: 0,
      collect: 0,
      follow: 0,
      share: 0,
      landingPageVisit: null,
      formImpression: null,
      formSubmit: null,
      validFormSubmit: null,
      combinedLead: null,
      messageUser: null,
      messageConsult: null,
      messageOpen: null,
      messageLead: null,
      rowCount: 0,
      knownCounts: Object.fromEntries(NULLABLE_METRICS.map((metric) => [metric, 0])) as Record<
        NullableMetric,
        number
      >,
    };
  }

  private metrics(totals: MetricTotals): IXiaohongshuMetrics {
    const coverage: IXiaohongshuMetricCoverage = {
      landingPageVisit: this.coverage(totals.rowCount, totals.knownCounts.landingPageVisit),
      formImpression: this.coverage(totals.rowCount, totals.knownCounts.formImpression),
      formSubmit: this.coverage(totals.rowCount, totals.knownCounts.formSubmit),
      validFormSubmit: this.coverage(totals.rowCount, totals.knownCounts.validFormSubmit),
      combinedLead: this.coverage(totals.rowCount, totals.knownCounts.combinedLead),
      messageUser: this.coverage(totals.rowCount, totals.knownCounts.messageUser),
      messageConsult: this.coverage(totals.rowCount, totals.knownCounts.messageConsult),
      messageOpen: this.coverage(totals.rowCount, totals.knownCounts.messageOpen),
      messageLead: this.coverage(totals.rowCount, totals.knownCounts.messageLead),
    };
    return {
      fee: totals.fee,
      impression: totals.impression,
      click: totals.click,
      interaction: totals.interaction,
      like: totals.like,
      comment: totals.comment,
      collect: totals.collect,
      follow: totals.follow,
      share: totals.share,
      landingPageVisit: totals.landingPageVisit,
      formImpression: totals.formImpression,
      formSubmit: totals.formSubmit,
      validFormSubmit: totals.validFormSubmit,
      combinedLead: totals.combinedLead,
      messageUser: totals.messageUser,
      messageConsult: totals.messageConsult,
      messageOpen: totals.messageOpen,
      messageLead: totals.messageLead,
      messageConsultRate: this.ratio(totals.messageConsult, totals.click, coverage.messageConsult),
      messageOpenRate: this.ratio(
        totals.messageOpen,
        totals.messageConsult,
        coverage.messageOpen,
        coverage.messageConsult
      ),
      messageLeadRate: this.ratio(
        totals.messageLead,
        totals.messageOpen,
        coverage.messageLead,
        coverage.messageOpen
      ),
      messageConsultCost: this.ratio(totals.fee, totals.messageConsult, coverage.messageConsult),
      messageLeadCost: this.ratio(totals.fee, totals.messageLead, coverage.messageLead),
      landingPageVisitRate: this.ratio(
        totals.landingPageVisit,
        totals.click,
        coverage.landingPageVisit
      ),
      formImpressionRate: this.ratio(
        totals.formImpression,
        totals.landingPageVisit,
        coverage.formImpression,
        coverage.landingPageVisit
      ),
      formSubmitRate: this.ratio(
        totals.formSubmit,
        totals.formImpression,
        coverage.formSubmit,
        coverage.formImpression
      ),
      validFormSubmitRate: this.ratio(
        totals.validFormSubmit,
        totals.formSubmit,
        coverage.validFormSubmit,
        coverage.formSubmit
      ),
      formSubmitCost: this.ratio(totals.fee, totals.formSubmit, coverage.formSubmit),
      validFormSubmitCost: this.ratio(totals.fee, totals.validFormSubmit, coverage.validFormSubmit),
      metricCoverage: coverage,
      ctr: totals.impression ? totals.click / totals.impression : null,
      cpc: totals.click ? totals.fee / totals.click : null,
      cpm: totals.impression ? (totals.fee / totals.impression) * 1000 : null,
      cpi: totals.interaction ? totals.fee / totals.interaction : null,
      interactionRate: totals.impression ? totals.interaction / totals.impression : null,
      likeRate: totals.impression ? totals.like / totals.impression : null,
      collectRate: totals.impression ? totals.collect / totals.impression : null,
      commentRate: totals.impression ? totals.comment / totals.impression : null,
      followRate: totals.impression ? totals.follow / totals.impression : null,
      shareRate: totals.impression ? totals.share / totals.impression : null,
    };
  }

  private coverage(rowCount: number, knownCount: number): XiaohongshuMetricCoverageStatus {
    if (rowCount === 0 || knownCount === 0) return 'unavailable';
    return knownCount === rowCount ? 'full' : 'partial';
  }

  private ratio(
    numerator: number | null | undefined,
    denominator: number | null | undefined,
    ...coverage: XiaohongshuMetricCoverageStatus[]
  ): number | null {
    if (
      coverage.some((status) => status !== 'full') ||
      numerator === null ||
      numerator === undefined ||
      denominator === null ||
      denominator === undefined ||
      denominator === 0
    ) {
      return null;
    }
    return numerator / denominator;
  }

  private isNullableMetric(metric: string): metric is NullableMetric {
    return (NULLABLE_METRICS as readonly string[]).includes(metric);
  }

  private deltas(current: MetricTotals, previous: MetricTotals) {
    const fields = [
      'fee',
      'impression',
      'click',
      'interaction',
      'messageConsult',
      'messageLead',
      'formSubmit',
      'validFormSubmit',
    ] as const;
    return Object.fromEntries(
      fields.map((field) => {
        const currentValue = current[field] ?? 0;
        const previousValue = previous[field] ?? 0;
        const hasFullCoverage =
          !this.isNullableMetric(field) ||
          (this.coverage(current.rowCount, current.knownCounts[field]) === 'full' &&
            this.coverage(previous.rowCount, previous.knownCounts[field]) === 'full');
        return [
          field,
          {
            current: currentValue,
            previous: previousValue,
            changeRate:
              !hasFullCoverage || previousValue === 0
                ? null
                : (currentValue - previousValue) / previousValue,
          },
        ];
      })
    ) as IXiaohongshuSummaryResponse['deltas'];
  }

  private resolveRange(
    startDate?: string,
    endDate?: string
  ): { startDate: string; endDate: string } {
    if (Boolean(startDate) !== Boolean(endDate)) {
      throw new BadRequestException('startDate 与 endDate 必须同时提供或同时省略');
    }
    if (!startDate || !endDate) {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const value = this.dateString(yesterday);
      return { startDate: value, endDate: value };
    }
    const startTime = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const endTime = new Date(`${endDate}T00:00:00.000Z`).getTime();
    const days = Math.floor((endTime - startTime) / 86_400_000) + 1;
    if (days > 30) throw new BadRequestException('同步日期范围最多 30 天');
    return { startDate, endDate };
  }

  private mapSyncRun(row: {
    id: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    levels: Prisma.JsonValue;
    advertiserIds: Prisma.JsonValue;
    syncedRows: number;
    errors: Prisma.JsonValue;
    startedAt: Date;
    finishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): IXiaohongshuSyncRun {
    return {
      id: row.id,
      status: row.status as IXiaohongshuSyncRun['status'],
      startDate: row.startDate ? this.dateString(row.startDate) : null,
      endDate: row.endDate ? this.dateString(row.endDate) : null,
      levels: this.stringArray(row.levels) as XiaohongshuReportLevel[],
      advertiserIds: this.stringArray(row.advertiserIds),
      syncedRows: row.syncedRows,
      errors: Array.isArray(row.errors) ? (row.errors as unknown as SyncError[]) : [],
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private numberRecord(value: Prisma.JsonValue): Record<string, number> {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' && Number.isFinite(entry[1])
      )
    );
  }

  private syncReport(value: Prisma.JsonValue | null): IXiaohongshuSyncRunReport | null {
    if (!value || Array.isArray(value) || typeof value !== 'object') return null;
    const shardCount = value.shardCount;
    const succeeded = value.succeeded;
    const failed = value.failed;
    if (
      typeof shardCount !== 'number' ||
      typeof succeeded !== 'number' ||
      typeof failed !== 'number'
    ) {
      return null;
    }
    return { shardCount, succeeded, failed };
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private reportRawPayload(value: unknown): XiaohongshuReportRawPayload {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return value as XiaohongshuReportRawPayload;
  }

  private rawString(payload: XiaohongshuReportRawPayload, key: string): string | null {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  private date(value?: string): Date | undefined {
    return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
  }

  private dateString(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : '小红书同步失败';
    return message
      .replace(/(?:access|refresh)[_-]?token\s*[:=]\s*\S+/gi, '[credential redacted]')
      .slice(0, 500);
  }
}
