import {
  projectDistributionResponseSchema,
  projectEffortResponseSchema,
  projectKpisResponseSchema,
  projectOverdueResponseSchema,
  projectTicketsResponseSchema,
} from '@ky-azeroth/shared/schemas';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

const STALE_TIME = 5 * 60 * 1000;

function rangeParams(range: AnalyticsRangeValue): Record<string, string | undefined> {
  return {
    preset: range.preset,
    startDate: range.startDate,
    endDate: range.endDate,
  };
}

export function useProjectKpis(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'projects', 'kpis', range],
    queryFn: async () => {
      const res = await api.get('/analytics/projects/kpis', {
        params: rangeParams(range),
      });
      return projectKpisResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useProjectDistribution(dimension: 'status' | 'category') {
  return useQuery({
    queryKey: ['analytics', 'projects', 'distribution', dimension],
    queryFn: async () => {
      const res = await api.get('/analytics/projects/distribution', {
        params: { dimension },
      });
      return projectDistributionResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useProjectEffort(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'projects', 'effort', range],
    queryFn: async () => {
      const res = await api.get('/analytics/projects/effort', {
        params: rangeParams(range),
      });
      return projectEffortResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useProjectTickets(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'projects', 'tickets', range],
    queryFn: async () => {
      const res = await api.get('/analytics/projects/tickets', {
        params: rangeParams(range),
      });
      return projectTicketsResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useProjectOverdue() {
  return useQuery({
    queryKey: ['analytics', 'projects', 'overdue'],
    queryFn: async () => {
      const res = await api.get('/analytics/projects/overdue');
      return projectOverdueResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}
