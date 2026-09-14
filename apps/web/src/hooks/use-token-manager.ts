import axios from 'axios';
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { getBaseURL } from '@/lib/api';
import { serializeTokenRotation } from '@/lib/auth-token-rotation';
import { useAuthStore } from '@/stores/auth';

// Token 检查间隔（毫秒）
const CHECK_INTERVAL = 60 * 1000; // 每 60 秒检查一次
// 提前刷新时间（毫秒）
const REFRESH_THRESHOLD = 2 * 60 * 1000; // 提前 2 分钟刷新

/**
 * Token 管理 Hook
 *
 * 功能：
 * - 定期检查 token 是否即将过期
 * - 即将过期时自动刷新 token
 * - 刷新失败或已过期时自动登出并跳转到登录页
 */
export function useTokenManager() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tokenExpiresAt, refreshToken, logout, applyRefreshResponse, isAuthenticated } =
    useAuthStore();
  const navigateToLogin = useCallback(() => {
    const target = `${location.pathname}${location.search}${location.hash}`;
    navigate(`/login?redirect=${encodeURIComponent(target)}`, {
      replace: true,
      state: { from: target },
    });
  }, [location.hash, location.pathname, location.search, navigate]);

  // 刷新 token 的函数
  const refreshAccessToken = useCallback(async () => {
    if (!refreshToken) {
      logout();
      navigateToLogin();
      return false;
    }

    try {
      await serializeTokenRotation(
        async () => {
          const current = useAuthStore.getState();
          if (current.refreshToken !== refreshToken && current.accessToken) return;
          const response = await axios.post(`${getBaseURL()}/auth/refresh`, { refreshToken });
          const result = applyRefreshResponse(refreshToken, response.data);
          if (result === 'invalid') throw new Error('刷新响应无效');
        },
        () => useAuthStore.persist.rehydrate()
      );
      return true;
    } catch {
      const current = useAuthStore.getState();
      if (current.refreshToken !== refreshToken && current.accessToken) return true;
      // 刷新失败，登出并跳转
      logout();
      navigateToLogin();
      return false;
    }
  }, [refreshToken, logout, applyRefreshResponse, navigateToLogin]);

  // 检查 token 状态的函数
  const checkTokenStatus = useCallback(async () => {
    // 未登录状态不检查
    if (!isAuthenticated) {
      return;
    }

    // 没有过期时间信息（旧数据），强制登出
    if (!tokenExpiresAt) {
      logout();
      navigateToLogin();
      return;
    }

    const now = Date.now();
    const timeUntilExpiry = tokenExpiresAt - now;

    // token 已过期，直接登出
    if (timeUntilExpiry <= 0) {
      logout();
      navigateToLogin();
      return;
    }

    // token 即将过期（在 REFRESH_THRESHOLD 内），尝试刷新
    if (timeUntilExpiry <= REFRESH_THRESHOLD) {
      await refreshAccessToken();
    }
  }, [isAuthenticated, tokenExpiresAt, logout, navigateToLogin, refreshAccessToken]);

  useEffect(() => {
    // 未登录状态不启动定时器
    if (!isAuthenticated) {
      return;
    }

    // 初始检查
    checkTokenStatus();

    // 设置定时器，定期检查
    const intervalId = setInterval(checkTokenStatus, CHECK_INTERVAL);

    // 清理定时器
    return () => {
      clearInterval(intervalId);
    };
  }, [isAuthenticated, checkTokenStatus]);
}
