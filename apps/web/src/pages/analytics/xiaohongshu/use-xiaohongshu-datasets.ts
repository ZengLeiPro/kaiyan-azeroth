import type {
  IXiaohongshuDatasetCatalogResponse,
  IXiaohongshuDatasetQueryResponse,
  XiaohongshuDataCaliber,
  XiaohongshuJsonValue,
} from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

export interface XiaohongshuDatasetQueryInput {
  datasetId: string;
  advertiserId: string;
  startDate?: string;
  endDate?: string;
  dataCaliber: XiaohongshuDataCaliber;
  page: number;
  pageSize: number;
  params?: Record<string, XiaohongshuJsonValue>;
}

export function useXiaohongshuDatasetCatalog(advertiserId?: string) {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'datasets', advertiserId],
    queryFn: async () => {
      const response = await api.get<IXiaohongshuDatasetCatalogResponse>('/xiaohongshu/datasets', {
        params: { advertiserId: advertiserId || undefined },
      });
      return response.data;
    },
    enabled: Boolean(advertiserId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useXiaohongshuDatasetQuery(input: XiaohongshuDatasetQueryInput, enabled = true) {
  return useQuery({
    queryKey: ['analytics', 'xiaohongshu', 'dataset-query', input],
    queryFn: async () => {
      const response = await api.post<IXiaohongshuDatasetQueryResponse>(
        `/xiaohongshu/datasets/${encodeURIComponent(input.datasetId)}/query`,
        {
          advertiserId: input.advertiserId,
          startDate: input.startDate,
          endDate: input.endDate,
          dataCaliber: input.dataCaliber,
          page: input.page,
          pageSize: input.pageSize,
          params: input.params ?? {},
        }
      );
      return response.data;
    },
    enabled: enabled && Boolean(input.datasetId && input.advertiserId),
    staleTime: 60 * 1000,
    retry: false,
  });
}
