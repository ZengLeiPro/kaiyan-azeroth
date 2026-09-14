import { createSign } from 'crypto';
import { type Dispatcher, fetch as undiciFetch, ProxyAgent } from 'undici';

import { sleep } from '../utils/date';

/**
 * Google Search Console API 客户端。
 *
 * 文档：
 *   - Search Analytics API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *   - Service Account OAuth: https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * 我们用 Node 22 原生 crypto 手写 JWT (RS256) + fetch 换 access_token；不引 `googleapis` 大包
 * （250MB+ vs 本文件 <10KB），保持 seo-sync FC 冷启动/部署包体积可控。
 */

export interface GoogleServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string; // 默认 'https://oauth2.googleapis.com/token'
}

/**
 * Search Analytics API row。keys 顺序与请求时 dimensions 顺序一致。
 */
export interface GoogleSearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export type GoogleSearchAnalyticsDimension = 'query' | 'page' | 'date';

interface GoogleSearchAnalyticsResponse {
  rows?: GoogleSearchAnalyticsRow[];
  error?: {
    code: number;
    message: string;
    status?: string;
  };
}

interface OAuth2TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GoogleClientOptions {
  /** Service Account JSON 对象（parse 后） */
  serviceAccount: GoogleServiceAccount;
  /**
   * GSC property URL。两种格式：
   *   - Domain property: `sc-domain:example.com`（推荐；本项目已用）
   *   - URL prefix property: `https://www.example.com/`
   * 会在请求时 URL-encode 传给 API path。
   */
  siteUrl: string;
  /** 单次请求间节流毫秒 */
  throttleMs: number;
  /** 单次请求超时（ms），默认 30_000 */
  requestTimeoutMs?: number;
  /** HTTPS 代理地址；为空则直连 */
  httpsProxy?: string;
}

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';

export class GoogleClient {
  private readonly opts: GoogleClientOptions;
  private readonly dispatcher?: Dispatcher;
  private cachedAccessToken: string | null = null;
  /** 缓存 token 过期时间戳（ms）；提前 60s 视为过期 */
  private tokenExpiresAtMs = 0;

  constructor(opts: GoogleClientOptions) {
    this.opts = opts;
    const httpsProxy = opts.httpsProxy?.trim();
    if (httpsProxy) {
      this.dispatcher = new ProxyAgent(httpsProxy);
    }
  }

  /**
   * 换取 access_token；带 60s 提前刷新 buffer。
   *
   * Service Account JWT 流程：
   *   1) 用 SA 私钥签一个 RS256 JWT（有效期 1h，含 iss/scope/aud/iat/exp）
   *   2) POST oauth2/token 用该 JWT 换 access_token
   *   3) 拿到的 access_token 有效期 1h，缓存复用
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && now < this.tokenExpiresAtMs - 60_000) {
      return this.cachedAccessToken;
    }

    const jwt = this.signJwt();
    const tokenUri = this.opts.serviceAccount.token_uri ?? DEFAULT_TOKEN_URI;

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    });

    const res = await this.request(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(this.opts.requestTimeoutMs ?? 30_000),
    });

    const json = (await res.json()) as OAuth2TokenResponse;
    if (!res.ok || !json.access_token) {
      const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`;
      throw new Error(`[google-client] 换取 access_token 失败: ${detail}`);
    }

    this.cachedAccessToken = json.access_token;
    this.tokenExpiresAtMs = now + (json.expires_in ?? 3600) * 1000;
    return json.access_token;
  }

  /**
   * 拉取 Search Analytics 数据。
   *
   * @param startDate YYYY-MM-DD（UTC，GSC 端按 property 时区聚合；一般拉过去 N 天数据）
   * @param endDate   YYYY-MM-DD
   *
   * rowLimit 上限 25000，超过需分页（我们只拉近 3-7 天数据，暂不实现分页）。
   */
  async querySearchAnalytics(
    startDate: string,
    endDate: string,
    dimensions: GoogleSearchAnalyticsDimension[] = ['query', 'date']
  ): Promise<GoogleSearchAnalyticsRow[]> {
    await sleep(this.opts.throttleMs);
    const token = await this.getAccessToken();
    const path = `${API_BASE}/sites/${encodeURIComponent(this.opts.siteUrl)}/searchAnalytics/query`;

    const res = await this.request(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions,
        rowLimit: 25000,
      }),
      signal: AbortSignal.timeout(this.opts.requestTimeoutMs ?? 30_000),
    });

    const json = (await res.json()) as GoogleSearchAnalyticsResponse;
    if (!res.ok || json.error) {
      const detail = json.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`[google-client] Search Analytics 请求失败: ${detail}`);
    }

    return json.rows ?? [];
  }

  private async request(url: string, init: Parameters<typeof undiciFetch>[1]) {
    return undiciFetch(url, this.dispatcher ? { ...init, dispatcher: this.dispatcher } : init);
  }

  /**
   * 签 RS256 JWT。用 Node 内置 crypto，不引 jsonwebtoken 库。
   *
   * 结构：base64url(header) + '.' + base64url(claim) + '.' + base64url(signature)
   */
  private signJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      typ: 'JWT',
      ...(this.opts.serviceAccount.private_key_id
        ? { kid: this.opts.serviceAccount.private_key_id }
        : {}),
    };
    const claim = {
      iss: this.opts.serviceAccount.client_email,
      scope: OAUTH_SCOPE,
      aud: this.opts.serviceAccount.token_uri ?? DEFAULT_TOKEN_URI,
      iat: now,
      exp: now + 3600,
    };

    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedClaim = base64UrlEncode(JSON.stringify(claim));
    const signingInput = `${encodedHeader}.${encodedClaim}`;

    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(this.opts.serviceAccount.private_key);
    const encodedSignature = base64UrlEncodeBuffer(signature);

    return `${signingInput}.${encodedSignature}`;
  }
}

function base64UrlEncode(input: string): string {
  return base64UrlEncodeBuffer(Buffer.from(input, 'utf8'));
}

function base64UrlEncodeBuffer(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 解析 SA JSON。既支持传入 JSON 字符串，也支持已 parse 的对象。
 * 兼容 GCP 下载的原始 key.json 格式（含 private_key 里的 `\n` 换行符）。
 */
export function parseServiceAccount(input: string | object): GoogleServiceAccount {
  const raw = typeof input === 'string' ? JSON.parse(input) : (input as Record<string, unknown>);
  const clientEmail = raw.client_email;
  const privateKey = raw.private_key;
  if (typeof clientEmail !== 'string' || !clientEmail) {
    throw new Error('[google-client] Service Account 缺少 client_email');
  }
  if (typeof privateKey !== 'string' || !privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('[google-client] Service Account 缺少或格式错误的 private_key');
  }
  return {
    client_email: clientEmail,
    private_key: privateKey,
    private_key_id: typeof raw.private_key_id === 'string' ? raw.private_key_id : undefined,
    token_uri: typeof raw.token_uri === 'string' ? raw.token_uri : undefined,
  };
}
