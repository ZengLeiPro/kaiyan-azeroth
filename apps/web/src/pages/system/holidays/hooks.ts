import type {
  HolidayItem,
  HolidayListResponse,
  HolidayYearResponse,
} from '@ky-azeroth/shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

export const holidaysQueryKey = (year: number) => ['holidays', year] as const;

/**
 * 拉取指定年份的节假日（首次空、跳年缓存 5 分钟）
 *
 * GET 接口返回标准分页结构（整年作为单页），与 CLI 自动发现的 list 命令对齐。
 * 前端只消费 `.items`，逻辑与旧 `HolidayYearResponse.items` 完全一致。
 */
export function useHolidaysQuery(year: number) {
  return useQuery<HolidayListResponse>({
    queryKey: holidaysQueryKey(year),
    queryFn: async () => {
      const res = await api.get<HolidayListResponse>('/holidays', { params: { year } });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * 整年发布
 *
 * 入参带 confirmEmpty：当 items=[] 且 DB 该年有 >= 阈值条记录时，
 * 后端强制要求 confirmEmpty=true 才能清空全年（防误操作）。
 */
export interface PublishHolidaysVars {
  items: HolidayItem[];
  confirmEmpty?: boolean;
}

export function usePublishHolidaysMutation(year: number) {
  const queryClient = useQueryClient();
  return useMutation<HolidayYearResponse, unknown, PublishHolidaysVars>({
    mutationFn: async ({ items, confirmEmpty }) => {
      const res = await api.put<HolidayYearResponse>(`/holidays/year/${year}`, {
        year,
        items,
        ...(confirmEmpty ? { confirmEmpty: true } : {}),
      });
      return res.data;
    },
    onSuccess: (data) => {
      // PUT 返回 `HolidayYearResponse`（year+items），GET 缓存契约是 `HolidayListResponse`
      // （分页结构）。转形后再 prime 缓存，避免后续读 total/page/pageSize 拿到 undefined。
      const primed: HolidayListResponse = {
        items: data.items,
        total: data.items.length,
        page: 1,
        pageSize: data.items.length || 100,
        totalPages: 1,
      };
      queryClient.setQueryData(holidaysQueryKey(year), primed);
    },
  });
}
