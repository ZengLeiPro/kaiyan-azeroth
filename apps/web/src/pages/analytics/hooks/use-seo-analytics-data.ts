import type {
  ISeoPageInsightResponse,
  ISeoRankingItem,
  ISeoSearchQueryResponse,
  ISeoSearchRankingResponse,
  ISeoSearchTrendPoint,
  ISeoSearchTrendResponse,
  ISeoSiteSummaryPoint,
  ISeoSiteSummaryResponse,
  ISeoSummaryResponse,
  ISeoSyncRun,
  ISeoSyncRunResponse,
  ISeoTrafficSnapshotResponse,
} from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

const STALE_TIME = 5 * 60 * 1000; // 5 分钟

/** 标准分页响应 shape（后端 PaginatedResponse<T>） */
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 期间预设 → (startDate, endDate) 解析（前端版本，按浏览器本地时区计算"今天"）
 *
 * SEO 后端只接受具体的 startDate / endDate（YYYY-MM-DD 北京日），故由前端 hook 提前算好。
 * 浏览器本地时区在中国环境下与北京时间一致；跨时区用户可能有 1 天偏移，
 * 但 SEO 看板的目标用户在国内，可接受。
 */
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface ResolvedSeoRange {
  startDate: string;
  endDate: string;
}

export function resolveSeoRange(
  range: AnalyticsRangeValue,
  now: Date = new Date()
): ResolvedSeoRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date;
  const end: Date = today;

  switch (range.preset) {
    case 'last30d':
      start = new Date(today);
      start.setDate(start.getDate() - 29);
      break;
    case 'qtd': {
      const q = Math.floor(today.getMonth() / 3);
      start = new Date(today.getFullYear(), q * 3, 1);
      break;
    }
    case 'ytd':
      start = new Date(today.getFullYear(), 0, 1);
      break;
    case 'custom': {
      const startStr = range.startDate ?? fmt(today);
      const endStr = range.endDate ?? fmt(today);
      return { startDate: startStr, endDate: endStr };
    }
    case 'mtd':
    default:
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
  }
  return { startDate: fmt(start), endDate: fmt(end) };
}

function rangeParams(range: AnalyticsRangeValue): { startDate: string; endDate: string } {
  return resolveSeoRange(range);
}

// ============== 聚合端点（看板 KPI/趋势/排行专用） ==============

/** GET /seo/summary —— 搜索平台 + Clarity 综合 KPI（来源唯一：@ky-azeroth/shared/types） */
export type SeoSummaryResponse = ISeoSummaryResponse;

export function useSeoSummary(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'seo', 'summary', range],
    queryFn: async () => {
      const res = await api.get<SeoSummaryResponse>('/seo/summary', { params: rangeParams(range) });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

/** GET /seo/search-trend —— 搜索平台按日趋势（来源唯一：@ky-azeroth/shared/types） */
export type SeoSearchTrendPoint = ISeoSearchTrendPoint;
export type SeoSearchTrendResponse = ISeoSearchTrendResponse;

export function useSeoSearchTrend(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'seo', 'search-trend', range],
    queryFn: async () => {
      const res = await api.get<SeoSearchTrendResponse>('/seo/search-trend', {
        params: rangeParams(range),
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

/** GET /seo/search-ranking —— Top N 排行（来源唯一：@ky-azeroth/shared/types） */
export type SeoRankingItem = ISeoRankingItem;
export type SeoSearchRankingResponse = ISeoSearchRankingResponse;

export function useSeoSearchRanking(
  range: AnalyticsRangeValue,
  dim: 'keyword' | 'page',
  limit = 15
) {
  return useQuery({
    queryKey: ['analytics', 'seo', 'search-ranking', range, dim, limit],
    queryFn: async () => {
      const res = await api.get<SeoSearchRankingResponse>('/seo/search-ranking', {
        params: { ...rangeParams(range), dim, limit },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

/** GET /seo/page-insights/site-summary —— Clarity 全站行按日序列（来源唯一：@ky-azeroth/shared/types） */
export type SeoSiteSummaryPoint = ISeoSiteSummaryPoint;
export type SeoSiteSummaryResponse = ISeoSiteSummaryResponse;

export function useSeoSiteSummary(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'seo', 'site-summary', range],
    queryFn: async () => {
      const res = await api.get<SeoSiteSummaryResponse>('/seo/page-insights/site-summary', {
        params: rangeParams(range),
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

// ============== 明细列表（搜索/详情/分页表格用） ==============

export interface UseSeoSearchQueriesFilters {
  keyword?: string;
  source?: string;
  siteUrl?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 关键词明细列表（分页 + keyword 模糊筛选）。
 * 仅用于关键词明细表，**不要用于全局 KPI 聚合**（前 N 条样本不代表全量）。
 */
export function useSeoSearchQueries(
  range: AnalyticsRangeValue,
  filters: UseSeoSearchQueriesFilters = {}
) {
  const { page = 1, pageSize = 100 } = filters;
  return useQuery({
    queryKey: ['analytics', 'seo', 'search-queries', range, filters],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ISeoSearchQueryResponse>>('/seo/search-queries', {
        params: {
          ...rangeParams(range),
          keyword: filters.keyword || undefined,
          source: filters.source || undefined,
          siteUrl: filters.siteUrl || undefined,
          page,
          pageSize,
        },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

export interface UseSeoPageInsightsFilters {
  pageUrl?: string;
  source?: string;
  siteUrl?: string;
  page?: number;
  pageSize?: number;
}

export function useSeoPageInsights(
  range: AnalyticsRangeValue,
  filters: UseSeoPageInsightsFilters = {}
) {
  const { page = 1, pageSize = 100 } = filters;
  return useQuery({
    queryKey: ['analytics', 'seo', 'page-insights', range, filters],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ISeoPageInsightResponse>>('/seo/page-insights', {
        params: {
          ...rangeParams(range),
          pageUrl: filters.pageUrl || undefined,
          source: filters.source || undefined,
          siteUrl: filters.siteUrl || undefined,
          page,
          pageSize,
        },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

export interface UseSeoTrafficSnapshotsFilters {
  source?: string;
  siteUrl?: string;
  page?: number;
  pageSize?: number;
}

export function useSeoTrafficSnapshots(
  range: AnalyticsRangeValue,
  filters: UseSeoTrafficSnapshotsFilters = {}
) {
  const { page = 1, pageSize = 100 } = filters;
  return useQuery({
    queryKey: ['analytics', 'seo', 'traffic-snapshots', range, filters],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ISeoTrafficSnapshotResponse>>(
        '/seo/traffic-snapshots',
        {
          params: {
            ...rangeParams(range),
            source: filters.source || undefined,
            siteUrl: filters.siteUrl || undefined,
            page,
            pageSize,
          },
        }
      );
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

// ============== 同步任务 ==============

export interface UseSeoSyncRunsFilters {
  status?: string;
  triggerSource?: string;
  startedAtFrom?: string;
  startedAtTo?: string;
  page?: number;
  pageSize?: number;
}

export function useSeoSyncRuns(filters: UseSeoSyncRunsFilters = {}) {
  const { page = 1, pageSize = 30 } = filters;
  return useQuery({
    queryKey: ['analytics', 'seo', 'sync-runs', filters],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<ISeoSyncRunResponse>>('/seo/sync-runs', {
        params: {
          status: filters.status || undefined,
          triggerSource: filters.triggerSource || undefined,
          startedAtFrom: filters.startedAtFrom || undefined,
          startedAtTo: filters.startedAtTo || undefined,
          page,
          pageSize,
        },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

/** 取最近一次同步任务（看板顶部「上次同步：X 秒前」用） */
export function useSeoLatestSyncRun() {
  return useQuery({
    queryKey: ['analytics', 'seo', 'sync-runs', 'latest'],
    queryFn: async () => {
      const res = await api.get<ISeoSyncRun | null>('/seo/sync-runs/latest');
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

/** 同步任务详情（含完整 report JSON），SyncLogs 页面点开行后用 */
export function useSeoSyncRunDetail(id: string | null) {
  return useQuery({
    queryKey: ['analytics', 'seo', 'sync-runs', 'detail', id],
    queryFn: async () => {
      const res = await api.get<ISeoSyncRunResponse>(`/seo/sync-runs/${id}`);
      return res.data;
    },
    enabled: !!id,
    staleTime: STALE_TIME,
  });
}
