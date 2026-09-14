import { Prisma, type PrismaClient } from '@prisma/client';

import {
  GoogleClient,
  type GoogleSearchAnalyticsDimension,
  type GoogleSearchAnalyticsRow,
} from '../clients/google-client';

const SITE_DIMENSION_VALUE = '__SITE__';

export interface SyncGoogleResult {
  /** 三种维度 GSC 返回的原始行数合计 */
  fetched: number;
  /** SeoSearchQuery + SeoSearchPerformance 实际写入条数合计 */
  written: number;
  queryFetched: number;
  queryWritten: number;
  siteFetched: number;
  siteWritten: number;
  pageFetched: number;
  pageWritten: number;
  /** 时间窗口 */
  fromDate: string;
  toDate: string;
  /** GSC property URL（原样透传） */
  siteMatchedUrl: string;
}

export interface SyncGoogleOptions {
  prisma: PrismaClient;
  google: Pick<GoogleClient, 'querySearchAnalytics'>;
  /** GSC property URL（sc-domain: 前缀或 URL prefix） */
  siteUrl: string;
  /**
   * 落库时用的 siteUrl 字段（保持与 Bing 同表可查），一般是 `https://www.example.com`；
   * GSC 端的 `sc-domain:example.com` 是查询用的 property key，不适合直接落库展示。
   */
  storageSiteUrl: string;
  /** 拉取近 N 天数据（GSC 数据有 2-3 天延迟，一般拉近 3-7 天以获取完整数据） */
  numOfDays: number;
  dryRun: boolean;
  /** 允许 GSC 返回空数组算成功（新站初期数据未生成时） */
  allowEmptyResult: boolean;
}

/**
 * 拉取 Google Search Console 三种维度：
 * - query + date：写 seo_search_queries，只用于具名关键词诊断（会受 GSC 匿名化影响）；
 * - date：写 seo_search_performances(site)，作为整站 KPI 权威口径；
 * - page + date：写 seo_search_performances(page)，作为搜索落地页权威口径。
 *
 * GSC 数据延迟：搜索表现数据一般延迟 2-3 天，实时数据不准确；
 * 本函数拉近 numOfDays 天（含今天），按日拆分聚合、按 (source, siteUrl, statDate, query)
 * upsert——覆盖历史再拉的场景（今天拉 3 天前的数据可能会更新前几次的估算值）。
 */
export async function syncGoogle(opts: SyncGoogleOptions): Promise<SyncGoogleResult> {
  const toDate = todayBeijingDate();
  const fromDate = daysAgoBeijingDate(opts.numOfDays - 1);
  console.log(`[sync-google] 开始拉取 GSC 数据，site=${opts.siteUrl}, ${fromDate} ~ ${toDate}`);

  const queryRows = await opts.google.querySearchAnalytics(fromDate, toDate, ['query', 'date']);
  const siteRows = await opts.google.querySearchAnalytics(fromDate, toDate, ['date']);
  const pageRows = await opts.google.querySearchAnalytics(fromDate, toDate, ['page', 'date']);
  const fetched = queryRows.length + siteRows.length + pageRows.length;
  console.log(
    `[sync-google] GSC 返回 query=${queryRows.length}, site=${siteRows.length}, page=${pageRows.length}`
  );

  if (fetched === 0) {
    if (!opts.allowEmptyResult) {
      throw new Error(
        `[sync-google] Search Analytics 返回 0 行（site=${opts.siteUrl}, ${fromDate} ~ ${toDate}）。` +
          `可能原因：(a) property 刚验证，GSC 首批数据处理需 24-48h；` +
          `(b) 时段内无搜索表现（曝光=0）；(c) SA 未加入 property 的 user 列表；` +
          `(d) siteUrl 与 GSC 后台 property 拼写不完全一致。` +
          `新站灰度期请设 SEO_GOOGLE_ALLOW_EMPTY_RESULT=true 暂时跳过此校验。`
      );
    }
    return {
      fetched: 0,
      written: 0,
      queryFetched: 0,
      queryWritten: 0,
      siteFetched: 0,
      siteWritten: 0,
      pageFetched: 0,
      pageWritten: 0,
      fromDate,
      toDate,
      siteMatchedUrl: opts.siteUrl,
    };
  }

  const parsedQueries: ParsedSearchRow[] = [];
  let querySkipped = 0;
  for (const row of queryRows) {
    const query = row.keys?.[0];
    const statDate = row.keys?.[1];
    if (!query || !statDate) {
      querySkipped += 1;
      continue;
    }
    parsedQueries.push({
      query: query.slice(0, 500),
      statDate,
      ...toMetrics(row),
    });
  }
  if (querySkipped > 0) {
    console.warn(`[sync-google] query ${querySkipped} 行因缺 keys 被跳过`);
  }

  const parsedSite = parsePerformanceRows(siteRows, 'site', ['date']);
  const parsedPages = parsePerformanceRows(pageRows, 'page', ['page', 'date']);

  if (opts.dryRun) {
    console.log('[sync-google] dry-run 模式，跳过写入');
    return {
      fetched,
      written: 0,
      queryFetched: queryRows.length,
      queryWritten: 0,
      siteFetched: siteRows.length,
      siteWritten: 0,
      pageFetched: pageRows.length,
      pageWritten: 0,
      fromDate,
      toDate,
      siteMatchedUrl: opts.siteUrl,
    };
  }

  let queryWritten = 0;
  for (const row of parsedQueries) {
    await opts.prisma.seoSearchQuery.upsert({
      where: {
        uniq_seo_search_query: {
          source: 'google',
          siteUrl: opts.storageSiteUrl,
          statDate: new Date(`${row.statDate}T00:00:00+08:00`),
          query: row.query,
        },
      },
      create: {
        source: 'google',
        siteUrl: opts.storageSiteUrl,
        statDate: new Date(`${row.statDate}T00:00:00+08:00`),
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        avgPosition: row.position,
        ctr: row.ctr,
        rawPayload: row.raw as Prisma.InputJsonValue,
      },
      update: {
        clicks: row.clicks,
        impressions: row.impressions,
        avgPosition: row.position,
        ctr: row.ctr,
        rawPayload: row.raw as Prisma.InputJsonValue,
      },
    });
    queryWritten += 1;
  }

  let siteWritten = 0;
  for (const row of parsedSite) {
    await upsertPerformance(opts.prisma, opts.storageSiteUrl, row);
    siteWritten += 1;
  }

  let pageWritten = 0;
  for (const row of parsedPages) {
    await upsertPerformance(opts.prisma, opts.storageSiteUrl, row);
    pageWritten += 1;
  }

  const written = queryWritten + siteWritten + pageWritten;
  console.log(
    `[sync-google] 写入完成 query=${queryWritten}, site=${siteWritten}, page=${pageWritten}`
  );
  return {
    fetched,
    written,
    queryFetched: queryRows.length,
    queryWritten,
    siteFetched: siteRows.length,
    siteWritten,
    pageFetched: pageRows.length,
    pageWritten,
    fromDate,
    toDate,
    siteMatchedUrl: opts.siteUrl,
  };
}

interface SearchMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  raw: GoogleSearchAnalyticsRow;
}

interface ParsedSearchRow extends SearchMetrics {
  query: string;
  statDate: string;
}

interface ParsedPerformanceRow extends SearchMetrics {
  dimension: 'site' | 'page';
  dimensionValue: string;
  statDate: string;
}

function toMetrics(row: GoogleSearchAnalyticsRow): SearchMetrics {
  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: typeof row.ctr === 'number' ? Math.round(row.ctr * 10000) / 10000 : 0,
    position: typeof row.position === 'number' ? row.position : null,
    raw: row,
  };
}

function parsePerformanceRows(
  rows: GoogleSearchAnalyticsRow[],
  dimension: 'site' | 'page',
  dimensions: GoogleSearchAnalyticsDimension[]
): ParsedPerformanceRow[] {
  const dateIndex = dimensions.indexOf('date');
  const valueIndex = dimensions.indexOf('page');
  const parsed: ParsedPerformanceRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const statDate = dateIndex >= 0 ? row.keys?.[dateIndex] : undefined;
    const rawValue = dimension === 'site' ? SITE_DIMENSION_VALUE : row.keys?.[valueIndex];
    if (!statDate || !rawValue) {
      skipped += 1;
      continue;
    }
    parsed.push({
      dimension,
      dimensionValue: rawValue.slice(0, 500),
      statDate,
      ...toMetrics(row),
    });
  }

  if (skipped > 0) {
    console.warn(`[sync-google] ${dimension} ${skipped} 行因缺 keys 被跳过`);
  }
  return parsed;
}

async function upsertPerformance(
  prisma: PrismaClient,
  storageSiteUrl: string,
  row: ParsedPerformanceRow
): Promise<void> {
  const statDate = new Date(`${row.statDate}T00:00:00+08:00`);
  await prisma.seoSearchPerformance.upsert({
    where: {
      uniq_seo_search_performance: {
        source: 'google',
        siteUrl: storageSiteUrl,
        statDate,
        dimension: row.dimension,
        dimensionValue: row.dimensionValue,
      },
    },
    create: {
      source: 'google',
      siteUrl: storageSiteUrl,
      statDate,
      dimension: row.dimension,
      dimensionValue: row.dimensionValue,
      clicks: row.clicks,
      impressions: row.impressions,
      avgPosition: row.position,
      ctr: row.ctr,
      rawPayload: row.raw as Prisma.InputJsonValue,
    },
    update: {
      clicks: row.clicks,
      impressions: row.impressions,
      avgPosition: row.position,
      ctr: row.ctr,
      rawPayload: row.raw as Prisma.InputJsonValue,
    },
  });
}

/** 按 Asia/Shanghai 时区取今天日期 YYYY-MM-DD */
function todayBeijingDate(): string {
  return beijingDate(new Date());
}

/** 按 Asia/Shanghai 时区取 N 天前日期 */
function daysAgoBeijingDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return beijingDate(d);
}

function beijingDate(d: Date): string {
  // 直接用 Intl 格式化到 Asia/Shanghai
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${day}`;
}
