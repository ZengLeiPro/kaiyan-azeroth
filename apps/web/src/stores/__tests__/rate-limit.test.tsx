import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../auth';
import { clearRateLimitError, setRateLimitError, useRateLimitError } from '../rate-limit';

const INITIAL_TIME = new Date('2026-01-01T00:00:00Z');

describe('rate-limit store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(INITIAL_TIME);
    act(() => clearRateLimitError());
  });

  afterEach(() => {
    act(() => clearRateLimitError());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('设置和手动清除限流状态', () => {
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('太快了', 0));
    expect(result.current.isLimited).toBe(true);
    expect(result.current.message).toBe('太快了');

    act(() => result.current.dismiss());
    expect(result.current.isLimited).toBe(false);
    expect(result.current.retryAfter).toBe(0);
  });

  it('retryAfter 倒计时结束后自动清除', () => {
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('稍后重试', 2));
    expect(result.current.retryAfter).toBe(2);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.retryAfter).toBe(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isLimited).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('60 秒窗口经过 5 秒后由 120 秒新窗口完整替换，旧 timer 不会提前清除', () => {
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('第一次限流', 60));
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.retryAfter).toBe(55);

    act(() => setRateLimitError('第二次限流', 120));
    expect(result.current.message).toBe('第二次限流');
    expect(result.current.retryAfter).toBe(120);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(55_000));
    expect(result.current.isLimited).toBe(true);
    expect(result.current.retryAfter).toBe(65);

    act(() => vi.advanceTimersByTime(65_000));
    expect(result.current.isLimited).toBe(false);
  });

  it('更短的新窗口同样替换旧窗口并按新 expiresAt 清除', () => {
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('长窗口', 120));
    act(() => vi.advanceTimersByTime(5000));
    act(() => setRateLimitError('短窗口', 2));

    expect(result.current.retryAfter).toBe(2);
    expect(vi.getTimerCount()).toBe(1);

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.isLimited).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clear 会取消模块 timer，之后旧倒计时不再更新状态', () => {
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('稍后重试', 60));
    expect(vi.getTimerCount()).toBe(1);

    act(() => clearRateLimitError());
    expect(result.current.isLimited).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.isLimited).toBe(false);
  });

  it('logout 会清除限流状态并取消模块 timer', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('当前会话限流', 60));
    expect(vi.getTimerCount()).toBe(1);

    act(() => useAuthStore.getState().logout());
    expect(result.current.isLimited).toBe(false);
    expect(clearIntervalSpy).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.isLimited).toBe(false);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'retryAfter=%s 时保留可手动关闭的限流提示但不启动 timer',
    (retryAfter) => {
      const { result, unmount } = renderHook(() => useRateLimitError());

      act(() => setRateLimitError('无有效窗口', retryAfter));
      expect(result.current.isLimited).toBe(true);
      expect(result.current.retryAfter).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      act(() => clearRateLimitError());
      unmount();
    }
  );

  it('每次 tick 按 expiresAt 与当前时钟重算，可处理时钟前后跳跃', () => {
    const { result } = renderHook(() => useRateLimitError());

    act(() => setRateLimitError('稍后重试', 60));

    vi.setSystemTime(new Date(INITIAL_TIME.getTime() + 45_000));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.retryAfter).toBe(14);

    vi.setSystemTime(new Date(INITIAL_TIME.getTime() + 10_000));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.retryAfter).toBe(49);

    vi.setSystemTime(new Date(INITIAL_TIME.getTime() + 60_000));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.isLimited).toBe(false);
  });
});
