import { analyticsOverviewResponseSchema } from '@ky-azeroth/shared/schemas';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

export function useAnalyticsOverview(range: AnalyticsRangeValue) {
  return useQuery({
    queryKey: ['analytics', 'overview', range],
    queryFn: async () => {
      const res = await api.get('/analytics/overview', {
        params: {
          preset: range.preset,
          startDate: range.startDate,
          endDate: range.endDate,
        },
      });
      return analyticsOverviewResponseSchema.parse(res.data);
    },
    staleTime: 5 * 60 * 1000,
  });
}
