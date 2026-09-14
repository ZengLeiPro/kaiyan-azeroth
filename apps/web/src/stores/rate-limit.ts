import { useCallback, useEffect, useState } from 'react';

// 速率限制状态存储
interface RateLimitState {
  isLimited: boolean;
  message: string;
  retryAfter: number;
  retryCallback: (() => void) | null;
}

// 全局速率限制状态
let rateLimitState: RateLimitState = {
  isLimited: false,
  message: '',
  retryAfter: 0,
  retryCallback: null,
};

// 所有限流响应共享同一个倒计时；新响应始终以自己的窗口替换旧窗口。
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let expiresAt: number | null = null;

// 订阅者列表
const subscribers: Set<() => void> = new Set();

// 订阅状态变化
function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

// 通知所有订阅者
function notifySubscribers() {
  subscribers.forEach((callback) => callback());
}

function cancelCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  expiresAt = null;
}

function normalizeRetryAfter(retryAfter: number) {
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) return 0;

  const normalized = Math.ceil(retryAfter);
  return Number.isFinite(Date.now() + normalized * 1000) ? normalized : 0;
}

function updateCountdown() {
  if (expiresAt === null) return;

  const retryAfter = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  if (retryAfter === 0) {
    clearRateLimitError();
    return;
  }

  if (retryAfter !== rateLimitState.retryAfter) {
    rateLimitState = { ...rateLimitState, retryAfter };
    notifySubscribers();
  }
}

// 设置速率限制
export function setRateLimitError(message: string, retryAfter: number, retryCallback?: () => void) {
  cancelCountdown();

  const normalizedRetryAfter = normalizeRetryAfter(retryAfter);
  expiresAt = normalizedRetryAfter > 0 ? Date.now() + normalizedRetryAfter * 1000 : null;
  rateLimitState = {
    isLimited: true,
    message,
    retryAfter: normalizedRetryAfter,
    retryCallback: retryCallback || null,
  };
  notifySubscribers();

  if (expiresAt !== null) {
    const timer = setInterval(updateCountdown, 1000);
    countdownTimer = timer;

    // Node/Vitest 的 timer 支持 unref，浏览器中的数字 timer 则无需处理。
    (timer as unknown as { unref?: () => void }).unref?.();
  }
}

// 清除速率限制
export function clearRateLimitError() {
  cancelCountdown();
  rateLimitState = {
    isLimited: false,
    message: '',
    retryAfter: 0,
    retryCallback: null,
  };
  notifySubscribers();
}

// Hook: 使用速率限制状态
export function useRateLimitError() {
  const [state, setState] = useState(rateLimitState);

  useEffect(() => {
    // 订阅状态变化
    const unsubscribe = subscribe(() => {
      setState({ ...rateLimitState });
    });
    return unsubscribe;
  }, []);

  const dismiss = useCallback(() => {
    clearRateLimitError();
  }, []);

  return {
    isLimited: state.isLimited,
    message: state.message,
    retryAfter: state.retryAfter,
    dismiss,
  };
}
