import type { DecimalNumber } from './common';

/**
 * SEO 关键词查询统计（按 site + 日期 + query 唯一）
 *
 * 数据源：Bing Webmaster Tools 与 Google Search Console 的具名 query 维度。
 * Google 会匿名隐藏部分查询，因此本表不能用作 Google 整站总量口径。
 * 数据由 seo-sync FC 每日定时写入，业务层只读。
 */
export interface ISeoSearchQuery {
  id: string;
  /** 数据日期（YYYY-MM-DD） */
  statDate: string;
  /** 数据源：bing / google / baidu / bing-ai / baidu-suggest */
  source: string;
  /** 站点 URL（如 https://www.example.com） */
  siteUrl: string;
  /** 搜索词 */
  query: string;
  /** 点击数 */
  clicks: number;
  /** 曝光数 */
  impressions: number;
  /** 平均排名（小数） */
  /** @precision Decimal */
  avgPosition?: DecimalNumber | null;
  /** 点击率 0~1 */
  /** @precision Decimal */
  ctr?: DecimalNumber | null;
  /** 原始响应（调试 / 未来字段扩展用） */
  rawPayload?: Record<string, unknown> | null;

  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}

export interface ISeoSearchQueryResponse extends ISeoSearchQuery {}
