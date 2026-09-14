import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth';

import { useAuthBootstrap } from '../use-auth-bootstrap';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const originalState = useAuthStore.getState();

const staleUser = {
  id: 'user-1',
  username: 'user-1',
  roles: [{ id: 'role-1', code: 'SALES', name: '销售人员', permissions: [] }],
};

const freshUser = {
  ...staleUser,
  roles: [
    {
      ...staleUser.roles[0],
      permissions: [
        {
          module: 'analytics',
          menu: 'xiaohongshu',
          view: true,
        },
      ],
    },
  ],
};

describe('useAuthBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      ...originalState,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      user: null,
      isAuthenticated: false,
      refreshTimer: null,
      startAutoRefresh: vi.fn(),
    });
  });

  it('未登录时立即允许渲染且不请求当前用户', () => {
    const { result } = renderHook(() => useAuthBootstrap());

    expect(result.current).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('已登录时等待最新权限返回后才允许路由渲染', async () => {
    let resolveRequest!: (value: { data: typeof freshUser }) => void;
    vi.mocked(api.get).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }) as never
    );
    useAuthStore.setState({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 60_000,
      user: staleUser as never,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => useAuthBootstrap());

    expect(result.current).toBe(false);
    expect(api.get).toHaveBeenCalledWith('/auth/me');

    await act(async () => {
      resolveRequest({ data: freshUser });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current).toBe(true));
    expect(useAuthStore.getState().user).toEqual(freshUser);
  });

  it('刷新失败时保留缓存用户并解除启动阻塞', async () => {
    const error = new Error('network error');
    vi.mocked(api.get).mockRejectedValue(error);
    useAuthStore.setState({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      tokenExpiresAt: Date.now() + 60_000,
      user: staleUser as never,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => useAuthBootstrap());

    await waitFor(() => expect(result.current).toBe(true));
    expect(useAuthStore.getState().user).toEqual(staleUser);
    expect(logger.warn).toHaveBeenCalledWith(
      'App',
      '启动时刷新当前用户信息失败，继续使用 localStorage 缓存',
      error
    );
  });
});
