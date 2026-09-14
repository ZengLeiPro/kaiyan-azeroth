import { act, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';

import { useTokenManager } from '../use-token-manager';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useLocation: () => ({ pathname: '/customers', search: '?page=2', hash: '#detail' }),
    useNavigate: () => navigate,
  };
});

const originalState = useAuthStore.getState();

describe('useTokenManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockReset();
    vi.spyOn(useAuthStore.persist, 'rehydrate').mockResolvedValue(undefined);
  });

  it('即将过期时串行刷新并提交当前 token 代际', async () => {
    const applyRefreshResponse = vi.fn(() => 'applied' as const);
    const logout = vi.fn();
    useAuthStore.setState({
      ...originalState,
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      tokenExpiresAt: Date.now() + 60_000,
      isAuthenticated: true,
      applyRefreshResponse,
      logout,
    });
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'access-new' } });

    const { unmount } = renderHook(() => useTokenManager());

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith('/api/v1/auth/refresh', {
        refreshToken: 'refresh-old',
      });
      expect(applyRefreshResponse).toHaveBeenCalledWith('refresh-old', {
        accessToken: 'access-new',
      });
    });
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    unmount();
  });

  it('旧代际刷新失败时保留其他标签页已经提交的新会话', async () => {
    const logout = vi.fn();
    useAuthStore.setState({
      ...originalState,
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      tokenExpiresAt: Date.now() + 60_000,
      isAuthenticated: true,
      applyRefreshResponse: vi.fn(() => 'applied' as const),
      logout,
    });
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      useAuthStore.setState({
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        tokenExpiresAt: Date.now() + 10 * 60_000,
      });
      throw new Error('old generation failed');
    });

    const { unmount } = renderHook(() => useTokenManager());

    await waitFor(() => expect(axios.post).toHaveBeenCalledOnce());
    await act(async () => Promise.resolve());
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    unmount();
  });
});
