import type { DecimalNumber } from './common';

/**
 * SEO 整站流量快照（按 site + 日期 唯一）
 *
 * 数据源：百度统计 OpenAPI（待 PV>100 开通后启用，schema 先就位）。
 * 未来可聚合 Bing + Clarity 数据形成 mixed source。
 * 数据由 seo-sync FC 每日定时写入，业务层只读。
 */
export interface ISeoTrafficSourceBreakdown {
  /** 来源类型：search / direct / referral / social / paid */
  type: string;
  /** 来源名称（如 "百度"、"Bing"、"微信"） */
  name: string;
  /** 该来源的访问次数 */
  visits: number;
}

export interface ISeoTrafficSnapshot {
  id: string;
  /** 数据日期（YYYY-MM-DD） */
  statDate: string;
  /** 数据源：baidu-tongji / clarity-aggregate / mixed */
  source: string;
  /** 站点 URL */
  siteUrl: string;
  /** 页面浏览量 */
  pv: number;
  /** 独立访客数 */
  uv: number;
  /** 独立 IP 数 */
  ip: number;
  /** 访问次数（session 数） */
  visitCount: number;
  /** 跳出率 0~1 */
  /** @precision Decimal */
  bounceRate?: DecimalNumber | null;
  /** 平均访问时长（秒） */
  avgVisitTime?: number | null;
  /** 平均访问页数 */
  /** @precision Decimal */
  avgVisitPages?: DecimalNumber | null;
  /** 新访客数 */
  newVisitor: number;
  /** 来源细分 */
  sourceBreakdown: ISeoTrafficSourceBreakdown[];
  /** 原始响应 */
  rawPayload?: Record<string, unknown> | null;

  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}

export interface ISeoTrafficSnapshotResponse extends ISeoTrafficSnapshot {}
