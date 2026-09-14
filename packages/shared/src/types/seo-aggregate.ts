import type { SeoRankingDimension } from '../schemas/seo-aggregate';

// SEO 聚合看板响应（GET /seo/*）唯一事实来源。
// 后端 seo-monitor.service/controller 与前端 use-seo-analytics-data 均从此导入，
// 不得在 service 或前端各自重复声明同名同义结构。

export interface ISeoSearchSourceSummary {
  source: string;
  totalImpressions: number;
  totalClicks: number;
  keywordCount: number;
}

/** GET /seo/summary —— 搜索平台 + Clarity 综合 KPI */
export interface ISeoSummaryResponse {
  range: { startDate: string; endDate: string };
  search: {
    totalImpressions: number;
    totalClicks: number;
    /** 加权 = totalClicks / totalImpressions */
    avgCtr: number | null;
    /** 加权 = SUM(avgPosition * impressions) / SUM(impressions) */
    avgPosition: number | null;
    keywordCount: number;
  };
  searchSources: ISeoSearchSourceSummary[];
  clarity: {
    totalSessions: number;
    totalPageViews: number;
    totalJsErrors: number;
    totalRageClicks: number;
    /** 命中的 __SITE__ 行天数 */
    siteDays: number;
  };
}

/** GET /seo/search-trend —— 搜索平台按日趋势点 */
export interface ISeoSearchTrendPoint {
  date: string;
  impressions: number;
  clicks: number;
  ctr: number | null;
  avgPosition: number | null;
}

export interface ISeoSearchTrendResponse {
  range: { startDate: string; endDate: string };
  points: ISeoSearchTrendPoint[];
}

/** GET /seo/search-ranking —— Top N 排行项 */
export interface ISeoRankingItem {
  id: string;
  name: string;
  /** 主指标：关键词与搜索落地页均为 impressions */
  value: number;
  /** 副信息：关键词="点击 X · CTR Y%"，落地页="点击 X · 平均排名 Y" */
  hint: string;
}

export interface ISeoSearchRankingResponse {
  range: { startDate: string; endDate: string };
  dim: SeoRankingDimension;
  items: ISeoRankingItem[];
}

/** GET /seo/page-insights/site-summary —— Clarity 全站行按日序列点 */
export interface ISeoSiteSummaryPoint {
  date: string;
  sessions: number;
  uniqueUsers: number;
  pageViews: number;
  /** 显式秒；service 已处理 avgEngagementMs 命名陷阱（实际存秒） */
  avgEngagementSeconds: number | null;
  scrollDepthAvg: number | null;
  deadClicks: number;
  rageClicks: number;
  jsErrors: number;
}

export interface ISeoSiteSummaryResponse {
  range: { startDate: string; endDate: string };
  points: ISeoSiteSummaryPoint[];
}
