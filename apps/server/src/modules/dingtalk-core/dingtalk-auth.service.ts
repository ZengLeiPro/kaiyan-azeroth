import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DingtalkHttp } from './dingtalk-http';

type TokenResponse = {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
};

const DEFAULT_OAPI_BASE_URL = 'https://oapi.dingtalk.com';

/**
 * 钉钉认证管理器（dingtalk-core 子层）
 *
 * 负责获取和缓存 access_token。
 * 作为 NestJS 单例（默认 scope），整个 server 进程共享一个 token 缓存，
 * 减少对钉钉 /gettoken 的调用次数。
 *
 * 并发安全：使用 `refreshingPromise` in-flight 去重，避免冷启动并发触发
 * 多次 /gettoken 请求被钉钉限流。
 *
 * 失效处理：暴露 `invalidate()` 让调用方在 errcode=88 的子错误明确指向
 * token 失效时清缓存，并在下一次调用时自动重新获取。
 */
@Injectable()
export class DingtalkAuth {
  private readonly logger = new Logger(DingtalkAuth.name);
  private readonly http: DingtalkHttp;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private accessToken: string | null = null;
  private expiresAtMs: number | null = null;
  /** in-flight refresh promise，所有并发请求复用同一次 /gettoken */
  private refreshingPromise: Promise<string> | null = null;

  constructor(private readonly config: ConfigService) {
    this.clientId = this.config.get<string>('DINGTALK_CLIENT_ID') ?? '';
    this.clientSecret = this.config.get<string>('DINGTALK_CLIENT_SECRET') ?? '';
    const oapiBaseUrl = this.config.get<string>('DINGTALK_OAPI_BASE_URL') ?? DEFAULT_OAPI_BASE_URL;

    this.http = new DingtalkHttp({
      baseUrl: oapiBaseUrl,
      timeout: 30,
      maxRetries: 3,
      qps: 30,
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.isTokenValid()) return this.accessToken!;
    // 并发去重：第一个调用者发起刷新，后续调用者共用同一个 promise
    if (this.refreshingPromise) return this.refreshingPromise;
    this.refreshingPromise = this.refreshAccessToken().finally(() => {
      this.refreshingPromise = null;
    });
    return this.refreshingPromise;
  }

  /**
   * 主动使本地 token 缓存失效。
   *
   * 调用方确认钉钉返回的是 access_token 失效后，应调用本方法清掉本地缓存，
   * 下一次 getAccessToken() 会重新拉取。
   */
  invalidate(): void {
    if (this.accessToken) {
      this.logger.warn('钉钉 access_token 被主动 invalidate（已确认 token 失效）');
    }
    this.accessToken = null;
    this.expiresAtMs = null;
  }

  private isTokenValid(): boolean {
    if (!this.accessToken || !this.expiresAtMs) return false;
    const refreshEarlyMs = 300 * 1000; // 提前 5 分钟刷新
    return Date.now() < this.expiresAtMs - refreshEarlyMs;
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('缺少钉钉凭据：请检查环境变量 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET');
    }

    const data = await this.http.get<TokenResponse>('/gettoken', {
      params: {
        appkey: this.clientId,
        appsecret: this.clientSecret,
      },
    });

    if (!data || typeof data !== 'object') {
      throw new Error('获取钉钉 access_token 失败：响应格式异常');
    }

    if ((data.errcode ?? 0) !== 0) {
      throw new Error(`获取钉钉 access_token 失败: ${data.errmsg ?? data.errcode}`);
    }

    const token = data.access_token;
    if (!token) throw new Error('获取钉钉 access_token 失败：缺少 access_token');

    const expiresIn = data.expires_in ?? 7200;
    this.accessToken = token;
    this.expiresAtMs = Date.now() + expiresIn * 1000;

    this.logger.log('钉钉访问令牌刷新成功');
    return token;
  }
}
