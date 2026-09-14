import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearNetworkError,
  isNetworkError,
  setNetworkError,
  useNetworkError,
} from '../network-error';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

describe('network-error store', () => {
  beforeEach(() => {
    clearNetworkError();
  });

  it('识别常见网络错误并排除普通业务错误', () => {
    expect(isNetworkError(new Error('Network Error'))).toBe(true);
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('boom'), { name: 'NetworkError' }))).toBe(true);
    expect(isNetworkError(new Error('业务校验失败'))).toBe(false);
    expect(isNetworkError('Network Error')).toBe(false);
  });

  it('hook 订阅全局错误、重试后清除并调用回调', () => {
    const retry = vi.fn();
    const { result } = renderHook(() => useNetworkError());

    act(() => setNetworkError('断网了', retry));

    expect(result.current.hasError).toBe(true);
    expect(result.current.errorMessage).toBe('断网了');
    expect(result.current.canRetry).toBe(true);

    act(() => result.current.retry());

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current.hasError).toBe(false);
  });

  it('重复设置同一错误不会重复通知订阅者', () => {
    const { result } = renderHook(() => useNetworkError());

    act(() => setNetworkError('同一个错误'));
    const firstRetry = result.current.retry;
    act(() => setNetworkError('同一个错误'));

    expect(result.current.errorMessage).toBe('同一个错误');
    expect(result.current.retry).toBe(firstRetry);
  });
});
