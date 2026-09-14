import {
  crmAgingResponseSchema,
  crmDistributionResponseSchema,
  crmFunnelResponseSchema,
  crmKpisResponseSchema,
  crmRankingResponseSchema,
  crmSleepingResponseSchema,
  crmTrendResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

const STALE_TIME = 5 * 60 * 1000; // 5 分钟

function rangeParams(range: AnalyticsRangeValue): Record<string, string | undefined> {
  return {
    preset: range.preset,
    startDate: range.startDate,
    endDate: range.endDate,
  };
}

export function useCrmKpis(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'crm', 'kpis', range],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/kpis', {
        params: rangeParams(range),
      });
      return crmKpisResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useCrmFunnel(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'crm', 'funnel', range],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/funnel', {
        params: rangeParams(range),
      });
      return crmFunnelResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useCrmTrend(
  range: AnalyticsRangeValue,
  metric: string,
  bucket: 'day' | 'week' | 'month'
) {
  return useQuery({
    queryKey: ['analytics', 'crm', 'trend', range, metric, bucket],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/trend', {
        params: { ...rangeParams(range), metric, bucket },
      });
      return crmTrendResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useCrmDistribution(dimension: string) {
  return useQuery({
    queryKey: ['analytics', 'crm', 'distribution', dimension],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/distribution', {
        params: { dimension },
      });
      return crmDistributionResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useCrmRanking(
  range: AnalyticsRangeValue,
  dimension: 'salesperson' | 'customer' | 'product',
  metric: string,
  limit = 10
) {
  return useQuery({
    queryKey: ['analytics', 'crm', 'ranking', range, dimension, metric, limit],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/ranking', {
        params: { ...rangeParams(range), dimension, metric, limit },
      });
      return crmRankingResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useCrmAging() {
  return useQuery({
    queryKey: ['analytics', 'crm', 'aging'],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/aging');
      return crmAgingResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useCrmSleeping() {
  return useQuery({
    queryKey: ['analytics', 'crm', 'sleeping'],
    queryFn: async () => {
      const res = await api.get('/analytics/crm/sleeping');
      return crmSleepingResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}
