import type {
  TablePreferenceConfig,
  TablePreferenceResponse,
} from '@ky-azeroth/shared/schemas/table-preference';

import { api } from './api';

/**
 * 计算单一 pageKey：与后端 TablePreference.pageKey 字段一一对应。
 * - 普通页面：`pathname`
 * - 同路径多表（如 ApprovalsPage 的 tabs）：`pathname:storageId`
 */
export function buildTablePreferencePageKey(pathname: string, storageId?: string): string {
  return storageId ? `${pathname}:${storageId}` : pathname;
}

interface CacheEntry {
  promise: Promise<TablePreferenceResponse | null>;
  expiresAt: number;
}

const FETCH_CACHE_TTL_MS = 5_000;
const fetchCache = new Map<string, CacheEntry>();

/**
 * 拉取某 pageKey 的全员默认配置。
 *
 * 5 秒内同 pageKey 的请求共享同一个 Promise，避免 useColumnVisibility + useColumnWidths
 * 同时挂载时各发一次重复请求。
 */
export function fetchTablePreference(pageKey: string): Promise<TablePreferenceResponse | null> {
  if (!pageKey) return Promise.resolve(null);
  const now = Date.now();
  const cached = fetchCache.get(pageKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = api
    .get<TablePreferenceResponse | null>('/table-preferences', { params: { pageKey } })
    .then((res) => res.data ?? null)
    .catch(() => null);

  fetchCache.set(pageKey, { promise, expiresAt: now + FETCH_CACHE_TTL_MS });
  return promise;
}

/** 让缓存即时失效（推送成功后调用，避免缓存让二次 fetch 拿到旧数据） */
export function invalidateTablePreferenceCache(pageKey: string): void {
  fetchCache.delete(pageKey);
}

/** 管理员推送：服务端 version 会自增 1 后返回 */
export async function saveTablePreference(
  pageKey: string,
  config: TablePreferenceConfig
): Promise<TablePreferenceResponse> {
  const res = await api.put<TablePreferenceResponse>('/table-preferences', { pageKey, config });
  invalidateTablePreferenceCache(pageKey);
  return res.data;
}
