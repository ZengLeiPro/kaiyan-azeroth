import type { PermissionActionKey } from '@ky-azeroth/shared/constants';
import { type AuthUserOutput, refreshTokenResponseSchema } from '@ky-azeroth/shared/schemas/auth';
import type { Permission } from '@ky-azeroth/shared/types/auth';
import axios from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { serializeTokenRotation } from '@/lib/auth-token-rotation';
import { logger } from '@/lib/logger';
import { queryClient } from '@/lib/query-client';
import { clearRateLimitError } from '@/stores/rate-limit';

/** 权限动作类型 */
export type PermissionActionType = PermissionActionKey;
export type RefreshApplyResult = 'applied' | 'stale' | 'invalid';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  user: AuthUserOutput | null;
  isAuthenticated: boolean;
  refreshTimer: ReturnType<typeof setTimeout> | null;

  // Actions
  setTokens: (accessToken: string, refreshToken: string, expiresIn?: number) => void;
  setUser: (user: AuthUserOutput) => void;
  /** 仅当 refresh token 代际仍匹配时，单次原子提交 tokens + 服务端最新 user。 */
  applyRefreshResponse: (expectedRefreshToken: string, data: unknown) => RefreshApplyResult;
  logout: () => void;
  hasRole: (roleCode: string) => boolean;
  isAdmin: () => boolean;
  /** 检查用户是否对指定模块有某个操作权限 */
  hasPermission: (module: string, action: PermissionActionType) => boolean;
  /** 检查用户是否对指定模块+菜单有某个操作权限 */
  hasMenuPermission: (module: string, menu: string, action: PermissionActionType) => boolean;
  /** 检查用户在指定菜单上是否拥有全部数据范围 */
  hasViewScopeAll: (module: string, menu: string) => boolean;
  /** 获取用户所有权限（聚合多角色） */
  getPermissions: () => Permission[];
  /** 获取用户有 view 权限的模块列表 */
  getViewableModules: () => string[];
  /** 获取用户在指定模块下有 view 权限的菜单列表 */
  getViewableMenus: (module: string) => string[];
  isTokenValid: () => boolean;
  startAutoRefresh: () => void;
  stopAutoRefresh: () => void;
}

// 获取 API 基础 URL（与 api.ts 保持一致）
const getBaseURL = () => {
  const envBaseURL = import.meta.env.VITE_API_BASE_URL;
  if (envBaseURL) {
    return envBaseURL.endsWith('/api/v1') ? envBaseURL : `${envBaseURL.replace(/\/$/, '')}/api/v1`;
  }
  return '/api/v1';
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      user: null,
      isAuthenticated: false,
      refreshTimer: null,

      setTokens: (accessToken, refreshToken, expiresIn?) => {
        set({
          accessToken,
          refreshToken,
          // 计算并保存过期时间（如果提供了 expiresIn）
          tokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
          isAuthenticated: true,
        });

        // 启动自动刷新
        get().startAutoRefresh();
      },

      setUser: (user) => {
        const currentUserId = get().user?.id;
        if (currentUserId && currentUserId !== user.id) {
          queryClient.clear();
        }
        set({ user });
      },

      applyRefreshResponse: (expectedRefreshToken, data) => {
        const parsed = refreshTokenResponseSchema.safeParse(data);
        if (!parsed.success) return 'invalid';

        const outcome = { value: 'stale' as RefreshApplyResult };
        set((state) => {
          // CAS：较旧 refresh 响应不得覆盖已轮换到更新代际的会话。
          if (state.refreshToken !== expectedRefreshToken) return state;
          // refresh 只能更新当前身份；缺失本地用户或服务端身份漂移均 fail-closed。
          if (!state.user || state.user.id !== parsed.data.user.id) {
            outcome.value = 'invalid';
            return state;
          }

          outcome.value = 'applied';
          return {
            accessToken: parsed.data.accessToken,
            refreshToken: parsed.data.refreshToken,
            tokenExpiresAt: Date.now() + parsed.data.expiresIn * 1000,
            user: parsed.data.user,
            isAuthenticated: true,
          };
        });

        if (outcome.value === 'applied') get().startAutoRefresh();
        return outcome.value;
      },

      logout: () => {
        // 停止自动刷新并清理当前会话的全局限流状态
        get().stopAutoRefresh();
        clearRateLimitError();
        queryClient.clear();

        set({
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          user: null,
          isAuthenticated: false,
        });
      },

      hasRole: (roleCode) => {
        const { user } = get();
        return user?.roles.some((role) => role.code === roleCode) ?? false;
      },

      isAdmin: () => {
        return get().hasRole('ADMIN');
      },

      hasPermission: (module, action) => {
        const { user } = get();
        if (!user) return false;
        // 检查用户所有角色的权限（任意角色有权限即可）。ADMIN 同样遵循角色权限配置。
        return user.roles.some((role) =>
          role.permissions?.some((p) => p.module === module && p[action] === true)
        );
      },

      hasMenuPermission: (module, menu, action) => {
        const { user } = get();
        if (!user) return false;
        return user.roles.some((role) =>
          role.permissions?.some(
            (p) => p.module === module && p.menu === menu && p[action] === true
          )
        );
      },

      hasViewScopeAll: (module, menu) => {
        const { user } = get();
        if (!user) return false;
        return user.roles.some((role) =>
          role.permissions?.some(
            (p) => p.module === module && p.menu === menu && p.view && p.viewScope === 'ALL'
          )
        );
      },

      getPermissions: () => {
        const { user } = get();
        if (!user) return [];
        const allPerms: Permission[] = [];
        user.roles.forEach((role) => {
          if (role.permissions) {
            allPerms.push(...role.permissions);
          }
        });
        return allPerms;
      },

      getViewableModules: () => {
        const { user } = get();
        if (!user) return [];
        const modules = new Set<string>();
        user.roles.forEach((role) => {
          role.permissions?.forEach((p) => {
            if (p.view) modules.add(p.module);
          });
        });
        return Array.from(modules);
      },

      getViewableMenus: (module) => {
        const { user } = get();
        if (!user) return [];
        const menus = new Set<string>();
        user.roles.forEach((role) => {
          role.permissions?.forEach((p) => {
            if (p.module === module && p.view) menus.add(p.menu);
          });
        });
        return Array.from(menus);
      },

      // 检查 token 是否有效（未过期）
      // 对于旧数据（没有 tokenExpiresAt），返回 false 强制重新登录
      isTokenValid: () => {
        const { tokenExpiresAt } = get();
        if (!tokenExpiresAt) {
          return false;
        }
        return tokenExpiresAt > Date.now();
      },

      // 启动自动刷新定时器
      startAutoRefresh: () => {
        const state = get();

        // 清除现有定时器
        if (state.refreshTimer) {
          clearTimeout(state.refreshTimer);
        }

        const { tokenExpiresAt, refreshToken } = state;
        if (!tokenExpiresAt || !refreshToken) return;

        // 在过期前 5 分钟刷新
        const refreshTime = tokenExpiresAt - Date.now() - 5 * 60 * 1000;

        if (refreshTime > 0) {
          const timer = setTimeout(async () => {
            try {
              const currentRefreshToken = get().refreshToken;
              if (!currentRefreshToken) return;

              await serializeTokenRotation(
                async () => {
                  const current = get();
                  if (current.refreshToken !== currentRefreshToken && current.accessToken) return;
                  const response = await axios.post(`${getBaseURL()}/auth/refresh`, {
                    refreshToken: currentRefreshToken,
                  });
                  const result = get().applyRefreshResponse(currentRefreshToken, response.data);
                  if (result === 'invalid') {
                    // HTTP 200 但认证响应不完整/身份漂移时不得保留旧声明。
                    get().logout();
                    logger.warn('AuthStore', '主动刷新响应无效，已清除本地认证状态');
                  }
                },
                () => useAuthStore.persist.rehydrate()
              );
            } catch {
              // 网络/服务端失败不立即登出，等待下次请求触发被动刷新。
              logger.warn('AuthStore', '主动刷新 Token 失败，将在下次请求时重试');
            }
          }, refreshTime);

          set({ refreshTimer: timer });
        }
      },

      // 停止自动刷新定时器
      stopAutoRefresh: () => {
        const { refreshTimer } = get();
        if (refreshTimer) {
          clearTimeout(refreshTimer);
          set({ refreshTimer: null });
        }
      },
    }),
    {
      name: 'ky-azeroth-auth',
      // refresh 响应现要求完整 user；清除旧版本中可能含 旧超管标记 的缓存声明。
      version: 4,
      migrate: () => undefined,
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
