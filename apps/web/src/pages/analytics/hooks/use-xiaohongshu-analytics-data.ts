import type {
  IXiaohongshuAdvertiserResponse,
  IXiaohongshuConnectionResponse,
  IXiaohongshuDailyReportResponse,
  IXiaohongshuRankingResponse,
  IXiaohongshuSummaryResponse,
  IXiaohongshuSyncRun,
  IXiaohongshuTrendResponse,
  XiaohongshuDataCaliber,
  XiaohongshuRankingMetric,
  XiaohongshuReportLevel,
} from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

const STALE_TIME = 5 * 60 * 1000;

function fmt(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

export interface ResolvedXiaohongshuRange {
  startDate: string;
  endDate: string;
}

/** 聚光日报按 T-1 截止，避免日期选择器默认包含尚未产出报表的当天。 */
export function resolveXiaohongshuRange(
  range: AnalyticsRangeValue,
  now: Date = new Date()
): ResolvedXiaohongshuRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() - 1);
  let start: Date;

  switch (range.preset) {
    case 'last30d':
      start = new Date(end);
      start.setDate(start.getDate() - 29);
      break;
    case 'qtd': {
      const quarter = Math.floor(end.getMonth() / 3);
      start = new Date(end.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'ytd':
      start = new Date(end.getFullYear(), 0, 1);
      break;
    case 'custom':
      return {
        startDate: range.startDate ?? fmt(end),
        endDate: range.endDate ?? fmt(end),
      };
    case 'mtd':
    default:
      start = new Date(end.getFullYear(), end.getMonth(), 1);
      break;
  }

  return { startDate: fmt(start), endDate: fmt(end) };
}

/** 当前区间前一日结束，并按包含首尾的自然日数等长回溯。 */
export function resolvePreviousXiaohongshuRange(
  current: ResolvedXiaohongshuRange
): ResolvedXiaohongshuRange {
  const start = parseDate(current.startDate);
  const end = parseDate(current.endDate);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - days + 1);
  return { startDate: fmt(previousStart), endDate: fmt(previousEnd) };
}

export function buildXiaohongshuAnalyticsParams(
  range: AnalyticsRangeValue,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId?: string,
  level: XiaohongshuReportLevel = 'account'
) {
  return {
    ...resolveXiaohongshuRange(range),
    advertiserId: advertiserId || undefined,
    level,
    dataCaliber,
  };
}

export function buildXiaohongshuSummaryParams(
  range: AnalyticsRangeValue,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId?: string,
  level: XiaohongshuReportLevel = 'account'
) {
  const current = resolveXiaohongshuRange(range);
  const previous = resolvePreviousXiaohongshuRange(current);
  return {
    ...current,
    compareStartDate: previous.startDate,
    compareEndDate: previous.endDate,
    advertiserId: advertiserId || undefined,
    level,
    dataCaliber,
  };
}

export function buildXiaohongshuRankingParams(
  range: AnalyticsRangeValue,
  metric: XiaohongshuRankingMetric,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId?: string,
  level: XiaohongshuReportLevel = 'note'
) {
  return {
    ...resolveXiaohongshuRange(range),
    advertiserId: advertiserId || undefined,
    level,
    metric,
    dataCaliber,
    limit: 10,
  };
}

export function buildXiaohongshuReportsParams(
  range: AnalyticsRangeValue,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId: string | undefined,
  page: number,
  pageSize: number,
  level: XiaohongshuReportLevel = 'note'
) {
  return {
    ...resolveXiaohongshuRange(range),
    advertiserId: advertiserId || undefined,
    level,
    dataCaliber,
    page,
    pageSize,
  };
}

export function useXiaohongshuConnection() {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'connection'],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuConnectionResponse | null>(
        '/xiaohongshu/connection'
      );
      return response.data;
    },
    staleTime: STALE_TIME,
  });
}

export function useXiaohongshuAdvertisers() {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'advertisers'],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuAdvertiserResponse[]>('/xiaohongshu/advertisers');
      return response.data;
    },
    staleTime: STALE_TIME,
  });
}

export function useXiaohongshuSummary(
  range: AnalyticsRangeValue,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId?: string,
  level: XiaohongshuReportLevel = 'account'
) {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'summary', range, dataCaliber, advertiserId, level],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuSummaryResponse>('/xiaohongshu/summary', {
        params: buildXiaohongshuSummaryParams(range, dataCaliber, advertiserId, level),
      });
      return response.data;
    },
    enabled: Boolean(advertiserId),
    staleTime: STALE_TIME,
  });
}

export function useXiaohongshuTrend(
  range: AnalyticsRangeValue,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId?: string,
  level: XiaohongshuReportLevel = 'account'
) {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'trend', range, dataCaliber, advertiserId, level],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuTrendResponse>('/xiaohongshu/trend', {
        params: buildXiaohongshuAnalyticsParams(range, dataCaliber, advertiserId, level),
      });
      return response.data;
    },
    enabled: Boolean(advertiserId),
    staleTime: STALE_TIME,
  });
}

export function useXiaohongshuRanking(
  range: AnalyticsRangeValue,
  metric: XiaohongshuRankingMetric,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId?: string,
  level: XiaohongshuReportLevel = 'note'
) {
  return useQuery({
    queryKey: [
      'analytics',
      'xiaohongshu',
      'ranking',
      range,
      metric,
      dataCaliber,
      advertiserId,
      level,
    ],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuRankingResponse>('/xiaohongshu/ranking', {
        params: buildXiaohongshuRankingParams(range, metric, dataCaliber, advertiserId, level),
      });
      return response.data;
    },
    enabled: Boolean(advertiserId),
    staleTime: STALE_TIME,
  });
}

export function useXiaohongshuReports(
  range: AnalyticsRangeValue,
  dataCaliber: XiaohongshuDataCaliber,
  advertiserId: string | undefined,
  page: number,
  pageSize: number,
  level: XiaohongshuReportLevel = 'note'
) {
  return useQuery({
    queryKey: [
      'analytics',
      'xiaohongshu',
      'reports',
      range,
      dataCaliber,
      advertiserId,
      page,
      pageSize,
      level,
    ],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuDailyReportResponse>('/xiaohongshu/reports', {
        params: buildXiaohongshuReportsParams(
          range,
          dataCaliber,
          advertiserId,
          page,
          pageSize,
          level
        ),
      });
      return response.data;
    },
    enabled: Boolean(advertiserId),
    staleTime: STALE_TIME,
  });
}

export function useXiaohongshuLatestSyncRun(advertiserId?: string) {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'latest-sync-run', advertiserId],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuSyncRun | null>('/xiaohongshu/sync-runs/latest', {
        params: { advertiserId },
      });
      return response.data;
    },
    enabled: Boolean(advertiserId),
    staleTime: 60 * 1000,
  });
}
