import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';

// ========== 深度比较工具 ==========

/**
 * 简单的深度比较函数
 * 通过 JSON 序列化比较对象内容是否相等
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * 使用深度比较来稳定对象引用
 * 只有当对象内容真正变化时才返回新引用
 */
function useDeepCompareMemoize<T>(value: T): T {
  const committedRef = useRef<T>(value);
  const memoizedValue = isDeepEqual(committedRef.current, value) ? committedRef.current : value;

  // 只在 commit 后发布新引用；Suspense 放弃的 render 不能污染仍在使用的查询参数 identity。
  useLayoutEffect(() => {
    committedRef.current = memoizedValue;
  }, [memoizedValue]);

  return memoizedValue;
}

/**
 * 后端分页响应数据格式
 */
export interface ServerPaginationResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface RequestConfigIdentity {
  endpoint: string;
  queryParams: Record<string, unknown>;
  autoLoad: boolean;
  transformKey: unknown;
}

interface CommittedRequestConfig {
  identity: RequestConfigIdentity;
  generation: number;
  baselineSequence: number;
}

interface RequestToken {
  identity: RequestConfigIdentity;
  generation: number;
  sequence: number;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

/**
 * transform 与 HTTP 原始响应共用同一份运行时契约；校验完成前不向 state 提交任何分页字段。
 */
function validatePaginationResponse<T>(value: unknown): ServerPaginationResponse<T> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('分页响应无效：必须是对象');
  }

  const response = value as {
    items?: unknown;
    total?: unknown;
    page?: unknown;
    pageSize?: unknown;
    totalPages?: unknown;
  };

  if (!Array.isArray(response.items)) {
    throw new Error('分页响应无效：items 必须是数组');
  }
  if (!isNonNegativeSafeInteger(response.total)) {
    throw new Error('分页响应无效：total 必须是非负安全整数');
  }
  if (!isPositiveSafeInteger(response.page)) {
    throw new Error('分页响应无效：page 必须是正安全整数');
  }
  if (!isPositiveSafeInteger(response.pageSize)) {
    throw new Error('分页响应无效：pageSize 必须是正安全整数');
  }
  if (!isNonNegativeSafeInteger(response.totalPages)) {
    throw new Error('分页响应无效：totalPages 必须是非负安全整数');
  }

  const expectedTotalPages = Math.ceil(response.total / response.pageSize);
  if (response.totalPages !== expectedTotalPages) {
    throw new Error(
      `分页响应无效：totalPages 应为 ${expectedTotalPages}，实际为 ${response.totalPages}`
    );
  }

  return response as ServerPaginationResponse<T>;
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === 'string' ? value : '分页请求失败');
}

/**
 * 分页参数
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [key: string]: unknown; // 允许额外的筛选参数
}

/**
 * Hook 配置选项
 */
export interface UseServerPaginationOptions<T, TApiResponse = T> {
  /** API 路径 */
  endpoint: string;
  /** 初始页码 */
  initialPage?: number;
  /** 初始每页条数 */
  initialPageSize?: number;
  /** 初始排序字段 */
  initialSortBy?: string;
  /** 初始排序方向 */
  initialSortOrder?: 'asc' | 'desc';
  /** 额外的查询参数 */
  extraParams?: Record<string, unknown>;
  /** 是否自动加载 */
  autoLoad?: boolean;
  /** 数据转换函数；始终读取最近一次已提交的函数，不以函数 identity 触发重载。 */
  transform?: (data: unknown) => ServerPaginationResponse<TApiResponse>;
  /**
   * 转换语义键。仅当调用方明确改变该键时，才使旧响应失效并按 autoLoad 规则重载。
   * 对象类型的键应保持引用稳定；省略时 transform identity 变化不会创建新请求代际。
   */
  transformKey?: unknown;
  /**
   * sorting state 的持久化命名空间，与 useColumnVisibility / useColumnWidths 的 storageId 对齐。
   * - 传值：localStorage key = `server-pagination-sorting:${pathname}:${storageId}`
   * - 不传：key = `server-pagination-sorting:${pathname}`
   * 多 tab/视图（如审批 tab、销售待办 mine/all、客户 pool）必须传，否则 sorting 会串。
   */
  sortingStorageId?: string;
}

/**
 * sorting 持久化结构。
 * 同时被 useServerPagination（默认走 useCrud 的列表页）和
 * SalesActionItemsPage（自维护 sortBy state，不走 useServerPagination）共用。
 */
export interface PersistedSorting {
  v: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** 已应用的服务端 version；server 推送 version > 本地时强制覆盖 */
  appliedServerVersion: number;
}

export const SORTING_STORAGE_PREFIX = 'server-pagination-sorting:';
export const SORTING_STORAGE_VERSION = 1;

export function buildSortingStorageKey(storageId?: string): string {
  if (typeof window === 'undefined') return '';
  const base = SORTING_STORAGE_PREFIX + window.location.pathname;
  return storageId ? `${base}:${storageId}` : base;
}

export function loadPersistedSorting(storageId?: string): PersistedSorting | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(buildSortingStorageKey(storageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Partial<PersistedSorting> & Record<string, unknown>;
      if (obj.v === SORTING_STORAGE_VERSION) {
        return {
          v: SORTING_STORAGE_VERSION,
          sortBy: typeof obj.sortBy === 'string' ? obj.sortBy : undefined,
          sortOrder:
            obj.sortOrder === 'asc' || obj.sortOrder === 'desc' ? obj.sortOrder : undefined,
          appliedServerVersion:
            typeof obj.appliedServerVersion === 'number' ? obj.appliedServerVersion : 0,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function writePersistedSorting(payload: PersistedSorting, storageId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(buildSortingStorageKey(storageId), JSON.stringify(payload));
  } catch {
    // 静默忽略 localStorage 写入失败
  }
}

/**
 * 通用的后端分页 Hook
 *
 * @example
 * ```tsx
 * const { data, loading, pagination, refresh } = useServerPagination<Product>({
 *   endpoint: '/products',
 * });
 * ```
 */
export function useServerPagination<T, TApiResponse = T>({
  endpoint,
  initialPage = 1,
  initialPageSize = 100,
  initialSortBy,
  initialSortOrder,
  extraParams = {},
  autoLoad = true,
  transform,
  transformKey,
  sortingStorageId,
}: UseServerPaginationOptions<T, TApiResponse>) {
  // 分页状态
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // 排序状态：冷启动优先 localStorage > initialSortBy（用户本地选择覆盖 page 默认）
  const initialPersistedSortingRef = useRef<PersistedSorting | null>(null);
  if (initialPersistedSortingRef.current === null) {
    initialPersistedSortingRef.current = loadPersistedSorting(sortingStorageId);
  }
  const [sortBy, setSortBy] = useState<string | undefined>(
    initialPersistedSortingRef.current?.sortBy ?? initialSortBy
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(
    initialPersistedSortingRef.current?.sortOrder ?? initialSortOrder
  );
  const appliedServerSortingVersionRef = useRef<number>(
    initialPersistedSortingRef.current?.appliedServerVersion ?? 0
  );

  // sortingStorageId 运行时切换（如审批 tab 切换）：重新加载对应 key 的 sorting，避免串表
  const prevSortingStorageIdRef = useRef(sortingStorageId);
  useLayoutEffect(() => {
    if (prevSortingStorageIdRef.current === sortingStorageId) return;
    prevSortingStorageIdRef.current = sortingStorageId;
    const next = loadPersistedSorting(sortingStorageId);
    appliedServerSortingVersionRef.current = next?.appliedServerVersion ?? 0;
    setSortBy(next?.sortBy ?? initialSortBy);
    setSortOrder(next?.sortOrder ?? initialSortOrder);
    // initialSortBy / initialSortOrder 故意不进依赖：仅作为冷启动兜底
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortingStorageId]);

  // 数据与请求状态使用同一个 state，保证成功响应原子提交分页快照。
  const [requestState, setRequestState] = useState<{
    data: TApiResponse[];
    total: number;
    totalPages: number;
    loading: boolean;
    error: Error | null;
  }>({
    data: [],
    total: 0,
    totalPages: 0,
    loading: false,
    error: null,
  });
  const { data, total, totalPages, loading, error } = requestState;

  // ========== 关键修复：稳定 extraParams 引用 ==========
  const stableExtraParams = useDeepCompareMemoize(extraParams);

  // 构建查询参数 - 使用稳定的 extraParams
  const queryParams = useMemo(() => {
    const params: Record<string, unknown> = {
      page,
      pageSize,
      ...stableExtraParams,
    };

    if (sortBy) {
      params.sortBy = sortBy;
      params.sortOrder = sortOrder || 'asc';
    }

    return params;
  }, [page, pageSize, sortBy, sortOrder, stableExtraParams]);

  // identity 只描述请求/转换语义；transform 函数本身刻意不参与代际。
  const requestConfigIdentity = useMemo<RequestConfigIdentity>(
    () => ({ endpoint, queryParams, autoLoad, transformKey }),
    [endpoint, queryParams, autoLoad, transformKey]
  );

  const mountedRef = useRef(false);
  const generationCounterRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const committedRequestConfigRef = useRef<CommittedRequestConfig | null>(null);
  const committedTransformRef = useRef(transform);

  const isRequestCurrent = useCallback((token: RequestToken): boolean => {
    const committed = committedRequestConfigRef.current;
    return (
      mountedRef.current &&
      committed?.identity === token.identity &&
      committed.generation === token.generation &&
      requestSequenceRef.current === token.sequence
    );
  }, []);

  // mount 状态也只在 layout commit 中发布；StrictMode 的模拟卸载同步封死第一轮请求。
  useLayoutEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      generationCounterRef.current += 1;
      committedRequestConfigRef.current = null;
      committedTransformRef.current = undefined;
    };
  }, []);

  // 在 passive cleanup 之前发布 B 的 committed identity/generation，立即使 A 的 token 失效。
  useLayoutEffect(() => {
    committedTransformRef.current = transform;

    if (committedRequestConfigRef.current?.identity === requestConfigIdentity) return;

    requestSequenceRef.current += 1;
    generationCounterRef.current += 1;
    committedRequestConfigRef.current = {
      identity: requestConfigIdentity,
      generation: generationCounterRef.current,
      baselineSequence: requestSequenceRef.current,
    };
  }, [requestConfigIdentity, transform]);

  // 自动加载和手动刷新共享 sequence；旧 closure 必须先命中当前 commit 才能发请求。
  const loadData = useCallback(async () => {
    const committed = committedRequestConfigRef.current;
    if (!mountedRef.current || committed?.identity !== requestConfigIdentity) return;

    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    const token: RequestToken = {
      identity: requestConfigIdentity,
      generation: committed.generation,
      sequence: requestSequence,
    };

    setRequestState((current) =>
      isRequestCurrent(token)
        ? {
            ...current,
            loading: true,
            error: null,
          }
        : current
    );

    try {
      const response = await api.get(endpoint, { params: queryParams });
      if (!isRequestCurrent(token)) return;

      const currentTransform = committedTransformRef.current;
      const transformed = currentTransform ? currentTransform(response.data) : response.data;
      const paginationData = validatePaginationResponse<TApiResponse>(transformed);
      if (!isRequestCurrent(token)) return;

      setRequestState((current) =>
        isRequestCurrent(token)
          ? {
              data: paginationData.items,
              total: paginationData.total,
              totalPages: paginationData.totalPages,
              loading: false,
              error: null,
            }
          : current
      );
    } catch (err) {
      if (!isRequestCurrent(token)) return;

      setRequestState((current) =>
        isRequestCurrent(token)
          ? {
              ...current,
              loading: false,
              error: normalizeError(err),
            }
          : current
      );
    }
  }, [endpoint, isRequestCurrent, queryParams, requestConfigIdentity]);

  useEffect(() => {
    if (autoLoad) {
      void loadData();
      return;
    }

    // 只清理由本次 commit 失效的 loading；若 layout 中已手动发起新请求，sequence 会阻止清理。
    const committed = committedRequestConfigRef.current;
    if (!mountedRef.current || committed?.identity !== requestConfigIdentity) return;

    const token: RequestToken = {
      identity: requestConfigIdentity,
      generation: committed.generation,
      sequence: committed.baselineSequence,
    };
    setRequestState((current) =>
      isRequestCurrent(token) && current.loading
        ? {
            ...current,
            loading: false,
          }
        : current
    );
  }, [autoLoad, isRequestCurrent, loadData, requestConfigIdentity]);

  // 切换页码
  const goToPage = useCallback(
    (newPage: number) => {
      setPage(Math.max(1, Math.min(newPage, totalPages || 1)));
    },
    [totalPages]
  );

  // 切换每页条数
  const changePageSize = useCallback(
    (newPageSize: number) => {
      setPageSize(newPageSize);
      // 调整页码，确保不超出范围
      const newTotalPages = Math.ceil(total / newPageSize);
      if (page > newTotalPages) {
        setPage(Math.max(1, newTotalPages));
      }
    },
    [total, page]
  );

  // 切换排序（用户主动点表头）：写入 localStorage，setPage(1)
  const changeSort = useCallback(
    (field: string, order?: 'asc' | 'desc') => {
      const nextOrder = order || 'asc';
      setSortBy(field);
      setSortOrder(nextOrder);
      setPage(1); // 排序后回到第一页
      writePersistedSorting(
        {
          v: SORTING_STORAGE_VERSION,
          sortBy: field,
          sortOrder: nextOrder,
          appliedServerVersion: appliedServerSortingVersionRef.current,
        },
        sortingStorageId
      );
    },
    [sortingStorageId]
  );

  // 清除排序：清空 localStorage 的 sortBy/sortOrder（保留 version 锚）
  const clearSort = useCallback(() => {
    setSortBy(undefined);
    setSortOrder(undefined);
    writePersistedSorting(
      {
        v: SORTING_STORAGE_VERSION,
        sortBy: undefined,
        sortOrder: undefined,
        appliedServerVersion: appliedServerSortingVersionRef.current,
      },
      sortingStorageId
    );
  }, [sortingStorageId]);

  /**
   * 应用服务端全员默认排序（由 useColumnVisibility 在 fetch table-preference 成功时调用）。
   * 区别于 changeSort：不 setPage(1)（冷启动场景，分页本来就在第 1 页）；
   * 仅当 server version 大于本地 applied version 时才覆盖（与列显隐 B 模式覆盖对齐）。
   */
  const applyServerSorting = useCallback(
    (
      nextSortBy: string | undefined,
      nextSortOrder: 'asc' | 'desc' | undefined,
      version: number
    ) => {
      if (version <= appliedServerSortingVersionRef.current) return;
      appliedServerSortingVersionRef.current = version;
      setSortBy(nextSortBy);
      setSortOrder(nextSortOrder);
      writePersistedSorting(
        {
          v: SORTING_STORAGE_VERSION,
          sortBy: nextSortBy,
          sortOrder: nextSortOrder,
          appliedServerVersion: version,
        },
        sortingStorageId
      );
    },
    [sortingStorageId]
  );

  /**
   * admin 通过 ColumnVisibilityDropdown「保存为全员默认」后调用，
   * 把本地 appliedServerVersion 同步到 PUT 返回的新 version，避免 admin 自己页面再被覆盖一次。
   */
  const markServerSortingVersionApplied = useCallback(
    (version: number) => {
      appliedServerSortingVersionRef.current = version;
      writePersistedSorting(
        {
          v: SORTING_STORAGE_VERSION,
          sortBy,
          sortOrder,
          appliedServerVersion: version,
        },
        sortingStorageId
      );
    },
    [sortBy, sortOrder, sortingStorageId]
  );

  // 刷新当前页
  const refresh = useCallback(() => {
    loadData();
  }, [loadData]);

  // 重置到第一页
  const reset = useCallback(() => {
    setPage(initialPage);
    setPageSize(initialPageSize);
    setSortBy(initialSortBy);
    setSortOrder(initialSortOrder);
  }, [initialPage, initialPageSize, initialSortBy, initialSortOrder]);

  return {
    // 数据
    data,
    loading,
    error,
    /** 请求失败但仍保留最近一次成功快照 */
    stale: error !== null && data.length > 0,

    // 分页信息
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      goToPage,
      changePageSize,
      hasPrevPage: page > 1,
      hasNextPage: page < totalPages,
    },

    // 排序信息
    sorting: {
      sortBy,
      sortOrder,
      changeSort,
      clearSort,
      applyServerSorting,
      markServerSortingVersionApplied,
    },

    // 操作方法
    refresh,
    reset,
    loadData,
  };
}
