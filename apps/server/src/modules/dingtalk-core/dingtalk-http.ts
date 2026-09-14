import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

/** 钉钉客户端通用 sleep（内联，避免依赖 dingtalk-sync 历史目录） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DingtalkHttpConfig {
  baseUrl: string;
  timeout: number; // seconds
  maxRetries: number;
  qps?: number; // default 30
}

export class DingtalkRateLimitError extends Error {
  readonly code = 90002;

  constructor(
    message: string,
    readonly requestId?: string,
    readonly responseData?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DingtalkRateLimitError';
  }
}

/**
 * 简单的令牌桶限流器
 */
class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly intervalMs: number;
  private lastRefill: number;

  constructor(tokensPerInterval: number, intervalMs: number) {
    this.maxTokens = tokensPerInterval;
    this.tokens = tokensPerInterval;
    this.intervalMs = intervalMs;
    this.lastRefill = Date.now();
  }

  async wait(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    const waitMs = this.intervalMs - (Date.now() - this.lastRefill);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= this.intervalMs) {
      this.tokens = this.maxTokens;
      this.lastRefill = now;
    }
  }
}

/**
 * 钉钉专用 HTTP 客户端，内置限流和 90002 错误重试
 *
 * 迁移自 apps/dingtalk-sync/src/dingtalk/http.ts，保持纯 class。
 * 由 DingtalkSyncService 在内部 new。
 */
export class DingtalkHttp {
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;

  constructor(config: DingtalkHttpConfig) {
    this.maxRetries = config.maxRetries;
    const qps = config.qps ?? 30;
    this.rateLimiter = new RateLimiter(qps, 1000);

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout * 1000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async request<T = unknown>(config: AxiosRequestConfig): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.rateLimiter.wait();

        const response: AxiosResponse<T> = await this.client.request<T>(config);
        const data = response.data;
        const dataObj = data as Record<string, unknown>;

        // 钉钉业务层限流错误 (90002)
        if (dataObj?.errcode === 90002 || dataObj?.code === 90002) {
          const errmsg = String(dataObj?.errmsg ?? dataObj?.message ?? '');
          const retryAfterMs = this.parseRetryAfter(errmsg);
          if (attempt < this.maxRetries) {
            const delay = Math.max(retryAfterMs, 1000 * Math.pow(2, attempt));
            console.warn(
              `钉钉API限流(90002)，${delay}ms后重试 (${attempt + 1}/${this.maxRetries}) url=${String(
                config.url ?? ''
              )}`
            );
            await sleep(delay);
            continue;
          }

          const requestIdValue = dataObj?.request_id ?? dataObj?.requestId;
          throw new DingtalkRateLimitError(
            `钉钉API限流(90002)且重试已耗尽：${errmsg || '接口调用超过频率限制'}`,
            requestIdValue == null ? undefined : String(requestIdValue),
            dataObj
          );
        }

        return response.data;
      } catch (err: unknown) {
        lastError = err;

        const axiosErr = err as { response?: { status?: number }; code?: string; message?: string };
        const status = axiosErr?.response?.status;
        const code = axiosErr?.code;
        const isRetryable =
          code === 'ECONNABORTED' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNRESET' ||
          (typeof status === 'number' && [429, 500, 502, 503, 504].includes(status));

        if (!isRetryable || attempt >= this.maxRetries) break;

        const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
        console.warn(
          `HTTP请求失败，${delay}ms后重试 (${attempt + 1}/${this.maxRetries}) url=${String(
            config.url ?? ''
          )} error=${axiosErr?.message ?? ''}`
        );
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /** 从限流错误信息中解析等待时间 */
  private parseRetryAfter(errmsg: string): number {
    const match = errmsg.match(/限制将在\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*结束/);
    if (match?.[1]) {
      const endTime = new Date(match[1].replace(' ', 'T') + '+08:00');
      const waitMs = endTime.getTime() - Date.now();
      if (waitMs > 0 && waitMs < 60000) {
        return waitMs + 100;
      }
    }
    return 1000;
  }

  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url });
  }

  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data });
  }

  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data });
  }
}
