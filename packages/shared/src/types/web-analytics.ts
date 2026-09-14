import type { WebAnalyticsBreakdownDimension } from '../constants/web-analytics';

export interface IWebAnalyticsRangeMeta {
  startDate: string;
  endDate: string;
}

export interface IWebAnalyticsSummaryResponse {
  range: IWebAnalyticsRangeMeta;
  pv: number;
  uv: number;
  sessions: number;
  consultClicks: number;
  consultChannelClicks: number;
  consultSessions: number;
  /** lead_submit / quote_request_submit / consult_form_submit 总次数 */
  leadSubmits: number;
  /** 产生最终留资的独立会话数 */
  leadSessions: number;
  resourceDownloads: number;
  /** 最后一条事件时间，用于判断采集链路是否新鲜 */
  lastEventAt: string | null;
  /** pageview 字段覆盖率（%） */
  dataQuality: {
    titleCoverage: number;
    refHostCoverage: number;
    utmSourceCoverage: number;
    utmCampaignCoverage: number;
  };
  comparison: {
    previousRange: IWebAnalyticsRangeMeta;
    pvChangeRate: number | null;
    uvChangeRate: number | null;
    sessionsChangeRate: number | null;
    leadSubmitsChangeRate: number | null;
  };
  sessionConversionRate: number;
  bounceRate: number;
  /** 平均每会话浏览页数 */
  avgPagesPerSession: number;
  /** 平均会话时长（秒，单页会话=0） */
  avgSessionDurationSec: number;
}

export interface IWebAnalyticsTrendPoint {
  date: string;
  pv: number;
  uv: number;
  sessions: number;
  consults: number;
  leads: number;
}

export interface IWebAnalyticsTrendResponse {
  range: IWebAnalyticsRangeMeta;
  points: IWebAnalyticsTrendPoint[];
}

export interface IWebAnalyticsBreakdownItem {
  key: string;
  label: string;
  count: number;
  percentage: number;
}

export interface IWebAnalyticsBreakdownResponse {
  dimension: WebAnalyticsBreakdownDimension;
  items: IWebAnalyticsBreakdownItem[];
}

export interface IWebAnalyticsFunnelStage {
  key: string;
  label: string;
  count: number;
  rate: number;
  stepRate: number;
}

export interface IWebAnalyticsFunnelResponse {
  range: IWebAnalyticsRangeMeta;
  stages: IWebAnalyticsFunnelStage[];
}

export interface IWebAnalyticsAttributionItem {
  source: string;
  medium: string;
  landingPath: string;
  sessions: number;
  consultSessions: number;
  leadSessions: number;
  conversionRate: number;
}

export interface IWebAnalyticsAttributionResponse {
  range: IWebAnalyticsRangeMeta;
  items: IWebAnalyticsAttributionItem[];
}

export interface IWebAnalyticsEventRow {
  id: string;
  receivedAt: string;
  clientTs: string | null;
  site: string;
  event: string;
  vid: string | null;
  sid: string | null;
  path: string | null;
  pageType: string | null;
  title: string | null;
  referrer: string | null;
  refHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  placement: string | null;
  channel: string | null;
  label: string | null;
  isBot: boolean;
  screen: string | null;
  lang: string | null;
  ip: string | null;
}

/**
 * 内容互动指标（按文章 path 聚合 article_read_* / article_dwell_* 事件）。
 * 滚动深度/停留为「里程碑事件」估算，非连续精确值（详见数据口径脚注）。
 */
export interface IWebAnalyticsContentItem {
  path: string;
  title: string | null;
  pv: number;
  uv: number;
  /** 读到 25/50/75/100% 的独立访客数（累进：reach25 ≥ reach50 ≥ reach75 ≥ reach100） */
  reach25: number;
  reach50: number;
  reach75: number;
  reach100: number;
  /** 停留 30/60/180s 的独立访客数（累进） */
  dwell30: number;
  dwell60: number;
  dwell180: number;
  /** 读完率 = reach100 / uv（%，capped 100） */
  completionRate: number;
  /** 平均滚动深度估算（%）：由档位人数加权推导，分母为「至少滚动过的访客 reach25」 */
  avgScrollDepth: number;
  /**
   * 平均滚动深度（精确版，%）：从 article_read_* 事件 raw.pct 直接 AVG 得到。
   * 06-13 起 beacon 透传 pct（仅 read 事件），存量旧事件可能没有 pct → null。
   * 有值时优先显示精确版，无值回退到 avgScrollDepth（档位估算）。
   */
  avgScrollPctExact: number | null;
  /** 计入 avgScrollPctExact 的 article_read 事件数（前端判断精确版可信度用） */
  exactPctEventCount: number;
  /** 深读率 = dwell180 / uv（%，capped 100） */
  deepReadRate: number;
}

export interface IWebAnalyticsContentResponse {
  range: IWebAnalyticsRangeMeta;
  items: IWebAnalyticsContentItem[];
}

/** 入口页（会话首个 pageview 的 path）报告项 */
export interface IWebAnalyticsLandingPageItem {
  landingPath: string;
  title: string | null;
  /** 以此页为入口的会话数 */
  entrySessions: number;
  /** 入口即跳出（只看一页就走）的会话数 */
  bounceSessions: number;
  /** 入口跳出率（%） */
  bounceRate: number;
  /** 入口后产生咨询点击的会话数 */
  consultSessions: number;
  leadSessions: number;
  /** 入口咨询转化率（%） */
  conversionRate: number;
}

export interface IWebAnalyticsLandingPagesResponse {
  range: IWebAnalyticsRangeMeta;
  items: IWebAnalyticsLandingPageItem[];
}

/**
 * 搜索引擎 × 落地页 热力下钻矩阵。
 * 行 = 入口页（会话首个 pageview 的 path / title），与「入口页报告」口径一致。
 * 列 = search_engine（由该会话首 pageview 的 ref_host 派生，复用 SEARCH_ENGINE_SQL）。
 * 单元格 = 会话数。
 *
 * 决策回答：百度把人送到哪些页 / Google 偏爱哪一篇 / 某入口页主要靠哪个引擎吃饭。
 */
export interface IWebAnalyticsEngineLandingRow {
  landingPath: string;
  title: string | null;
  /** engine 列名 → 会话数；缺省视为 0（前端按 engines 列头顺序索引） */
  cells: Record<string, number>;
  /** 该入口页跨所有引擎的总会话数（cells 之和） */
  totalSessions: number;
}

export interface IWebAnalyticsEngineLandingMatrixResponse {
  range: IWebAnalyticsRangeMeta;
  /** 列头：search_engine 名称列表，按全局会话量降序 */
  engines: string[];
  /** 行：入口页（按 totalSessions 降序，limit 截断） */
  rows: IWebAnalyticsEngineLandingRow[];
}

/**
 * UTM 活动转化对比：按 utm_campaign 看会话/咨询会话/转化率，按转化率降序。
 * 维度取「会话首个 pageview 的 utm_campaign」（与首触点归因同口径，SPA 内跳转 utm 丢失也无碍）。
 * 用于多平台分发复盘：哪条 campaign 引来的流量最值钱。
 */
export interface IWebAnalyticsCampaignConversionItem {
  campaign: string;
  sessions: number;
  consultSessions: number;
  leadSessions: number;
  /** 转化率（%） */
  conversionRate: number;
}

export interface IWebAnalyticsCampaignConversionResponse {
  range: IWebAnalyticsRangeMeta;
  items: IWebAnalyticsCampaignConversionItem[];
}

/**
 * 新访客 vs 回访。口径：vid 全历史首现时间落在查询区间内=新访客，早于区间=老访客。
 * 注意 Safari ITP / 隐私模式 / 跨域换号会让「新访客」系统性偏高，属乐观估计。
 */
export interface IWebAnalyticsVisitorTypeResponse {
  range: IWebAnalyticsRangeMeta;
  newVisitors: number;
  returningVisitors: number;
  /** 新访客占比（%） */
  newVisitorRate: number;
}

/** 搜索词（从 referrer 提取的 query 参数）。HTTPS referrer policy 下命中率天然偏低。 */
export interface IWebAnalyticsSearchKeywordItem {
  keyword: string;
  count: number;
}

export interface IWebAnalyticsSearchKeywordsResponse {
  range: IWebAnalyticsRangeMeta;
  items: IWebAnalyticsSearchKeywordItem[];
}

/**
 * B2B 线索雷达：按明文 IP 聚合，识别疑似企业访客（多次访问/看过高意向页/已咨询）。
 * 仅 admin 可见，whois 反查靠人工判断（不入库、不自动企业识别）。
 */
export interface IWebAnalyticsLeadItem {
  ip: string;
  sessions: number;
  pageviews: number;
  distinctPages: number;
  region: string | null;
  city: string | null;
  isp: string | null;
  hasConsult: boolean;
  hasLead: boolean;
  lastSeen: string;
}

export interface IWebAnalyticsLeadRadarResponse {
  range: IWebAnalyticsRangeMeta;
  items: IWebAnalyticsLeadItem[];
}

export interface IWebAnalyticsFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface IWebAnalyticsFilterOptionsResponse {
  sites: IWebAnalyticsFilterOption[];
  pageTypes: IWebAnalyticsFilterOption[];
  events: IWebAnalyticsFilterOption[];
  utmSources: IWebAnalyticsFilterOption[];
  refHosts: IWebAnalyticsFilterOption[];
  placements: IWebAnalyticsFilterOption[];
  channels: IWebAnalyticsFilterOption[];
}
