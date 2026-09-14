/**
 * 销售数据闭环：TanStack Query hooks（两卡 / 独立列表页 / 详情抽屉 / 移动端共用）
 *
 * 端点契约见 assets/20260530/闭环实施产物/接口契约.md：
 * - GET    /sales-action-items/my        我的待办（强制 employeeId=当前登录人）
 * - GET    /sales-action-items/my/count  我的未处理数量（卡片 badge / 红点）
 * - GET    /sales-action-items           管理端全量（ADMIN/林审批按 employeeId/sourceRunId/status/category 筛）
 * - POST   /sales-action-items/:id/adopt 一键采纳（仅 FILL_CONFIRM + keep_record）
 * - POST   /sales-action-items/:id/ignore 忽略（resolveNote 必填）
 * - POST   /sales-action-items/:id/done  办结（doneType + resolveNote 必填；跟进情况可同步写跟进记录）
 * - POST   /sales-action-items/:id/transfer 转交（全员视图角色；targetEmployeeId + reason 必填）
 * - POST   /sales-action-items/:id/reopen 已办结改回待办（done → pending）
 * - POST   /sales-action-items/:id/undo  撤销已采纳（限当日 / ADMIN）
 *
 * 硬约束：
 * - endpoint 不带 /api/v1（baseURL 已含版本）。
 * - 采纳只能走 POST /:id/adopt，绝不直接 api.post('/keep-records')。
 * - 处置（adopt/ignore/done）对非 pending 不报错，返回当前状态 → 前端直接刷新列表。
 * - 数组型 query（category/status/confidence）用重复 key 序列化（?category=A&category=B），后端两种都兼容。
 */
import type {
  IDoneSalesActionItemKeepRecord,
  ISalesActionItem,
  ISalesActionItemResponse,
  SalesActionItemCategory,
  SalesActionItemDoneType,
  SalesActionItemStatus,
} from '@ky-azeroth/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

/** 列表响应（与后端 SalesActionItemList 对齐：items + total + 分页元数据） */
export interface SalesActionItemListResponse {
  items: ISalesActionItemResponse[];
  total: number;
  page?: number;
  pageSize?: number;
}

/** /my 与 /（管理端）共用的查询参数 */
export interface SalesActionItemsQuery {
  [key: string]: unknown;
  category?: SalesActionItemCategory[] | string[];
  status?: SalesActionItemStatus[] | string[];
  doneType?: SalesActionItemDoneType[] | string[];
  confidence?: string[];
  employeeId?: string;
  customerId?: string | string[];
  sourceRunId?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** 管理端 keyword（按需，后端 schema-driven 列表支持） */
  keyword?: string;
}

// ============================================================================
// queryKey 工厂（统一前缀，便于 invalidate 一把刷全部）
// ============================================================================

export const salesActionItemsKeys = {
  all: ['sales-action-items'] as const,
  my: (params: SalesActionItemsQuery) => ['sales-action-items', 'my', params] as const,
  count: (category?: string[]) => ['sales-action-items', 'my', 'count', category ?? null] as const,
  admin: (params: SalesActionItemsQuery) => ['sales-action-items', 'admin', params] as const,
  adminCount: (category?: string[]) =>
    ['sales-action-items', 'admin', 'count', category ?? null] as const,
  detail: (id: string | null) => ['sales-action-items', 'detail', id] as const,
};

/** 重复 key 数组序列化：category=A&category=B（不带 []） */
const repeatKeySerializer = (params: Record<string, unknown>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null && v !== '') search.append(key, String(v));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
};

// ============================================================================
// 查询
// ============================================================================

/** 我的待办（两卡 / 列表页「我的」视图） */
export function useMyActionItems(params: SalesActionItemsQuery, enabled = true) {
  return useQuery<SalesActionItemListResponse>({
    queryKey: salesActionItemsKeys.my(params),
    queryFn: async () => {
      const res = await api.get<SalesActionItemListResponse>('/sales-action-items/my', {
        params,
        paramsSerializer: repeatKeySerializer,
      });
      return res.data;
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/** 我的未处理数量（卡片 badge / 红点 / 移动端） */
export function useMyActionItemCount(category?: string[], enabled = true) {
  return useQuery<number>({
    queryKey: salesActionItemsKeys.count(category),
    queryFn: async () => {
      const res = await api.get<{ count: number }>('/sales-action-items/my/count', {
        params: category && category.length ? { category } : undefined,
        paramsSerializer: repeatKeySerializer,
      });
      return res.data?.count ?? 0;
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/** 管理端全量未处理数量（ADMIN 工作台 badge / 红点） */
export function useAdminActionItemCount(category?: string[], enabled = true) {
  return useQuery<number>({
    queryKey: salesActionItemsKeys.adminCount(category),
    queryFn: async () => {
      const res = await api.get<SalesActionItemListResponse>('/sales-action-items', {
        params: {
          category,
          status: ['pending'],
          page: 1,
          pageSize: 1,
          sortBy: 'priority',
          sortOrder: 'desc',
        },
        paramsSerializer: repeatKeySerializer,
      });
      return res.data?.total ?? 0;
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

/** 管理端全量（ADMIN/林审批：按 employeeId/sourceRunId/status/category 筛） */
export function useAdminActionItems(params: SalesActionItemsQuery, enabled = true) {
  return useQuery<SalesActionItemListResponse>({
    queryKey: salesActionItemsKeys.admin(params),
    queryFn: async () => {
      const res = await api.get<SalesActionItemListResponse>('/sales-action-items', {
        params,
        paramsSerializer: repeatKeySerializer,
      });
      return res.data;
    },
    enabled,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// 处置 mutation（处置后统一 invalidate 两卡 + my/count + 列表）
// ============================================================================

/** 处置成功后刷新所有相关查询（两卡 / count / 列表 / 管理端） */
export function useInvalidateActionItems() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: salesActionItemsKeys.all });
}

/** 一键采纳：仅 FILL_CONFIRM + aiDraft.kind==='keep_record'（按钮显隐由调用方控制） */
export function useAdoptActionItem() {
  const invalidate = useInvalidateActionItems();
  return useMutation<ISalesActionItem, unknown, string>({
    mutationFn: async (id: string) => {
      const res = await api.post<ISalesActionItem>(`/sales-action-items/${id}/adopt`);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

/** 忽略：resolveNote 必填 */
export function useIgnoreActionItem() {
  const invalidate = useInvalidateActionItems();
  return useMutation<ISalesActionItem, unknown, { id: string; resolveNote: string }>({
    mutationFn: async ({ id, resolveNote }) => {
      const res = await api.post<ISalesActionItem>(`/sales-action-items/${id}/ignore`, {
        resolveNote,
      });
      return res.data;
    },
    onSuccess: invalidate,
  });
}

/** 办结：doneType + resolveNote 必填；跟进情况可同步写跟进记录 */
export function useDoneActionItem() {
  const invalidate = useInvalidateActionItems();
  return useMutation<
    ISalesActionItem,
    unknown,
    {
      id: string;
      doneType: SalesActionItemDoneType | string;
      resolveNote: string;
      keepRecord?: IDoneSalesActionItemKeepRecord;
    }
  >({
    mutationFn: async ({ id, doneType, resolveNote, keepRecord }) => {
      const res = await api.post<ISalesActionItem>(`/sales-action-items/${id}/done`, {
        doneType,
        resolveNote,
        ...(keepRecord ? { keepRecord } : {}),
      });
      return res.data;
    },
    onSuccess: invalidate,
  });
}

/** 转交：全员视图角色把待办转给另一位员工，目标员工获得一条 pending 待办 */
export function useTransferActionItem() {
  const invalidate = useInvalidateActionItems();
  return useMutation<
    ISalesActionItem,
    unknown,
    { id: string; targetEmployeeId: string; reason: string }
  >({
    mutationFn: async ({ id, targetEmployeeId, reason }) => {
      const res = await api.post<ISalesActionItem>(`/sales-action-items/${id}/transfer`, {
        targetEmployeeId,
        reason,
      });
      return res.data;
    },
    onSuccess: invalidate,
  });
}

/** 撤销已采纳：软删生成的跟进记录，回 pending（限当日 / ADMIN，非当日非 ADMIN 后端返 400） */
export function useUndoActionItem() {
  const invalidate = useInvalidateActionItems();
  return useMutation<ISalesActionItem, unknown, string>({
    mutationFn: async (id: string) => {
      const res = await api.post<ISalesActionItem>(`/sales-action-items/${id}/undo`);
      return res.data;
    },
    onSuccess: invalidate,
  });
}

/** 已办结改回待办：仅 done → pending；若办结生成了跟进记录，后端会同步回收 */
export function useReopenActionItem() {
  const invalidate = useInvalidateActionItems();
  return useMutation<ISalesActionItem, unknown, string>({
    mutationFn: async (id: string) => {
      const res = await api.post<ISalesActionItem>(`/sales-action-items/${id}/reopen`);
      return res.data;
    },
    onSuccess: invalidate,
  });
}
