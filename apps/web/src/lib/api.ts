import type { BatchImportResult } from '@ky-azeroth/shared/types';
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { serializeTokenRotation } from '@/lib/auth-token-rotation';
import { getErrorTraceId } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth';
import { clearNetworkError, isNetworkError, setNetworkError } from '@/stores/network-error';
import { setRateLimitError } from '@/stores/rate-limit';

// ===== 请求队列配置 =====
const REQUEST_QUEUE_CONFIG = {
  maxConcurrent: 6, // 最大并发请求数
  minDelay: 50, // 请求之间的最小间隔（毫秒）
};

// 请求队列
interface QueueItem {
  execute: () => Promise<AxiosResponse>;
  resolve: (value: AxiosResponse) => void;
  reject: (error: unknown) => void;
}

const requestQueue: QueueItem[] = [];
let activeRequests = 0;
let lastRequestTime = 0;

// 处理队列中的下一个请求
async function processQueue() {
  if (requestQueue.length === 0 || activeRequests >= REQUEST_QUEUE_CONFIG.maxConcurrent) {
    return;
  }

  // 确保请求间隔
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < REQUEST_QUEUE_CONFIG.minDelay) {
    setTimeout(processQueue, REQUEST_QUEUE_CONFIG.minDelay - timeSinceLastRequest);
    return;
  }

  const item = requestQueue.shift();
  if (!item) return;

  activeRequests++;
  lastRequestTime = Date.now();

  try {
    const result = await item.execute();
    item.resolve(result);
  } catch (error) {
    item.reject(error);
  } finally {
    activeRequests--;
    // 继续处理队列
    processQueue();
  }
}

// 获取 API 基础 URL
// 生产环境使用 VITE_API_BASE_URL（指向 FC 后端）
// 开发环境使用相对路径（由 Vite proxy 转发）
export const getBaseURL = () => {
  const envBaseURL = import.meta.env.VITE_API_BASE_URL;
  if (envBaseURL) {
    // 确保 URL 以 /api/v1 结尾
    return envBaseURL.endsWith('/api/v1') ? envBaseURL : `${envBaseURL.replace(/\/$/, '')}/api/v1`;
  }
  return '/api/v1';
};

// 创建 axios 实例
export const api = axios.create({
  baseURL: getBaseURL(),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 存储最后一个失败的请求，用于重试
let lastFailedRequest: InternalAxiosRequestConfig | null = null;

// 刷新 Token 相关的状态
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

class InvalidRefreshResponseError extends Error {}

function redirectToLoginWithCurrentPath() {
  if (window.location.pathname.includes('/login')) return;
  const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = `/login?redirect=${encodeURIComponent(target)}`;
}

const processRetryQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
};

// 请求拦截器
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

const AUTOMATIC_RETRY_METHODS = new Set(['get', 'head', 'options']);

export function isAutomaticRetryMethod(method?: string): boolean {
  return method ? AUTOMATIC_RETRY_METHODS.has(method.toLowerCase()) : false;
}

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // 429 错误 - 速率限制
    if (error.response?.status === 429) {
      const data = error.response.data as { message?: string; retryAfter?: number } | undefined;
      const retryAfter =
        data?.retryAfter || parseInt(error.response.headers['retry-after'] || '60', 10);
      const message = data?.message || '请求过于频繁，请稍后再试';

      setRateLimitError(message, retryAfter);
      return Promise.reject(error);
    }

    // 401 错误，尝试刷新令牌
    if (error.response?.status === 401 && !originalRequest._retry) {
      // 如果正在刷新，将请求加入队列
      if (isRefreshing) {
        return new Promise<AxiosResponse>((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              // 重新通过 api 实例发送请求，确保经过请求队列
              resolve(api(originalRequest));
            },
            reject: (err: unknown) => {
              reject(err);
            },
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = useAuthStore.getState().refreshToken;

      if (refreshToken) {
        // 刷新 Token 重试逻辑
        let refreshAttempts = 0;
        const maxRefreshAttempts = 2;

        const retryWithCurrentGeneration = (): Promise<AxiosResponse> | null => {
          const current = useAuthStore.getState();
          if (current.refreshToken === refreshToken || !current.accessToken) return null;

          // 主动 refresh 等其他路径已提交更新代际：旧响应/错误不得覆盖或登出新会话。
          processRetryQueue(null, current.accessToken);
          originalRequest.headers.Authorization = `Bearer ${current.accessToken}`;
          return api(originalRequest);
        };

        const attemptRefresh = async (): Promise<AxiosResponse> => {
          try {
            const newerGenerationRetry = retryWithCurrentGeneration();
            if (newerGenerationRetry) return newerGenerationRetry;

            // 使用基础 axios 而不是 api 实例，避免递归 401；同一次重试始终使用捕获的代际。
            await serializeTokenRotation(
              async () => {
                const current = useAuthStore.getState();
                if (current.refreshToken !== refreshToken && current.accessToken) return;

                const response = await axios.post(`${getBaseURL()}/auth/refresh`, {
                  refreshToken,
                });
                const applyResult = useAuthStore
                  .getState()
                  .applyRefreshResponse(refreshToken, response.data);
                if (applyResult === 'invalid') {
                  throw new InvalidRefreshResponseError('刷新响应缺少完整用户声明');
                }
              },
              () => useAuthStore.persist.rehydrate()
            );

            const currentAccessToken = useAuthStore.getState().accessToken;
            if (!currentAccessToken) {
              throw new InvalidRefreshResponseError('刷新后缺少访问令牌');
            }

            // applied 与 stale 都读取 store 中的权威代际，禁止使用过期响应里的 token。
            processRetryQueue(null, currentAccessToken);
            originalRequest.headers.Authorization = `Bearer ${currentAccessToken}`;
            return api(originalRequest);
          } catch (err) {
            const newerGenerationRetry = retryWithCurrentGeneration();
            if (newerGenerationRetry) return newerGenerationRetry;

            refreshAttempts++;

            // 网络错误时重试（非 HTTP 响应错误）
            if (
              refreshAttempts < maxRefreshAttempts &&
              !(err instanceof InvalidRefreshResponseError) &&
              (!axios.isAxiosError(err) || !err.response)
            ) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              return attemptRefresh();
            }

            // 同一代际重试失败或响应畸形，fail-closed。
            processRetryQueue(err, null);
            useAuthStore.getState().logout();
            redirectToLoginWithCurrentPath();
            return Promise.reject(err);
          } finally {
            isRefreshing = false;
          }
        };

        return await attemptRefresh();
      } else {
        // 没有刷新令牌，直接登出
        isRefreshing = false;
        useAuthStore.getState().logout();
        redirectToLoginWithCurrentPath();
        return Promise.reject(error);
      }
    }

    // 检查是否为网络错误（如服务器重启期间）
    if (isNetworkError(error) || !error.response) {
      const canRetryAutomatically = isAutomaticRetryMethod(originalRequest.method);

      // 获取当前重试次数
      const retryCount =
        (originalRequest as typeof originalRequest & { _retryCount?: number })._retryCount || 0;
      const maxRetries = 3;
      const retryDelay = 1000; // 1秒后重试

      // 自动重试仅限安全读取；写请求需要服务端幂等键才能重试。
      if (canRetryAutomatically && retryCount < maxRetries) {
        (originalRequest as typeof originalRequest & { _retryCount: number })._retryCount =
          retryCount + 1;

        // 延迟后重试
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return api(originalRequest);
      }

      // 仅保存安全读取请求；写请求不提供“重试上一次请求”，避免不确定提交后的重复写入。
      lastFailedRequest = canRetryAutomatically ? originalRequest : null;

      setNetworkError(
        '网络连接失败，请检查您的网络后重试。',
        canRetryAutomatically
          ? () => {
              if (lastFailedRequest) {
                clearNetworkError();
                api(lastFailedRequest).catch(() => {
                  // 重试失败，重新显示错误
                });
              }
            }
          : undefined
      );
    }

    return Promise.reject(error);
  }
);

// API 错误处理。服务端 traceId 会进入 toast 文案，并由 logger 从同一 AxiosError 自动提取。
export function getErrorMessage(error: unknown, fallback = '请求失败'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    const message = data?.message || error.message || fallback;
    const traceId = getErrorTraceId(error);
    return traceId ? `${message}（追踪号：${traceId}）` : message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

// ===== 批量操作辅助函数 =====

/**
 * 批量导入数据
 * 优先使用批量 API，如果不支持则使用队列逐条导入
 */
export async function batchImport<T>(
  endpoint: string,
  items: T[],
  options: {
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<BatchImportResult> {
  const { batchSize = 50, onProgress } = options;
  const result: BatchImportResult = { success: 0, failed: 0, errors: [] };

  // 尝试使用批量 API
  try {
    const response = await api.post(`${endpoint}/batch`, { items });
    if (response.data.success !== undefined) {
      result.success = response.data.success;
      result.failed = response.data.failed || 0;
      result.errors = response.data.errors || [];
      onProgress?.(items.length, items.length);
      return result;
    }
  } catch (error) {
    // 批量 API 不存在，回退到逐条导入
    if (!axios.isAxiosError(error) || error.response?.status !== 404) {
      throw error;
    }
  }

  // 回退：使用队列逐条导入（带并发限制）
  const total = items.length;
  let completed = 0;

  // 分批处理
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const promises = batch.map((item, batchIndex) => {
      const index = i + batchIndex;
      return new Promise<void>((resolve) => {
        const queueItem: QueueItem = {
          execute: () => api.post(endpoint, item),
          resolve: () => {
            result.success++;
            completed++;
            onProgress?.(completed, total);
            resolve();
          },
          reject: (error) => {
            result.failed++;
            result.errors.push({
              index,
              error: getErrorMessage(error),
            });
            completed++;
            onProgress?.(completed, total);
            resolve(); // 不中断其他导入
          },
        };
        requestQueue.push(queueItem);
        processQueue();
      });
    });

    await Promise.all(promises);
  }

  return result;
}

export function buildEntityVersionMap(
  entities: Array<{ id: string; version?: number | null }>
): Record<string, number> {
  return Object.fromEntries(
    entities.flatMap((entity) =>
      Number.isInteger(entity.version) && Number(entity.version) >= 1
        ? [[entity.id, Number(entity.version)] as const]
        : []
    )
  );
}

/**
 * 批量删除数据
 * 优先使用批量 API，如果不支持则使用队列逐条删除。
 * versions 会同时用于批量 body 与逐条 fallback query；旧批量 API 可忽略该额外字段。
 */
export async function batchDelete(
  endpoint: string,
  ids: string[],
  options: {
    onProgress?: (completed: number, total: number) => void;
    versions?: Record<string, number>;
  } = {}
): Promise<{ success: number; failed: number; errors: Array<{ id: string; error: string }> }> {
  const { onProgress, versions } = options;
  const result = { success: 0, failed: 0, errors: [] as Array<{ id: string; error: string }> };

  if (ids.length === 0) return result;

  // 尝试使用批量删除 API
  try {
    const response = await api.delete(`${endpoint}/batch`, {
      data: { ids, ...(versions ? { versions } : {}) },
    });
    if (response.data.success !== undefined) {
      const skipped = Array.isArray(response.data.skipped) ? response.data.skipped : [];
      const skippedIds: string[] = skipped
        .map((item: unknown) =>
          typeof item === 'string'
            ? item
            : item && typeof item === 'object' && 'id' in item
              ? String((item as { id: unknown }).id)
              : null
        )
        .filter((id: string | null): id is string => Boolean(id));
      result.success = response.data.success;
      result.failed = response.data.failed ?? skippedIds.length;
      result.errors = Array.isArray(response.data.errors)
        ? response.data.errors
        : skippedIds.map((id: string) => ({ id, error: '该记录当前不可删除' }));
      onProgress?.(ids.length, ids.length);
      return result;
    }
  } catch (error) {
    // 批量 API 不存在，回退到逐条删除
    if (!axios.isAxiosError(error) || error.response?.status !== 404) {
      throw error;
    }
  }

  // 回退：使用队列逐条删除（带并发限制）
  const total = ids.length;
  let completed = 0;

  const promises = ids.map((id) => {
    return new Promise<void>((resolve) => {
      const version = versions?.[id];
      const versionQuery = version === undefined ? '' : `?version=${version}`;
      const queueItem: QueueItem = {
        execute: () => api.delete(`${endpoint}/${id}${versionQuery}`),
        resolve: () => {
          result.success++;
          completed++;
          onProgress?.(completed, total);
          resolve();
        },
        reject: (error) => {
          result.failed++;
          result.errors.push({
            id,
            error: getErrorMessage(error),
          });
          completed++;
          onProgress?.(completed, total);
          resolve(); // 不中断其他删除
        },
      };
      requestQueue.push(queueItem);
      processQueue();
    });
  });

  await Promise.all(promises);
  return result;
}
