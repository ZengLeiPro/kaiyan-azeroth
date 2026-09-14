/**
 * SEO 页面级洞察（按 site + 日期 + URL 唯一）
 *
 * 数据源：Microsoft Clarity Data Export API（live-insights），近 3 日窗口。
 * API 限制：每项目每日 10 次调用，1000 sessions / 调用。
 * 数据由 seo-sync FC 每日定时写入，业务层只读。
 */
export interface ISeoPageInsight {
  id: string;
  /** 数据日期（YYYY-MM-DD） */
  statDate: string;
  /** 数据源：clarity（未来可扩 baidu-tongji 页面统计） */
  source: string;
  /** 站点 URL */
  siteUrl: string;
  /** 页面 URL（相对路径，如 /about/ 或 /） */
  pageUrl: string;
  /** 该页 sessions 数 */
  sessions: number;
  /** 唯一访客数 */
  uniqueUsers: number;
  /** 总浏览页数 */
  pageViews: number;
  /**
   * 平均停留时长（秒）。
   *
   * ⚠️ 字段名带 `Ms` 是历史遗留，Clarity API 实际返回的是秒数，
   * `apps/seo-sync/src/sync/sync-clarity.ts` 也按秒原样写入。
   * 前端展示直接当秒数使用，**不要再除 1000**。
   */
  avgEngagementMs?: number | null;
  /** 平均滚动深度 0~100 */
  scrollDepthAvg?: number | null;
  /** 死点击次数 */
  deadClicks: number;
  /** 暴怒点击次数 */
  rageClicks: number;
  /** 快速回退次数（5 秒内离开） */
  quickbacks: number;
  /** 过度滚动次数 */
  excessiveScroll: number;
  /** JS 错误次数 */
  jsErrors: number;
  /** 原始响应 */
  rawPayload?: Record<string, unknown> | null;

  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}

export interface ISeoPageInsightResponse extends ISeoPageInsight {}
