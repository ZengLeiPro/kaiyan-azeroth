import {
  WEB_ANALYTICS_CONSULT_CHANNEL_CLICK_EVENTS,
  WEB_ANALYTICS_FUNNEL_STAGES,
  WEB_ANALYTICS_LEAD_SUBMIT_EVENTS,
  WEB_ANALYTICS_PAGEVIEW_EVENT,
  type WebAnalyticsBreakdownDimension,
} from '@ky-azeroth/shared/constants';
import type { WebAnalyticsFiltersInput } from '@ky-azeroth/shared/schemas';
import type {
  IWebAnalyticsAttributionResponse,
  IWebAnalyticsBreakdownResponse,
  IWebAnalyticsCampaignConversionResponse,
  IWebAnalyticsContentItem,
  IWebAnalyticsContentResponse,
  IWebAnalyticsEngineLandingMatrixResponse,
  IWebAnalyticsEngineLandingRow,
  IWebAnalyticsEventRow,
  IWebAnalyticsFilterOption,
  IWebAnalyticsFilterOptionsResponse,
  IWebAnalyticsFunnelResponse,
  IWebAnalyticsLandingPageItem,
  IWebAnalyticsLandingPagesResponse,
  IWebAnalyticsLeadItem,
  IWebAnalyticsLeadRadarResponse,
  IWebAnalyticsSearchKeywordsResponse,
  IWebAnalyticsSummaryResponse,
  IWebAnalyticsTrendResponse,
  IWebAnalyticsVisitorTypeResponse,
} from '@ky-azeroth/shared/types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  QueryWebAnalyticsAttributionDto,
  QueryWebAnalyticsBreakdownDto,
  QueryWebAnalyticsCampaignConversionDto,
  QueryWebAnalyticsContentDto,
  QueryWebAnalyticsEngineLandingMatrixDto,
  QueryWebAnalyticsEventsDto,
  QueryWebAnalyticsFilterOptionsDto,
  QueryWebAnalyticsFunnelDto,
  QueryWebAnalyticsLandingPagesDto,
  QueryWebAnalyticsLeadRadarDto,
  QueryWebAnalyticsSearchKeywordsDto,
  QueryWebAnalyticsSummaryDto,
  QueryWebAnalyticsTrendDto,
  QueryWebAnalyticsVisitorTypeDto,
} from './dto';
import { buildKnownAutomationExclusion } from './web-analytics-traffic-quality';

const CONSULT_CHANNEL_CLICK_EVENTS = [...WEB_ANALYTICS_CONSULT_CHANNEL_CLICK_EVENTS];
const LEAD_SUBMIT_EVENTS = [...WEB_ANALYTICS_LEAD_SUBMIT_EVENTS];
const ROUND_2 = (n: number): number => Math.round(n * 100) / 100;

// search_engine：从 ref_host 派生搜索引擎分类（SEO 第一关心的「各引擎带多少量」）。
// 固定枚举映射，无用户输入拼接，沿用 DIMENSION_SQL 的安全模式。
//
// 抽成工厂函数：DIMENSION_SQL 用 `e.ref_host`（events 主表），但 getEngineLandingMatrix
// 需在 landing CTE 上派生（列名 `ref_host` 无表前缀），所以接受 ref_host 列表达式入参。
function buildSearchEngineSql(refHostCol: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    CASE
      WHEN ${refHostCol} IS NULL OR ${refHostCol} = '' THEN '(直接访问)'
      WHEN ${refHostCol} ILIKE '%baidu.%' THEN '百度'
      WHEN ${refHostCol} ILIKE '%google.%' THEN 'Google'
      WHEN ${refHostCol} ILIKE '%bing.%' THEN '必应'
      WHEN ${refHostCol} ILIKE '%so.com%' OR ${refHostCol} ILIKE '%360.cn%' OR ${refHostCol} ILIKE '%haosou.%' THEN '360搜索'
      WHEN ${refHostCol} ILIKE '%sogou.%' OR ${refHostCol} ILIKE '%sogo.%' THEN '搜狗'
      WHEN ${refHostCol} ILIKE '%sm.cn%' THEN '神马'
      WHEN ${refHostCol} ILIKE '%yandex.%' THEN 'Yandex'
      WHEN ${refHostCol} ILIKE '%duckduckgo.%' THEN 'DuckDuckGo'
      WHEN ${refHostCol} ILIKE '%toutiao.%' OR ${refHostCol} ILIKE '%bytedance.%' THEN '头条搜索'
      ELSE '其他来源'
    END
  `;
}
const SEARCH_ENGINE_SQL = buildSearchEngineSql(Prisma.sql`e.ref_host`);

const DIMENSION_SQL: Record<WebAnalyticsBreakdownDimension, Prisma.Sql> = {
  search_engine: SEARCH_ENGINE_SQL,
  utm_source: Prisma.sql`e.utm_source`,
  utm_medium: Prisma.sql`e.utm_medium`,
  utm_campaign: Prisma.sql`e.utm_campaign`,
  utm_term: Prisma.sql`e.utm_term`,
  utm_content: Prisma.sql`e.utm_content`,
  ref_host: Prisma.sql`e.ref_host`,
  path: Prisma.sql`e.path`,
  page_type: Prisma.sql`e.page_type`,
  placement: Prisma.sql`e.placement`,
  channel: Prisma.sql`e.channel`,
  device: Prisma.sql`e.device`,
  browser: Prisma.sql`e.browser`,
  os: Prisma.sql`e.os`,
  country: Prisma.sql`e.country`,
  region: Prisma.sql`e.region`,
  city: Prisma.sql`e.city`,
  isp: Prisma.sql`e.isp`,
  lang: Prisma.sql`e.lang`,
};

const OPTION_COLUMNS = {
  sites: Prisma.sql`e.site`,
  pageTypes: Prisma.sql`e.page_type`,
  events: Prisma.sql`e.event`,
  utmSources: Prisma.sql`e.utm_source`,
  refHosts: Prisma.sql`e.ref_host`,
  placements: Prisma.sql`e.placement`,
  channels: Prisma.sql`e.channel`,
} satisfies Record<keyof IWebAnalyticsFilterOptionsResponse, Prisma.Sql>;

const EVENT_SORT_SQL: Record<string, Prisma.Sql> = {
  receivedAt: Prisma.sql`e.received_at`,
  clientTs: Prisma.sql`e.client_ts`,
  site: Prisma.sql`e.site`,
  event: Prisma.sql`e.event`,
  path: Prisma.sql`e.path`,
  pageType: Prisma.sql`e.page_type`,
  refHost: Prisma.sql`e.ref_host`,
  placement: Prisma.sql`e.placement`,
  channel: Prisma.sql`e.channel`,
};

interface SummaryRawRow {
  pv: number | string | null;
  uv: number | string | null;
  sessions: number | string | null;
  consult_clicks: number | string | null;
  consult_channel_clicks: number | string | null;
  consult_sessions: number | string | null;
  lead_submits: number | string | null;
  lead_sessions: number | string | null;
  resource_downloads: number | string | null;
  last_event_at: Date | string | null;
  title_coverage: number | string | null;
  ref_host_coverage: number | string | null;
  utm_source_coverage: number | string | null;
  utm_campaign_coverage: number | string | null;
  bounce_sessions: number | string | null;
  avg_pages_per_session: number | string | null;
  avg_session_duration_sec: number | string | null;
}

interface TrendRawRow {
  date: string;
  pv: number | string | null;
  uv: number | string | null;
  sessions: number | string | null;
  consults: number | string | null;
  leads: number | string | null;
}

interface BreakdownRawRow {
  value: string | null;
  count: number | string | null;
}

interface FunnelRawRow {
  sessions: number | string | null;
  consult_cta_click: number | string | null;
  consult_modal_open: number | string | null;
  consult_channel_click: number | string | null;
  lead_submit: number | string | null;
}

interface AttributionRawRow {
  source: string | null;
  medium: string | null;
  landing_path: string | null;
  sessions: number | string | null;
  consult_sessions: number | string | null;
  lead_sessions: number | string | null;
}

interface EventRawRow {
  id: string;
  received_at: Date | string;
  client_ts: Date | string | null;
  site: string;
  event: string;
  vid: string | null;
  sid: string | null;
  path: string | null;
  page_type: string | null;
  title: string | null;
  referrer: string | null;
  ref_host: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  placement: string | null;
  channel: string | null;
  label: string | null;
  is_bot: boolean;
  screen: string | null;
  lang: string | null;
  ip: string | null;
}

interface ContentRawRow {
  path: string;
  title: string | null;
  pv: number | string | null;
  uv: number | string | null;
  reach25: number | string | null;
  reach50: number | string | null;
  reach75: number | string | null;
  reach100: number | string | null;
  dwell30: number | string | null;
  dwell60: number | string | null;
  dwell180: number | string | null;
  /** 精确平均滚动深度（NULL 表示无 pct 数据，按 numeric 返回为 string） */
  avg_scroll_pct_exact: number | string | null;
  exact_pct_event_count: number | string | null;
}

interface LandingPageRawRow {
  landing_path: string;
  title: string | null;
  entry_sessions: number | string | null;
  bounce_sessions: number | string | null;
  consult_sessions: number | string | null;
  lead_sessions: number | string | null;
}

interface EngineLandingMatrixRawRow {
  landing_path: string;
  title: string | null;
  engine: string;
  sessions: number | string | null;
  total_sessions: number | string | null;
}

interface CampaignConversionRawRow {
  campaign: string | null;
  sessions: number | string | null;
  consult_sessions: number | string | null;
  lead_sessions: number | string | null;
}

interface VisitorTypeRawRow {
  new_visitors: number | string | null;
  returning_visitors: number | string | null;
}

interface SearchKeywordRawRow {
  keyword: string | null;
  count: number | string | null;
}

function normalizeSearchKeyword(raw: string): string {
  const plusAsSpace = raw.replace(/\+/g, ' ');

  try {
    return decodeURIComponent(plusAsSpace).trim();
  } catch {
    return plusAsSpace.trim();
  }
}

interface LeadRawRow {
  ip: string;
  sessions: number | string | null;
  pageviews: number | string | null;
  distinct_pages: number | string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  has_consult: boolean;
  has_lead: boolean;
  last_seen: Date | string;
}

interface TotalRawRow {
  total: number | string | null;
}

export function buildWebAnalyticsWhere(query: WebAnalyticsFiltersInput): Prisma.Sql {
  const startDate = toBeijingDayStart(query.startDate);
  const endDate = toBeijingNextDayStart(query.endDate);
  const conditions: Prisma.Sql[] = [
    Prisma.sql`e.received_at >= ${startDate}`,
    Prisma.sql`e.received_at < ${endDate}`,
  ];

  if (query.site) conditions.push(Prisma.sql`e.site = ${query.site}`);
  if (query.vid) conditions.push(Prisma.sql`e.vid = ${query.vid}`);
  appendArrayCondition(conditions, Prisma.sql`e.event`, query.events);
  appendArrayCondition(conditions, Prisma.sql`e.page_type`, query.pageTypes);
  appendArrayCondition(conditions, Prisma.sql`e.utm_source`, query.utmSources);
  appendArrayCondition(conditions, Prisma.sql`e.ref_host`, query.refHosts);
  appendArrayCondition(conditions, Prisma.sql`e.placement`, query.placements);
  appendArrayCondition(conditions, Prisma.sql`e.channel`, query.channels);

  const pathSearch = query.pathSearch?.trim();
  if (pathSearch) {
    conditions.push(Prisma.sql`e.path ILIKE ${`%${escapeLike(pathSearch)}%`} ESCAPE '\\'`);
  }

  if (!query.includeBots) {
    conditions.push(Prisma.sql`e.is_bot = false`);
    conditions.push(buildKnownAutomationExclusion(startDate, endDate));
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

@Injectable()
export class WebAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(query: QueryWebAnalyticsSummaryDto): Promise<IWebAnalyticsSummaryResponse> {
    const previousRange = getPreviousRange(query.startDate, query.endDate);
    const [rows, previousRows] = await Promise.all([
      this.querySummary(buildWebAnalyticsWhere(query)),
      this.querySummary(
        buildWebAnalyticsWhere({
          ...query,
          startDate: previousRange.startDate,
          endDate: previousRange.endDate,
        })
      ),
    ]);

    const row = rows[0] ?? ({} as SummaryRawRow);
    const previousRow = previousRows[0] ?? ({} as SummaryRawRow);
    const sessions = num(row.sessions);
    const consultSessions = num(row.consult_sessions);
    const leadSessions = num(row.lead_sessions);
    const bounceSessions = num(row.bounce_sessions);

    return {
      range: rangeMeta(query),
      pv: num(row.pv),
      uv: num(row.uv),
      sessions,
      consultClicks: num(row.consult_clicks),
      consultChannelClicks: num(row.consult_channel_clicks),
      consultSessions,
      leadSubmits: num(row.lead_submits),
      leadSessions,
      resourceDownloads: num(row.resource_downloads),
      lastEventAt: iso(row.last_event_at),
      dataQuality: {
        titleCoverage: ROUND_2(num(row.title_coverage)),
        refHostCoverage: ROUND_2(num(row.ref_host_coverage)),
        utmSourceCoverage: ROUND_2(num(row.utm_source_coverage)),
        utmCampaignCoverage: ROUND_2(num(row.utm_campaign_coverage)),
      },
      comparison: {
        previousRange,
        pvChangeRate: changeRate(num(row.pv), num(previousRow.pv)),
        uvChangeRate: changeRate(num(row.uv), num(previousRow.uv)),
        sessionsChangeRate: changeRate(num(row.sessions), num(previousRow.sessions)),
        leadSubmitsChangeRate: changeRate(num(row.lead_submits), num(previousRow.lead_submits)),
      },
      sessionConversionRate: sessions > 0 ? ROUND_2((leadSessions / sessions) * 100) : 0,
      bounceRate: sessions > 0 ? ROUND_2((bounceSessions / sessions) * 100) : 0,
      avgPagesPerSession: ROUND_2(num(row.avg_pages_per_session)),
      avgSessionDurationSec: Math.round(num(row.avg_session_duration_sec)),
    };
  }

  private querySummary(where: Prisma.Sql): Promise<SummaryRawRow[]> {
    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为官网埋点只读聚合需全限定名跨 schema 查询
    return this.prisma.$queryRaw<SummaryRawRow[]>`
      WITH filtered AS (
        SELECT e.*
        FROM web_analytics.events e
        ${where}
      ),
      session_stats AS (
        SELECT
          sid,
          COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS pageviews,
          BOOL_OR(event = 'consult_cta_click') AS has_consult,
          BOOL_OR(event = ANY(${LEAD_SUBMIT_EVENTS}::text[])) AS has_lead,
          EXTRACT(EPOCH FROM (MAX(received_at) - MIN(received_at)))::int AS duration_sec
        FROM filtered
        WHERE sid IS NOT NULL
        GROUP BY sid
      )
      SELECT
        COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS pv,
        COUNT(DISTINCT vid) FILTER (
          WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND vid IS NOT NULL
        )::int AS uv,
        COALESCE((SELECT COUNT(*)::int FROM session_stats), 0)::int AS sessions,
        COUNT(*) FILTER (WHERE event = 'consult_cta_click')::int AS consult_clicks,
        COUNT(*) FILTER (WHERE event = ANY(${CONSULT_CHANNEL_CLICK_EVENTS}::text[]))::int
          AS consult_channel_clicks,
        COALESCE((SELECT COUNT(*)::int FROM session_stats WHERE has_consult), 0)::int
          AS consult_sessions,
        COUNT(*) FILTER (WHERE event = ANY(${LEAD_SUBMIT_EVENTS}::text[]))::int AS lead_submits,
        COALESCE((SELECT COUNT(*)::int FROM session_stats WHERE has_lead), 0)::int AS lead_sessions,
        COUNT(*) FILTER (WHERE event = 'resource_download')::int AS resource_downloads,
        MAX(received_at) AS last_event_at,
        COALESCE(100.0 * COUNT(*) FILTER (
          WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND title IS NOT NULL AND title <> ''
        ) / NULLIF(COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}), 0), 0)::float
          AS title_coverage,
        COALESCE(100.0 * COUNT(*) FILTER (
          WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND ref_host IS NOT NULL AND ref_host <> ''
        ) / NULLIF(COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}), 0), 0)::float
          AS ref_host_coverage,
        COALESCE(100.0 * COUNT(*) FILTER (
          WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND utm_source IS NOT NULL AND utm_source <> ''
        ) / NULLIF(COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}), 0), 0)::float
          AS utm_source_coverage,
        COALESCE(100.0 * COUNT(*) FILTER (
          WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND utm_campaign IS NOT NULL AND utm_campaign <> ''
        ) / NULLIF(COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}), 0), 0)::float
          AS utm_campaign_coverage,
        COALESCE((SELECT COUNT(*)::int FROM session_stats WHERE pageviews = 1), 0)::int
          AS bounce_sessions,
        COALESCE((SELECT AVG(pageviews) FROM session_stats), 0)::float AS avg_pages_per_session,
        COALESCE((SELECT AVG(duration_sec) FROM session_stats), 0)::float AS avg_session_duration_sec
      FROM filtered
    `;
  }

  async getTrend(query: QueryWebAnalyticsTrendDto): Promise<IWebAnalyticsTrendResponse> {
    const where = buildWebAnalyticsWhere(query);

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为趋势按北京时间日聚合需 raw SQL 表达式
    const rows = await this.prisma.$queryRaw<TrendRawRow[]>`
      SELECT
        to_char(e.received_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date,
        COUNT(*) FILTER (WHERE e.event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS pv,
        COUNT(DISTINCT e.vid) FILTER (
          WHERE e.event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND e.vid IS NOT NULL
        )::int AS uv,
        COUNT(DISTINCT e.sid) FILTER (WHERE e.sid IS NOT NULL)::int AS sessions,
        COUNT(*) FILTER (WHERE e.event = 'consult_cta_click')::int AS consults,
        COUNT(*) FILTER (WHERE e.event = ANY(${LEAD_SUBMIT_EVENTS}::text[]))::int AS leads
      FROM web_analytics.events e
      ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    return {
      range: rangeMeta(query),
      points: rows.map((row) => ({
        date: row.date,
        pv: num(row.pv),
        uv: num(row.uv),
        sessions: num(row.sessions),
        consults: num(row.consults),
        leads: num(row.leads),
      })),
    };
  }

  async getBreakdown(
    query: QueryWebAnalyticsBreakdownDto
  ): Promise<IWebAnalyticsBreakdownResponse> {
    const where = buildWebAnalyticsWhere(query);
    const dimension = DIMENSION_SQL[query.dimension];

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为动态维度排行由固定枚举映射到安全 SQL 片段
    const rows = await this.prisma.$queryRaw<BreakdownRawRow[]>`
      WITH filtered AS (
        SELECT ${dimension} AS value
        FROM web_analytics.events e
        ${where}
      )
      SELECT COALESCE(NULLIF(value, ''), '(未填)') AS value, COUNT(*)::int AS count
      FROM filtered
      GROUP BY 1
      ORDER BY count DESC, value ASC
      LIMIT ${query.limit}
    `;

    const total = rows.reduce((sum, row) => sum + num(row.count), 0);

    return {
      dimension: query.dimension,
      items: rows.map((row) => {
        const count = num(row.count);
        const label = row.value ?? '(未填)';
        return {
          key: label,
          label,
          count,
          percentage: total > 0 ? ROUND_2((count / total) * 100) : 0,
        };
      }),
    };
  }

  async getFunnel(query: QueryWebAnalyticsFunnelDto): Promise<IWebAnalyticsFunnelResponse> {
    const where = buildWebAnalyticsWhere(query);

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为咨询漏斗需要按事件集合做 DISTINCT sid 聚合
    const rows = await this.prisma.$queryRaw<FunnelRawRow[]>`
      SELECT
        COUNT(DISTINCT e.sid) FILTER (WHERE e.sid IS NOT NULL)::int AS sessions,
        COUNT(DISTINCT e.sid) FILTER (
          WHERE e.sid IS NOT NULL AND e.event = 'consult_cta_click'
        )::int AS consult_cta_click,
        COUNT(DISTINCT e.sid) FILTER (
          WHERE e.sid IS NOT NULL AND e.event = 'consult_modal_open'
        )::int AS consult_modal_open,
        COUNT(DISTINCT e.sid) FILTER (
          WHERE e.sid IS NOT NULL AND e.event = ANY(${CONSULT_CHANNEL_CLICK_EVENTS}::text[])
        )::int AS consult_channel_click,
        COUNT(DISTINCT e.sid) FILTER (
          WHERE e.sid IS NOT NULL AND e.event = ANY(${LEAD_SUBMIT_EVENTS}::text[])
        )::int AS lead_submit
      FROM web_analytics.events e
      ${where}
    `;

    const row = rows[0] ?? ({} as FunnelRawRow);
    const counts = {
      sessions: num(row.sessions),
      consult_cta_click: num(row.consult_cta_click),
      consult_modal_open: num(row.consult_modal_open),
      consult_channel_click: num(row.consult_channel_click),
      lead_submit: num(row.lead_submit),
    };
    const base = counts.sessions;
    let previous = base;

    return {
      range: rangeMeta(query),
      stages: WEB_ANALYTICS_FUNNEL_STAGES.map((stage) => {
        const count = counts[stage.key];
        const stepRate = previous > 0 ? ROUND_2((count / previous) * 100) : 0;
        previous = count;
        return {
          key: stage.key,
          label: stage.label,
          count,
          rate: base > 0 ? ROUND_2((count / base) * 100) : 0,
          stepRate,
        };
      }),
    };
  }

  async getAttribution(
    query: QueryWebAnalyticsAttributionDto
  ): Promise<IWebAnalyticsAttributionResponse> {
    const where = buildWebAnalyticsWhere(query);

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为sid 首触点归因需 DISTINCT ON + consult 会话聚合
    const rows = await this.prisma.$queryRaw<AttributionRawRow[]>`
      WITH filtered AS (
        SELECT e.*
        FROM web_analytics.events e
        ${where}
      ),
      first_touch AS (
        SELECT DISTINCT ON (sid)
          sid,
          COALESCE(NULLIF(utm_source, ''), NULLIF(ref_host, ''), '(direct)') AS source,
          COALESCE(
            NULLIF(utm_medium, ''),
            CASE WHEN ref_host IS NULL OR ref_host = '' THEN '(none)' ELSE 'referral' END
          ) AS medium,
          COALESCE(NULLIF(path, ''), '/') AS landing_path
        FROM filtered
        WHERE sid IS NOT NULL AND event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
        ORDER BY sid, received_at ASC, id ASC
      ),
      conversion_sessions AS (
        SELECT
          sid,
          BOOL_OR(event = 'consult_cta_click') AS has_consult,
          BOOL_OR(event = ANY(${LEAD_SUBMIT_EVENTS}::text[])) AS has_lead
        FROM filtered
        WHERE sid IS NOT NULL
        GROUP BY sid
      )
      SELECT
        ft.source,
        ft.medium,
        ft.landing_path,
        COUNT(*)::int AS sessions,
        COUNT(*) FILTER (WHERE cs.has_consult)::int AS consult_sessions,
        COUNT(*) FILTER (WHERE cs.has_lead)::int AS lead_sessions
      FROM first_touch ft
      LEFT JOIN conversion_sessions cs ON cs.sid = ft.sid
      GROUP BY ft.source, ft.medium, ft.landing_path
      ORDER BY lead_sessions DESC, consult_sessions DESC, sessions DESC, ft.source ASC
      LIMIT ${query.limit}
    `;

    return {
      range: rangeMeta(query),
      items: rows.map((row) => {
        const sessions = num(row.sessions);
        const consultSessions = num(row.consult_sessions);
        const leadSessions = num(row.lead_sessions);
        return {
          source: row.source ?? '(direct)',
          medium: row.medium ?? '(none)',
          landingPath: row.landing_path ?? '/',
          sessions,
          consultSessions,
          leadSessions,
          conversionRate: sessions > 0 ? ROUND_2((leadSessions / sessions) * 100) : 0,
        };
      }),
    };
  }

  async findEvents(
    query: QueryWebAnalyticsEventsDto
  ): Promise<PaginatedResponse<IWebAnalyticsEventRow>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const offset = (page - 1) * pageSize;
    const where = buildWebAnalyticsWhere(query);
    const orderBy = EVENT_SORT_SQL[query.sortBy ?? 'receivedAt'] ?? EVENT_SORT_SQL.receivedAt;
    const direction = query.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const [items, totalRows] = await Promise.all([
      // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为事件明细分页需读取独立 schema 且 id 显式规避 BigInt
      this.prisma.$queryRaw<EventRawRow[]>`
        SELECT
          e.id::text AS id,
          e.received_at,
          e.client_ts,
          e.site,
          e.event,
          e.vid,
          e.sid,
          e.path,
          e.page_type,
          e.title,
          e.referrer,
          e.ref_host,
          e.utm_source,
          e.utm_medium,
          e.utm_campaign,
          e.placement,
          e.channel,
          e.label,
          e.is_bot,
          e.screen,
          e.lang,
          e.ip
        FROM web_analytics.events e
        ${where}
        ORDER BY ${orderBy} ${direction}, e.id ${direction}
        LIMIT ${pageSize}
        OFFSET ${offset}
      `,
      // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为分页总数 COUNT 必须 ::int 规避 BigInt
      this.prisma.$queryRaw<TotalRawRow[]>`
        SELECT COUNT(*)::int AS total
        FROM web_analytics.events e
        ${where}
      `,
    ]);

    const total = num(totalRows[0]?.total);
    return {
      items: items.map(toEventRow),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getFilterOptions(
    query: QueryWebAnalyticsFilterOptionsDto
  ): Promise<IWebAnalyticsFilterOptionsResponse> {
    const entries = await Promise.all(
      Object.entries(OPTION_COLUMNS).map(async ([key, column]) => {
        const rows = await this.queryOptionRows(query, column);
        return [key, rows] as const;
      })
    );

    return Object.fromEntries(entries) as unknown as IWebAnalyticsFilterOptionsResponse;
  }

  /**
   * 博客内容质量榜：按 path 聚合 pageview 与 article_read / article_dwell 事件，
   * 输出每篇文章 PV/UV、滚动深度档位、停留档位、读完率、平均滚动深度、深读率。
   *
   * 关键口径：
   * - 滚动/停留来自「里程碑事件」（25/50/75/100% · 30/60/180s），是档位估算非连续精确值。
   * - 2026-06-13 起 beacon 透传精确 pct（仅 article_read_* 事件，落 raw JSONB）。
   *   存量旧事件无 pct，所以同时输出 avgScrollDepth（档位加权估算，全量可用）
   *   + avgScrollPctExact（AVG raw->>'pct'，前端有值时优先展示）。
   * - 剥离 query.events 过滤：本视图自管事件范围（pageview + article_*），不受全局事件筛选影响。
   * - reach/dwell 是累进计数（reach25 ≥ reach50 ≥ reach75 ≥ reach100），由 ArticleObserver 各档只触发一次保证。
   */
  async getContentEngagement(
    query: QueryWebAnalyticsContentDto
  ): Promise<IWebAnalyticsContentResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为内容互动需 pageview 与 article 事件按 path 联合聚合
    const rows = await this.prisma.$queryRaw<ContentRawRow[]>`
      WITH base AS (
        SELECT e.path, e.event, e.vid, e.title, e.raw
        FROM web_analytics.events e
        ${where}
          AND e.path IS NOT NULL AND e.path <> ''
          AND (e.event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} OR e.event LIKE 'article%')
      )
      SELECT
        path,
        MAX(title) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT} AND title IS NOT NULL AND title <> '') AS title,
        COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS pv,
        COUNT(DISTINCT vid) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS uv,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_read_25')::int AS reach25,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_read_50')::int AS reach50,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_read_75')::int AS reach75,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_read_100')::int AS reach100,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_dwell_30s')::int AS dwell30,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_dwell_60s')::int AS dwell60,
        COUNT(DISTINCT vid) FILTER (WHERE event = 'article_dwell_180s')::int AS dwell180,
        AVG((raw->>'pct')::numeric) FILTER (
          WHERE event LIKE 'article_read_%' AND raw ? 'pct'
        ) AS avg_scroll_pct_exact,
        COUNT(*) FILTER (
          WHERE event LIKE 'article_read_%' AND raw ? 'pct'
        )::int AS exact_pct_event_count
      FROM base
      GROUP BY path
      HAVING COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}) > 0
      ORDER BY pv DESC, path ASC
      LIMIT ${query.limit}
    `;

    return {
      range: rangeMeta(query),
      items: rows.map((row): IWebAnalyticsContentItem => {
        const pv = num(row.pv);
        const uv = num(row.uv);
        const reach25 = num(row.reach25);
        const reach50 = num(row.reach50);
        const reach75 = num(row.reach75);
        const reach100 = num(row.reach100);
        const dwell30 = num(row.dwell30);
        const dwell60 = num(row.dwell60);
        const dwell180 = num(row.dwell180);

        // 平均滚动深度（%）：档位人数加权，分母为「至少滚动过 25% 的访客」
        const exact25 = Math.max(0, reach25 - reach50);
        const exact50 = Math.max(0, reach50 - reach75);
        const exact75 = Math.max(0, reach75 - reach100);
        const weighted = 25 * exact25 + 50 * exact50 + 75 * exact75 + 100 * reach100;
        const avgScrollDepth = reach25 > 0 ? ROUND_2(weighted / reach25) : 0;

        // 精确平均滚动深度（%）：直接 AVG raw.pct。SQL 端 NULL（无 pct 事件）→ null。
        const exactPctEventCount = num(row.exact_pct_event_count);
        const avgScrollPctExact =
          row.avg_scroll_pct_exact == null ? null : ROUND_2(Number(row.avg_scroll_pct_exact));

        const cap = (n: number): number => Math.min(100, ROUND_2(n));

        return {
          path: row.path,
          title: row.title ?? null,
          pv,
          uv,
          reach25,
          reach50,
          reach75,
          reach100,
          dwell30,
          dwell60,
          dwell180,
          completionRate: uv > 0 ? cap((reach100 / uv) * 100) : 0,
          avgScrollDepth,
          avgScrollPctExact,
          exactPctEventCount,
          deepReadRate: uv > 0 ? cap((dwell180 / uv) * 100) : 0,
        };
      }),
    };
  }

  /**
   * 入口页报告：按「会话首个 pageview 的 path」聚合（区别于「热门页面」按 PV）。
   * 入口页 = 搜索引擎认可并排名、把流量送进站的着陆点，是 SEO 工作的直接成果。
   * 输出每个入口页的入口会话数、入口跳出率（只看一页就走）、入口咨询转化率。
   * 剥离 query.events 过滤：bounce/consult 判定需会话全事件上下文。
   */
  async getLandingPages(
    query: QueryWebAnalyticsLandingPagesDto
  ): Promise<IWebAnalyticsLandingPagesResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为入口页需 DISTINCT ON(sid) 首 pageview + 会话级 bounce/consult 聚合
    const rows = await this.prisma.$queryRaw<LandingPageRawRow[]>`
      WITH filtered AS (
        SELECT e.* FROM web_analytics.events e ${where}
      ),
      landing AS (
        SELECT DISTINCT ON (sid)
          sid,
          COALESCE(NULLIF(path, ''), '/') AS landing_path,
          title
        FROM filtered
        WHERE sid IS NOT NULL AND event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
        ORDER BY sid, received_at ASC, id ASC
      ),
      session_meta AS (
        SELECT
          sid,
          COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS pageviews,
          BOOL_OR(event = 'consult_cta_click') AS has_consult,
          BOOL_OR(event = ANY(${LEAD_SUBMIT_EVENTS}::text[])) AS has_lead
        FROM filtered
        WHERE sid IS NOT NULL
        GROUP BY sid
      )
      SELECT
        l.landing_path,
        MAX(l.title) FILTER (WHERE l.title IS NOT NULL AND l.title <> '') AS title,
        COUNT(*)::int AS entry_sessions,
        COUNT(*) FILTER (WHERE sm.pageviews = 1)::int AS bounce_sessions,
        COUNT(*) FILTER (WHERE sm.has_consult)::int AS consult_sessions,
        COUNT(*) FILTER (WHERE sm.has_lead)::int AS lead_sessions
      FROM landing l
      JOIN session_meta sm ON sm.sid = l.sid
      GROUP BY l.landing_path
      ORDER BY entry_sessions DESC, l.landing_path ASC
      LIMIT ${query.limit}
    `;

    return {
      range: rangeMeta(query),
      items: rows.map((row): IWebAnalyticsLandingPageItem => {
        const entrySessions = num(row.entry_sessions);
        const bounceSessions = num(row.bounce_sessions);
        const consultSessions = num(row.consult_sessions);
        const leadSessions = num(row.lead_sessions);
        return {
          landingPath: row.landing_path,
          title: row.title ?? null,
          entrySessions,
          bounceSessions,
          bounceRate: entrySessions > 0 ? ROUND_2((bounceSessions / entrySessions) * 100) : 0,
          consultSessions,
          leadSessions,
          conversionRate: entrySessions > 0 ? ROUND_2((leadSessions / entrySessions) * 100) : 0,
        };
      }),
    };
  }

  /**
   * 搜索引擎 × 落地页 热力下钻矩阵。
   * 行 = 入口页（DISTINCT ON(sid) 的会话首 pageview path/title，与 getLandingPages 同口径）。
   * 列 = search_engine（由「该会话首 pageview 的 ref_host」派生，复用 buildSearchEngineSql）。
   * 单元格 = 会话数（每会话只贡献一格，按其入口页 × 来源引擎落桶）。
   * limit 是「行数上限」（按总会话数降序截断），不是单元格上限。
   * 剥离 query.events 过滤：落地页判定需 pageview 上下文，不受全局事件筛选影响。
   */
  async getEngineLandingMatrix(
    query: QueryWebAnalyticsEngineLandingMatrixDto
  ): Promise<IWebAnalyticsEngineLandingMatrixResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });
    // CTE 内 ref_host 无表前缀（FROM landing），所以工厂注入裸列名表达式。
    const engineSql = buildSearchEngineSql(Prisma.sql`ref_host`);

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为行 limit 在 totals CTE 内截断，再 JOIN 回 agg 获取被保留入口页的全部 engine 单元格
    const rows = await this.prisma.$queryRaw<EngineLandingMatrixRawRow[]>`
      WITH filtered AS (
        SELECT e.* FROM web_analytics.events e ${where}
      ),
      landing AS (
        SELECT DISTINCT ON (sid)
          sid,
          COALESCE(NULLIF(path, ''), '/') AS landing_path,
          title,
          ref_host
        FROM filtered
        WHERE sid IS NOT NULL AND event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
        ORDER BY sid, received_at ASC, id ASC
      ),
      labeled AS (
        SELECT landing_path, title, ${engineSql} AS engine
        FROM landing
      ),
      agg AS (
        SELECT
          landing_path,
          MAX(title) FILTER (WHERE title IS NOT NULL AND title <> '') AS title,
          engine,
          COUNT(*)::int AS sessions
        FROM labeled
        GROUP BY landing_path, engine
      ),
      totals AS (
        SELECT landing_path, SUM(sessions)::int AS total_sessions
        FROM agg
        GROUP BY landing_path
        ORDER BY total_sessions DESC, landing_path ASC
        LIMIT ${query.limit}
      )
      SELECT
        a.landing_path,
        a.title,
        a.engine,
        a.sessions,
        t.total_sessions
      FROM agg a
      JOIN totals t ON t.landing_path = a.landing_path
      ORDER BY t.total_sessions DESC, a.landing_path ASC, a.engine ASC
    `;

    // 聚合扁平行 → 行（每入口页一行）× 列（按全局会话量降序）
    const rowMap = new Map<string, IWebAnalyticsEngineLandingRow>();
    const engineTotals = new Map<string, number>();

    for (const raw of rows) {
      const landingPath = raw.landing_path;
      const engine = raw.engine;
      const sessions = num(raw.sessions);
      const total = num(raw.total_sessions);

      let row = rowMap.get(landingPath);
      if (!row) {
        row = {
          landingPath,
          title: raw.title ?? null,
          cells: {},
          totalSessions: total,
        };
        rowMap.set(landingPath, row);
      } else if (!row.title && raw.title) {
        row.title = raw.title;
      }
      row.cells[engine] = (row.cells[engine] ?? 0) + sessions;
      engineTotals.set(engine, (engineTotals.get(engine) ?? 0) + sessions);
    }

    const engines = [...engineTotals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([engine]) => engine);

    const rowsSorted = [...rowMap.values()].sort(
      (a, b) => b.totalSessions - a.totalSessions || a.landingPath.localeCompare(b.landingPath)
    );

    return {
      range: rangeMeta(query),
      engines,
      rows: rowsSorted,
    };
  }

  /**
   * UTM 活动转化对比：按 utm_campaign 看会话/咨询会话/转化率（按转化率降序）。
   * 维度取「会话首个 pageview 的 utm_campaign」（与 getAttribution 同口径，SPA 内跳转 utm 丢失也无碍）。
   * 排序兜底：转化率相同时按会话数降序，避免一组转化率=0 全部 sessions=1 的噪声盖过有量的 campaign。
   * 剥离 query.events 过滤：consult 判定需会话全事件上下文，与 attribution 写法一致。
   */
  async getCampaignConversion(
    query: QueryWebAnalyticsCampaignConversionDto
  ): Promise<IWebAnalyticsCampaignConversionResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为活动转化对比需会话首 utm_campaign + consult 会话聚合
    const rows = await this.prisma.$queryRaw<CampaignConversionRawRow[]>`
      WITH filtered AS (
        SELECT e.* FROM web_analytics.events e ${where}
      ),
      session_campaign AS (
        SELECT DISTINCT ON (sid)
          sid,
          NULLIF(utm_campaign, '') AS campaign
        FROM filtered
        WHERE sid IS NOT NULL AND event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
        ORDER BY sid, received_at ASC, id ASC
      ),
      conversion_sessions AS (
        SELECT
          sid,
          BOOL_OR(event = 'consult_cta_click') AS has_consult,
          BOOL_OR(event = ANY(${LEAD_SUBMIT_EVENTS}::text[])) AS has_lead
        FROM filtered
        WHERE sid IS NOT NULL
        GROUP BY sid
      )
      SELECT
        sc.campaign,
        COUNT(*)::int AS sessions,
        COUNT(*) FILTER (WHERE cs.has_consult)::int AS consult_sessions,
        COUNT(*) FILTER (WHERE cs.has_lead)::int AS lead_sessions
      FROM session_campaign sc
      LEFT JOIN conversion_sessions cs ON cs.sid = sc.sid
      WHERE sc.campaign IS NOT NULL
      GROUP BY sc.campaign
      ORDER BY
        (COUNT(*) FILTER (WHERE cs.has_lead)::float / NULLIF(COUNT(*), 0)) DESC NULLS LAST,
        COUNT(*) DESC,
        sc.campaign ASC
      LIMIT ${query.limit}
    `;

    return {
      range: rangeMeta(query),
      items: rows.map((row) => {
        const sessions = num(row.sessions);
        const consultSessions = num(row.consult_sessions);
        const leadSessions = num(row.lead_sessions);
        return {
          campaign: row.campaign ?? '(未填)',
          sessions,
          consultSessions,
          leadSessions,
          conversionRate: sessions > 0 ? ROUND_2((leadSessions / sessions) * 100) : 0,
        };
      }),
    };
  }

  /**
   * 新访客 vs 回访。口径：vid 全历史首现时间落在查询区间起点之后=新访客，早于=老访客。
   * 首现判定必须扫全历史（不能被查询区间截断），否则区间内所有 vid 都会被误判为「新」。
   */
  async getVisitorType(
    query: QueryWebAnalyticsVisitorTypeDto
  ): Promise<IWebAnalyticsVisitorTypeResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });
    const startDate = toBeijingDayStart(query.startDate);

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为新老访客需全历史首现窗口对比区间活跃 vid
    const rows = await this.prisma.$queryRaw<VisitorTypeRawRow[]>`
      WITH active AS (
        SELECT DISTINCT e.vid
        FROM web_analytics.events e
        ${where}
          AND e.event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
          AND e.vid IS NOT NULL
      ),
      first_seen AS (
        SELECT vid, MIN(received_at) AS first_at
        FROM web_analytics.events
        WHERE vid IS NOT NULL AND event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
        GROUP BY vid
      )
      SELECT
        COUNT(*) FILTER (WHERE fs.first_at >= ${startDate})::int AS new_visitors,
        COUNT(*) FILTER (WHERE fs.first_at < ${startDate})::int AS returning_visitors
      FROM active a
      JOIN first_seen fs ON fs.vid = a.vid
    `;

    const row = rows[0] ?? ({} as VisitorTypeRawRow);
    const newVisitors = num(row.new_visitors);
    const returningVisitors = num(row.returning_visitors);
    const total = newVisitors + returningVisitors;

    return {
      range: rangeMeta(query),
      newVisitors,
      returningVisitors,
      newVisitorRate: total > 0 ? ROUND_2((newVisitors / total) * 100) : 0,
    };
  }

  /**
   * 搜索词：从 referrer 的 query 参数提取（wd=百度 / q=Google·必应 / query / kw 等）。
   * HTTPS referrer policy 下大多数搜索引擎不再传 query，命中率天然偏低——属预期非 bug，命中即赚。
   * 关键词为 URL 编码，service 端 decodeURIComponent 解码（失败保留原值）。
   */
  async getSearchKeywords(
    query: QueryWebAnalyticsSearchKeywordsDto
  ): Promise<IWebAnalyticsSearchKeywordsResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });

    const rawLimit = query.limit * 5;

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为搜索词需对 referrer 做正则提取后聚合
    const rows = await this.prisma.$queryRaw<SearchKeywordRawRow[]>`
      WITH kw AS (
        SELECT (
          regexp_match(e.referrer, '[?&](?:wd|word|query|q|kw|keyword|text)=([^&]+)')
        )[1] AS raw_kw
        FROM web_analytics.events e
        ${where}
          AND e.event = ${WEB_ANALYTICS_PAGEVIEW_EVENT}
          AND e.referrer IS NOT NULL AND e.referrer <> ''
      )
      SELECT raw_kw AS keyword, COUNT(*)::int AS count
      FROM kw
      WHERE raw_kw IS NOT NULL AND raw_kw <> ''
      GROUP BY raw_kw
      ORDER BY count DESC, raw_kw ASC
      LIMIT ${rawLimit}
    `;

    const keywordCounts = new Map<string, number>();

    for (const row of rows) {
      const raw = row.keyword ?? '';
      const keyword = normalizeSearchKeyword(raw);
      if (!keyword) continue;

      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + num(row.count));
    }

    return {
      range: rangeMeta(query),
      items: Array.from(keywordCounts.entries())
        .map(([keyword, count]) => ({ keyword, count }))
        .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, 'zh-CN'))
        .slice(0, query.limit),
    };
  }

  /**
   * B2B 线索雷达：按明文 IP 聚合，识别疑似企业访客（多次访问/多页浏览/已咨询）。
   * 明文 IP 是 admin 专属（合规见 0005 migration + /privacy）；whois 反查靠人工，不入库。
   * 剥离 query.events 过滤：需会话全事件上下文判定咨询。
   */
  async getLeadRadar(
    query: QueryWebAnalyticsLeadRadarDto
  ): Promise<IWebAnalyticsLeadRadarResponse> {
    const where = buildWebAnalyticsWhere({ ...query, events: undefined });

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为线索雷达需按明文 ip 聚合会话/页面/咨询信号
    const rows = await this.prisma.$queryRaw<LeadRawRow[]>`
      WITH filtered AS (
        SELECT e.* FROM web_analytics.events e
        ${where}
          AND e.ip IS NOT NULL AND e.ip <> ''
      )
      SELECT
        ip,
        COUNT(DISTINCT sid)::int AS sessions,
        COUNT(*) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS pageviews,
        COUNT(DISTINCT path) FILTER (WHERE event = ${WEB_ANALYTICS_PAGEVIEW_EVENT})::int AS distinct_pages,
        MAX(region) AS region,
        MAX(city) AS city,
        MAX(isp) AS isp,
        BOOL_OR(event = 'consult_cta_click') AS has_consult,
        BOOL_OR(event = ANY(${LEAD_SUBMIT_EVENTS}::text[])) AS has_lead,
        MAX(received_at) AS last_seen
      FROM filtered
      GROUP BY ip
      ORDER BY pageviews DESC, sessions DESC, last_seen DESC
      LIMIT ${query.limit}
    `;

    return {
      range: rangeMeta(query),
      items: rows.map(
        (row): IWebAnalyticsLeadItem => ({
          ip: row.ip,
          sessions: num(row.sessions),
          pageviews: num(row.pageviews),
          distinctPages: num(row.distinct_pages),
          region: row.region ?? null,
          city: row.city ?? null,
          isp: row.isp ?? null,
          hasConsult: Boolean(row.has_consult),
          hasLead: Boolean(row.has_lead),
          lastSeen: iso(row.last_seen) ?? '',
        })
      ),
    };
  }

  private async queryOptionRows(
    query: QueryWebAnalyticsFilterOptionsDto,
    column: Prisma.Sql
  ): Promise<IWebAnalyticsFilterOption[]> {
    const where = buildWebAnalyticsWhere(query);

    // @prisma-raw-sql: WebEvent model 已在 schema.prisma（multiSchema），日常按字段查询请用 prisma.webEvent.findMany/findFirst；这里继续用 $queryRaw 是因为筛选项 distinct 由固定列集合映射到安全 SQL 片段
    const rows = await this.prisma.$queryRaw<BreakdownRawRow[]>`
      SELECT ${column} AS value, COUNT(*)::int AS count
      FROM web_analytics.events e
      ${where}
        AND ${column} IS NOT NULL
        AND ${column} <> ''
      GROUP BY 1
      ORDER BY count DESC, value ASC
      LIMIT ${query.limit}
    `;

    return rows.map((row) => {
      const value = row.value ?? '';
      return { value, label: value, count: num(row.count) };
    });
  }
}

function appendArrayCondition(
  conditions: Prisma.Sql[],
  column: Prisma.Sql,
  values: string[] | undefined
): void {
  if (values?.length) conditions.push(Prisma.sql`${column} = ANY(${values}::text[])`);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function toBeijingDayStart(value: string): Date {
  return new Date(`${value}T00:00:00+08:00`);
}

function toBeijingNextDayStart(value: string): Date {
  const date = toBeijingDayStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function getPreviousRange(
  startDate: string,
  endDate: string
): IWebAnalyticsSummaryResponse['range'] {
  const dayMs = 24 * 60 * 60 * 1000;
  const start = toBeijingDayStart(startDate);
  const endExclusive = toBeijingNextDayStart(endDate);
  const days = Math.max(1, Math.round((endExclusive.getTime() - start.getTime()) / dayMs));
  const previousStart = new Date(start.getTime() - days * dayMs);
  const previousEnd = new Date(start.getTime() - dayMs);
  return {
    startDate: toBeijingDateString(previousStart),
    endDate: toBeijingDateString(previousEnd),
  };
}

function toBeijingDateString(value: Date): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function changeRate(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ROUND_2(((current - previous) / previous) * 100);
}

function rangeMeta(query: { startDate: string; endDate: string }) {
  return { startDate: query.startDate, endDate: query.endDate };
}

function num(value: number | string | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toEventRow(row: EventRawRow): IWebAnalyticsEventRow {
  return {
    id: row.id,
    receivedAt: iso(row.received_at) ?? '',
    clientTs: iso(row.client_ts),
    site: row.site,
    event: row.event,
    vid: row.vid,
    sid: row.sid,
    path: row.path,
    pageType: row.page_type,
    title: row.title,
    referrer: row.referrer,
    refHost: row.ref_host,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    placement: row.placement,
    channel: row.channel,
    label: row.label,
    isBot: row.is_bot,
    screen: row.screen,
    lang: row.lang,
    ip: row.ip,
  };
}
