import { sleep } from '../utils/date';

/**
 * Microsoft Clarity Data Export API 客户端。
 *
 * 文档：https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
 * 端点：POST https://www.clarity.ms/export-data/api/v1/project-live-insights
 * 鉴权：Bearer <JWT token>
 *
 * 限制（强约束）：
 *   - 每项目每日 10 次调用
 *   - 单次仅能拿近 1-3 天数据（numOfDays 参数）
 *   - 单次最多 1000 sessions
 *
 * 我们每日 cron 只调用 1 次拿 numOfDays=1（昨天的聚合）。
 */

export interface ClarityMetricInformation {
  /** 指标名称：Traffic / EngagementTime / ScrollDepth / DeadClickCount / RageClickCount / QuickbackClickCount / ExcessiveScroll / ScriptError / PopularPages 等 */
  metricName: string;
  /** 维度数据 */
  information: Array<Record<string, string | number>>;
}

export type ClarityLiveInsightsResponse = ClarityMetricInformation[];

export interface ClarityClientOptions {
  /** JWT token */
  apiToken: string;
  /** 节流毫秒 */
  throttleMs: number;
  /** 超时毫秒 */
  timeoutMs?: number;
}

export class ClarityClient {
  private readonly apiToken: string;
  private readonly throttleMs: number;
  private readonly timeoutMs: number;
  private lastCallTs = 0;

  constructor(opts: ClarityClientOptions) {
    this.apiToken = opts.apiToken;
    this.throttleMs = opts.throttleMs;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * 获取项目 live insights。
   *
   * @param numOfDays 1-3，单次拿近 N 天聚合数据
   * @param dimension1 可选维度过滤（如 Country / OS / Browser / Device / Source / Medium / Campaign / Channel / Page / URL）
   */
  async getLiveInsights(
    numOfDays: number,
    dimension1?: string
  ): Promise<ClarityLiveInsightsResponse> {
    await this.throttle();

    const url = new URL('https://www.clarity.ms/export-data/api/v1/project-live-insights');
    url.searchParams.set('numOfDays', String(numOfDays));
    if (dimension1) url.searchParams.set('dimension1', dimension1);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[clarity] live-insights 请求失败: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`[clarity] live-insights HTTP ${resp.status}: ${text.slice(0, 300)}`);
    }

    return (await resp.json()) as ClarityLiveInsightsResponse;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastCallTs;
    if (elapsed < this.throttleMs) {
      await sleep(this.throttleMs - elapsed);
    }
    this.lastCallTs = Date.now();
  }
}
