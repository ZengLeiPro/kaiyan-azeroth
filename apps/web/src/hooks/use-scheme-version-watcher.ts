import type { FilterSchemeVersionMapResponse } from '@ky-azeroth/shared/schemas/filter-scheme';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { filterSchemeQueryKey } from '@/hooks/use-filter-scheme';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

/**
 * 全局监听 filter-scheme 版本变化的 hook。
 *
 * 仅在以下两个时机拉取 `/filter-schemes/version-map`，不做定时轮询：
 * - 窗口 focus
 * - document.visibilityState 变为 visible
 *
 * 对比新旧 version-map，每个变化的 pageKey 都 invalidate 对应的
 * `['filter-scheme', pageKey]` react-query 缓存。useFilterScheme 因而会
 * 自动重拉新配置；配合 useManualFilter 的 `schemeVersion` reset 机制，
 * 业务页会在下一次渲染周期自动按新 scheme 重渲筛选栏并发出新的列表查询。
 *
 * 未登录状态不发请求（避免无意义拉接口与 401 循环）。
 */
export function useSchemeVersionWatcher(): void {
  const queryClient = useQueryClient();
  const lastVersionMapRef = useRef<Record<string, number>>({});
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const check = useCallback(async () => {
    try {
      const res = await api.get<FilterSchemeVersionMapResponse>('/filter-schemes/version-map');
      const versionMap = res.data ?? {};

      for (const [pageKey, version] of Object.entries(versionMap)) {
        if (lastVersionMapRef.current[pageKey] !== version) {
          queryClient.invalidateQueries({ queryKey: filterSchemeQueryKey(pageKey) });
        }
      }

      lastVersionMapRef.current = versionMap;
    } catch {
      // 静默失败：版本探测本身不应该打断业务流程；下一次 focus/visibility 会再试
    }
  }, [queryClient]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const onFocus = () => {
      void check();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    void check();

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [check, isAuthenticated]);
}
