import type { WebAnalyticsBreakdownDimension } from '@ky-azeroth/shared/constants';
import type {
  IWebAnalyticsAttributionResponse,
  IWebAnalyticsBreakdownResponse,
  IWebAnalyticsCampaignConversionResponse,
  IWebAnalyticsContentResponse,
  IWebAnalyticsEngineLandingMatrixResponse,
  IWebAnalyticsEventRow,
  IWebAnalyticsFilterOptionsResponse,
  IWebAnalyticsFunnelResponse,
  IWebAnalyticsLandingPagesResponse,
  IWebAnalyticsLeadRadarResponse,
  IWebAnalyticsSearchKeywordsResponse,
  IWebAnalyticsSummaryResponse,
  IWebAnalyticsTrendResponse,
  IWebAnalyticsVisitorTypeResponse,
} from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

import { resolveSeoRange } from './use-seo-analytics-data';

const STALE_TIME = 5 * 60 * 1000;

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface WebAnalyticsFilters {
  site?: string | null;
  events?: string[];
  pageTypes?: string[];
  utmSources?: string[];
  refHosts?: string[];
  placements?: string[];
  channels?: string[];
  pathSearch?: string;
  vid?: string;
  includeBots?: boolean;
}

export type { WebAnalyticsBreakdownDimension };

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function nonEmptyArray(value: string[] | undefined): string[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function buildWebAnalyticsQueryParams(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters = {}
) {
  return {
    ...resolveSeoRange(range),
    site: nonEmpty(filters.site),
    events: nonEmptyArray(filters.events),
    pageTypes: nonEmptyArray(filters.pageTypes),
    utmSources: nonEmptyArray(filters.utmSources),
    refHosts: nonEmptyArray(filters.refHosts),
    placements: nonEmptyArray(filters.placements),
    channels: nonEmptyArray(filters.channels),
    pathSearch: nonEmpty(filters.pathSearch),
    vid: nonEmpty(filters.vid),
    includeBots: filters.includeBots ? 'true' : undefined,
  };
}

export function useWebAnalyticsSummary(range: AnalyticsRangeValue, filters: WebAnalyticsFilters) {
  return useQuery({
    queryKey: ['analytics', 'web', 'summary', range, filters],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsSummaryResponse>('/web-analytics/summary', {
        params: buildWebAnalyticsQueryParams(range, filters),
      });
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}

export function useWebAnalyticsTrend(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'trend', range, filters],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsTrendResponse>('/web-analytics/trend', {
        params: buildWebAnalyticsQueryParams(range, filters),
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsBreakdown(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  dimension: WebAnalyticsBreakdownDimension,
  limit = 15,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'breakdown', range, filters, dimension, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsBreakdownResponse>('/web-analytics/breakdown', {
        params: { ...buildWebAnalyticsQueryParams(range, filters), dimension, limit },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsContent(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 50,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'content', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsContentResponse>('/web-analytics/content-engagement', {
        params: { ...buildWebAnalyticsQueryParams(range, filters), limit },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsLandingPages(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 20,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'landing-pages', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsLandingPagesResponse>('/web-analytics/landing-pages', {
        params: { ...buildWebAnalyticsQueryParams(range, filters), limit },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsEngineLandingMatrix(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 15,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'engine-landing-matrix', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsEngineLandingMatrixResponse>(
        '/web-analytics/engine-landing-matrix',
        { params: { ...buildWebAnalyticsQueryParams(range, filters), limit } }
      );
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsVisitorType(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'visitor-type', range, filters],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsVisitorTypeResponse>('/web-analytics/visitor-type', {
        params: buildWebAnalyticsQueryParams(range, filters),
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsSearchKeywords(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 30,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'search-keywords', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsSearchKeywordsResponse>(
        '/web-analytics/search-keywords',
        { params: { ...buildWebAnalyticsQueryParams(range, filters), limit } }
      );
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsLeadRadar(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 30,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'lead-radar', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsLeadRadarResponse>('/web-analytics/lead-radar', {
        params: { ...buildWebAnalyticsQueryParams(range, filters), limit },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsFunnel(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'funnel', range, filters],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsFunnelResponse>('/web-analytics/funnel', {
        params: buildWebAnalyticsQueryParams(range, filters),
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsAttribution(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 20,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'attribution', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsAttributionResponse>('/web-analytics/attribution', {
        params: { ...buildWebAnalyticsQueryParams(range, filters), limit },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsCampaignConversion(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  limit = 20,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'campaign-conversion', range, filters, limit],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsCampaignConversionResponse>(
        '/web-analytics/campaign-conversion',
        { params: { ...buildWebAnalyticsQueryParams(range, filters), limit } }
      );
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsEvents(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters,
  page: number,
  pageSize: number,
  enabled = true
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'events', range, filters, page, pageSize],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<IWebAnalyticsEventRow>>('/web-analytics/events', {
        params: { ...buildWebAnalyticsQueryParams(range, filters), page, pageSize },
      });
      return res.data;
    },
    staleTime: STALE_TIME,
    enabled,
  });
}

export function useWebAnalyticsFilterOptions(
  range: AnalyticsRangeValue,
  filters: WebAnalyticsFilters
) {
  return useQuery({
    queryKey: ['analytics', 'web', 'filter-options', range, filters],
    queryFn: async () => {
      const res = await api.get<IWebAnalyticsFilterOptionsResponse>(
        '/web-analytics/filter-options',
        {
          params: { ...buildWebAnalyticsQueryParams(range, filters), limit: 50 },
        }
      );
      return res.data;
    },
    staleTime: STALE_TIME,
  });
}
