import {
  orgApprovalSlaResponseSchema,
  orgCompletionResponseSchema,
  orgDepartmentOverviewResponseSchema,
  orgHeadcountTrendResponseSchema,
  orgKpisResponseSchema,
  orgSalesActivityResponseSchema,
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

export function useOrgKpis(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'organization', 'kpis', range],
    queryFn: async () => {
      const res = await api.get('/analytics/organization/kpis', {
        params: rangeParams(range),
      });
      return orgKpisResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useOrgCompletion(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'organization', 'completion', range],
    queryFn: async () => {
      const res = await api.get('/analytics/organization/completion', {
        params: rangeParams(range),
      });
      return orgCompletionResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useOrgSalesActivity(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'organization', 'sales-activity', range],
    queryFn: async () => {
      const res = await api.get('/analytics/organization/sales-activity', {
        params: rangeParams(range),
      });
      return orgSalesActivityResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useOrgApprovalSla(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'organization', 'approval-sla', range],
    queryFn: async () => {
      const res = await api.get('/analytics/organization/approval-sla', {
        params: rangeParams(range),
      });
      return orgApprovalSlaResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useOrgHeadcountTrend(months = 12) {
  return useQuery({
    queryKey: ['analytics', 'organization', 'headcount-trend', months],
    queryFn: async () => {
      const res = await api.get('/analytics/organization/headcount-trend', { params: { months } });
      return orgHeadcountTrendResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}

export function useOrgDepartmentOverview() {
  return useQuery({
    queryKey: ['analytics', 'organization', 'department-overview'],
    queryFn: async () => {
      const res = await api.get('/analytics/organization/department-overview');
      return orgDepartmentOverviewResponseSchema.parse(res.data);
    },
    staleTime: STALE_TIME,
  });
}
