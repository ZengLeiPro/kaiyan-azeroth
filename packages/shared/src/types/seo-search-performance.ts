import type { DecimalNumber } from './common';

/** Google Search Console 的站点/页面权威搜索表现。 */
export interface ISeoSearchPerformance {
  id: string;
  statDate: string;
  source: string;
  siteUrl: string;
  /** site / page */
  dimension: string;
  /** site 使用 __SITE__；page 使用完整 URL */
  dimensionValue: string;
  clicks: number;
  impressions: number;
  /** @precision Decimal */
  avgPosition?: DecimalNumber | null;
  /** @precision Decimal */
  ctr?: DecimalNumber | null;
  rawPayload?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}
