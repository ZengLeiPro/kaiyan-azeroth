import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

// 网络错误状态存储
interface NetworkErrorState {
  hasError: boolean;
  errorMessage: string;
  retryCallback: (() => void) | null;
}

// 全局网络错误状态
let networkErrorState: NetworkErrorState = {
  hasError: false,
  errorMessage: '',
  retryCallback: null,
};

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

// 设置网络错误
export function setNetworkError(message: string, retryCallback?: () => void) {
  // 避免重复设置相同错误
  if (networkErrorState.hasError && networkErrorState.errorMessage === message) {
    return;
  }

  networkErrorState = {
    hasError: true,
    errorMessage: message,
    retryCallback: retryCallback || null,
  };
  notifySubscribers();
}

// 清除网络错误
export function clearNetworkError() {
  networkErrorState = {
    hasError: false,
    errorMessage: '',
    retryCallback: null,
  };
  notifySubscribers();
}

// 检查是否为网络错误
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    // 检查常见的网络错误类型
    const networkErrorMessages = [
      'Network Error',
      'net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_NETWORK_CHANGED',
      'net::ERR_NAME_NOT_RESOLVED',
      'net::ERR_CONNECTION_REFUSED',
      'net::ERR_CONNECTION_RESET',
      'net::ERR_CONNECTION_TIMED_OUT',
      'Failed to fetch',
      'Load failed',
      'timeout',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
    ];

    return networkErrorMessages.some(
      (msg) => error.message.includes(msg) || (error.name && error.name.includes('Network'))
    );
  }
  return false;
}

// Hook: 使用网络错误状态
export function useNetworkError() {
  const [state, setState] = useState(networkErrorState);

  useEffect(() => {
    // 订阅状态变化
    const unsubscribe = subscribe(() => {
      setState({ ...networkErrorState });
    });
    return unsubscribe;
  }, []);

  // 当出现错误时触发 Toast
  useEffect(() => {
    if (state.hasError) {
      toast.error('网络连接失败', {
        description: state.errorMessage || '请检查您的网络连接后重试',
        action: state.retryCallback
          ? {
              label: '重试',
              onClick: () => {
                // 清除错误并重试
                clearNetworkError();
                state.retryCallback?.();
              },
            }
          : undefined,
        duration: 5000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只依赖 state 的特定属性
  }, [state.hasError, state.errorMessage, state.retryCallback]);

  const retry = useCallback(() => {
    if (state.retryCallback) {
      clearNetworkError();
      state.retryCallback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意只依赖 retryCallback 属性
  }, [state.retryCallback]);

  const dismiss = useCallback(() => {
    clearNetworkError();
  }, []);

  return {
    hasError: state.hasError,
    errorMessage: state.errorMessage,
    canRetry: !!state.retryCallback,
    retry,
    dismiss,
  };
}
