import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth';

/**
 * 在受保护路由渲染前刷新当前用户，避免角色权限变更后被持久化的旧 user 快照误判为 403。
 */
export function useAuthBootstrap(): boolean {
  const [isReady, setIsReady] = useState(() => {
    const { isAuthenticated, isTokenValid } = useAuthStore.getState();
    return !isAuthenticated || !isTokenValid();
  });

  useEffect(() => {
    const { isAuthenticated, isTokenValid, startAutoRefresh, user } = useAuthStore.getState();
    if (!isAuthenticated || !isTokenValid()) {
      setIsReady(true);
      return;
    }

    startAutoRefresh();
    let cancelled = false;
    const expectedUserId = user?.id;

    api
      .get('/auth/me')
      .then((res) => {
        if (cancelled) return;
        const current = useAuthStore.getState();
        if (current.isAuthenticated && current.user?.id === expectedUserId) {
          current.setUser(res.data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          logger.warn('App', '启动时刷新当前用户信息失败，继续使用 localStorage 缓存', err);
        }
      })
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return isReady;
}
