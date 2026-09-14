import { act, renderHook } from '@testing-library/react';
import axios from 'axios';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';

import { useSensitiveActionReauthentication } from './use-sensitive-action-reauthentication';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const originalState = useAuthStore.getState();

describe('useSensitiveActionReauthentication', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockReset();
    vi.spyOn(useAuthStore.persist, 'rehydrate').mockResolvedValue(undefined);
  });

  it('重新认证成功后才执行暂存的敏感操作', async () => {
    const applyRefreshResponse = vi.fn(() => 'applied' as const);
    useAuthStore.setState({
      ...originalState,
      accessToken: 'access-current',
      refreshToken: 'refresh-current',
      applyRefreshResponse,
    });
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'access-next' } });
    const action = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSensitiveActionReauthentication());

    act(() => {
      expect(result.current.request(action)).toBe(false);
      result.current.setPassword('secret-123');
    });
    expect(result.current.dialogOpen).toBe(true);

    await act(async () => result.current.confirm());

    expect(axios.post).toHaveBeenCalledWith(
      '/api/v1/auth/reauthenticate',
      { password: 'secret-123' },
      { headers: { Authorization: 'Bearer access-current' } }
    );
    expect(applyRefreshResponse).toHaveBeenCalledWith('refresh-current', {
      accessToken: 'access-next',
    });
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.password).toBe('');
    expect(result.current.loading).toBe(false);
  });

  it('会话缺少 refresh token 时拒绝认证与执行动作', async () => {
    useAuthStore.setState({
      ...originalState,
      accessToken: 'access-current',
      refreshToken: null,
    });
    const action = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSensitiveActionReauthentication());

    act(() => result.current.request(action));
    await act(async () => result.current.confirm());

    expect(toast.error).toHaveBeenCalledWith('当前会话无效，请重新登录');
    expect(action).not.toHaveBeenCalled();
  });

  it('响应代际失效时保留弹窗并允许取消清理动作', async () => {
    useAuthStore.setState({
      ...originalState,
      accessToken: 'access-current',
      refreshToken: 'refresh-current',
      applyRefreshResponse: vi.fn(() => 'stale' as const),
    });
    vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    const action = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useSensitiveActionReauthentication());

    act(() => {
      result.current.request(action);
      result.current.setPassword('secret-123');
    });
    await act(async () => result.current.confirm());

    expect(toast.error).toHaveBeenCalledWith('重新认证响应已失效，请重试');
    expect(action).not.toHaveBeenCalled();
    expect(result.current.dialogOpen).toBe(true);

    act(() => result.current.onDialogOpenChange(false));
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.password).toBe('');
  });
});
