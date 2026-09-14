import type { IProjectTicketStats } from '@ky-azeroth/shared/types/project-ticket';
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '@/lib/api';

/**
 * 拉取项目工单统计数据
 */
export function useTicketStats() {
  const { data, isLoading, refetch } = useQuery<IProjectTicketStats>({
    queryKey: ['project-tickets', 'stats'],
    queryFn: async () => {
      const response = await api.get<IProjectTicketStats>('/project-tickets/stats');
      return response.data;
    },
    staleTime: 30 * 1000,
  });

  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return {
    stats: data ?? null,
    loading: isLoading,
    refresh,
  };
}
