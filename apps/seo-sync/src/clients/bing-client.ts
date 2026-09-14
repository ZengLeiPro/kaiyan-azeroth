import { sleep } from '../utils/date';

/**
 * Bing Webmaster API 客户端。
 *
 * 文档：https://learn.microsoft.com/en-us/bingwebmaster/
 * 端点格式：https://ssl.bing.com/webmaster/api.svc/json/{Method}?apikey={KEY}&siteUrl={URL}
 *
 * 我们用 Node 22 原生 fetch，不引 axios。
 */

export interface BingQueryStat {
  /** 搜索词 */
  Query: string;
  /** 点击数 */
  Clicks: number;
  /** 曝光数 */
  Impressions: number;
  /** 平均点击位置 */
  AvgClickPosition: number;
  /** 平均曝光位置 */
  AvgImpressionPosition: number;
  /** 日期：`/Date(1748102400000)/` 或 `/Date(1316156400000-0700)/` 格式 */
  Date: string;
}

/** Bing GetUserSites 返回的站点条目 */
export interface BingSite {
  Url: string;
  IsVerified: boolean;
  AuthenticationCode?: string;
  DnsVerificationCode?: string;
}

/** Bing WCF JSON 信封 + 常见错误字段 */
type BingEnvelope<T> = {
  d?: T | null;
  ErrorCode?: number;
  Message?: string;
  ExceptionDetail?: unknown;
  Errors?: unknown;
  error?: unknown;
};

export interface BingClientOptions {
  apiKey: string;
  siteUrl: string;
  /** 单次请求间节流毫秒（防被限流） */
  throttleMs: number;
  /** 单次请求超时 */
  timeoutMs?: number;
}

export class BingClient {
  private readonly apiKey: string;
  private readonly siteUrl: string;
  private readonly throttleMs: number;
  private readonly timeoutMs: number;
  private lastCallTs = 0;

  constructor(opts: BingClientOptions) {
    this.apiKey = opts.apiKey;
    this.siteUrl = opts.siteUrl;
    this.throttleMs = opts.throttleMs;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * 获取站点 query 级别统计数据。
   *
   * Bing 默认返回近 6 个月每日聚合（每条数据是某查询词在某一日的统计），
   * 数据量取决于站点活跃度。新站可能返回 0 条。
   */
  async getQueryStats(): Promise<BingQueryStat[]> {
    return this.request<BingQueryStat[]>('GetQueryStats', { siteUrl: this.siteUrl });
  }

  /**
   * 列出当前 API key 下所有已添加的站点（用于确权 / siteUrl 精确匹配校验）。
   *
   * Bing 后台 `https://www.example.com` 与 `https://example.com` 是两个站点，
   * 协议 / www / 尾斜杠任一不一致都会导致 GetQueryStats 返回空。
   * 同步阶段必须先用此方法对齐 siteUrl。
   */
  async getUserSites(): Promise<BingSite[]> {
    return this.request<BingSite[]>('GetUserSites');
  }

  /**
   * 通用 GET。返回 { d: T } 结构（WCF JSON），抽取 d。
   *
   * @param method Bing API 方法名（如 `GetQueryStats`、`GetUserSites`）
   * @param params 该方法的 query string 参数（GetUserSites 无参；GetQueryStats 需要 siteUrl）
   */
  private async request<T>(method: string, params: Record<string, string> = {}): Promise<T> {
    await this.throttle();

    const url = new URL(`https://ssl.bing.com/webmaster/api.svc/json/${method}`);
    url.searchParams.set('apikey', this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[bing] ${method} 请求失败: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`[bing] ${method} HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }

    const json = (await resp.json()) as BingEnvelope<T>;

    if (
      json.Message ||
      json.ExceptionDetail ||
      json.ErrorCode !== undefined ||
      json.Errors ||
      json.error
    ) {
      const detail =
        json.Message ??
        JSON.stringify(json.error ?? json.Errors ?? json.ExceptionDetail ?? json.ErrorCode);
      throw new Error(`[bing] ${method} API 错误: ${detail}`);
    }

    if (json.d === undefined || json.d === null) {
      throw new Error(
        `[bing] ${method} 响应缺少有效 d 字段（站点未确权或 API key 无权访问该站点？）`
      );
    }
    return json.d;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastCallTs;
    if (elapsed < this.throttleMs) {
      await sleep(this.throttleMs - elapsed);
    }
    this.lastCallTs = Date.now();
  }
}
