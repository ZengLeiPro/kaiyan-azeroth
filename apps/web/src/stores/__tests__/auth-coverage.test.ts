import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '@/lib/query-client';

import type { PermissionActionType } from '../auth';
import { useAuthStore } from '../auth';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { post: vi.fn() },
}));

const permission = (
  module: string,
  menu: string,
  actions: Partial<Record<PermissionActionType, boolean>>
) => ({
  id: `${module}-${menu}`,
  module,
  menu,
  view: false,
  create: false,
  edit: false,
  delete: false,
  export: false,
  approve: false,
  viewScope: 'ALL' as const,
  ...actions,
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '33333333-3333-4333-8333-333333333333';

const user = {
  id: USER_ID,
  username: 'admin',
  status: 'active',
  roles: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'ADMIN',
      name: '管理员',
      permissions: [
        permission('crm', 'customers', { view: true, edit: true }),
        permission('crm', 'contacts', { view: true }),
        permission('projects', 'tickets', { delete: true }),
      ],
    },
  ],
};

describe('useAuthStore', () => {
  afterEach(() => {
    useAuthStore.getState().stopAutoRefresh();
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.getState().stopAutoRefresh();
    useAuthStore.setState({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      user: null,
      isAuthenticated: false,
      refreshTimer: null,
    });
    vi.mocked(axios.post).mockReset();
    vi.restoreAllMocks();
  });

  it('setTokens 会保存过期时间并开启认证状态', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    useAuthStore.getState().setTokens('access', 'refresh', 3600);

    expect(useAuthStore.getState().accessToken).toBe('access');
    expect(useAuthStore.getState().refreshToken).toBe('refresh');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().tokenExpiresAt).toBe(Date.now() + 3600 * 1000);
    expect(useAuthStore.getState().isTokenValid()).toBe(true);
  });

  it('权限查询会聚合角色权限并按模块/菜单精确匹配', () => {
    useAuthStore.getState().setUser(user);

    expect(useAuthStore.getState().hasRole('ADMIN')).toBe(true);
    expect(useAuthStore.getState().isAdmin()).toBe(true);
    expect(useAuthStore.getState().hasPermission('crm', 'edit')).toBe(true);
    expect(useAuthStore.getState().hasMenuPermission('crm', 'customers', 'edit')).toBe(true);
    expect(useAuthStore.getState().hasMenuPermission('crm', 'contacts', 'edit')).toBe(false);
    expect(useAuthStore.getState().hasViewScopeAll('crm', 'customers')).toBe(true);
    expect(useAuthStore.getState().hasViewScopeAll('crm', 'contacts')).toBe(true);
    expect(useAuthStore.getState().getViewableModules().sort()).toEqual(['crm']);
    expect(useAuthStore.getState().getViewableMenus('crm').sort()).toEqual([
      'contacts',
      'customers',
    ]);
  });

  it('自动刷新到期前 5 分钟原子写入新 token 与服务端最新 user', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const refreshedUser = { ...user, username: 'admin-refreshed' };
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: {
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        expiresIn: 7200,
        user: refreshedUser,
      },
    });

    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setTokens('access-1', 'refresh-1', 600);
    const snapshots: Array<{ accessToken: string | null; username: string | undefined }> = [];
    const unsubscribe = useAuthStore.subscribe((state) => {
      snapshots.push({
        accessToken: state.accessToken,
        username: state.user?.username,
      });
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    unsubscribe();

    expect(axios.post).toHaveBeenCalledWith('/api/v1/auth/refresh', { refreshToken: 'refresh-1' });
    expect(useAuthStore.getState().accessToken).toBe('access-2');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
    expect(useAuthStore.getState().user?.username).toBe('admin-refreshed');
    expect(snapshots).not.toContainEqual({ accessToken: 'access-2', username: 'admin' });
  });

  it('旧代际 refresh 响应不能覆盖已轮换的新 tokens 与 user', () => {
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setTokens('access-2', 'refresh-2', 3600);

    const result = useAuthStore.getState().applyRefreshResponse('refresh-1', {
      accessToken: 'stale-access',
      refreshToken: 'stale-refresh',
      expiresIn: 7200,
      user: { ...user, username: 'stale-admin' },
    });

    expect(result).toBe('stale');
    expect(useAuthStore.getState().accessToken).toBe('access-2');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
    expect(useAuthStore.getState().user?.username).toBe('admin');
  });

  it('主动 refresh 收到缺少 user 的畸形 200 响应时 fail-closed', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 7200 },
    });
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setTokens('access-1', 'refresh-1', 600);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('logout 会清除认证信息、刷新定时器和查询缓存', () => {
    const clearSpy = vi.spyOn(queryClient, 'clear');
    useAuthStore.getState().setTokens('access', 'refresh', 3600);
    expect(useAuthStore.getState().refreshTimer).not.toBeNull();

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().refreshTimer).toBeNull();
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it('切换账号时清理查询缓存', () => {
    const clearSpy = vi.spyOn(queryClient, 'clear');
    useAuthStore.getState().setUser(user);

    useAuthStore.getState().setUser({ ...user, id: OTHER_USER_ID });

    expect(clearSpy).toHaveBeenCalledOnce();
  });
});
