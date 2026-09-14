import { z } from 'zod';

import { paginationSchema } from './common';

/**
 * SEO 整站流量快照数据源枚举
 * - baidu-tongji: 百度统计 OpenAPI（待 PV>100 开通后启用，当前永远 0 条）
 * - clarity-aggregate: 由 Clarity 全站聚合行推导
 * - mixed: 多源汇总
 */
export const SEO_TRAFFIC_SNAPSHOT_SOURCES = ['baidu-tongji', 'clarity-aggregate', 'mixed'] as const;

/**
 * 查询 SEO 整站流量快照参数 Schema（只读模块）
 */
export const querySeoTrafficSnapshotSchema = paginationSchema.extend({
  siteUrl: z.string().optional(),
  source: z.enum(SEO_TRAFFIC_SNAPSHOT_SOURCES).optional(),
  /** YYYY-MM-DD */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type QuerySeoTrafficSnapshotInput = z.infer<typeof querySeoTrafficSnapshotSchema>;

/**
 * SEO 流量来源细分子结构（与 types/seo-traffic-snapshot.ts 的 ISeoTrafficSourceBreakdown 对齐）
 */
export const seoTrafficSourceBreakdownSchema = z.object({
  type: z.string(),
  name: z.string(),
  visits: z.number(),
});

/**
 * SEO 整站流量快照响应 Schema（与 types/seo-traffic-snapshot.ts 的 ISeoTrafficSnapshotResponse 对齐）。
 * CLI 自动派生需要的「两件套」之一。
 */
export const seoTrafficSnapshotResponseSchema = z.object({
  id: z.string(),
  statDate: z.string(),
  source: z.string(),
  siteUrl: z.string(),
  pv: z.number(),
  uv: z.number(),
  ip: z.number(),
  visitCount: z.number(),
  bounceRate: z.number().optional().nullable(),
  avgVisitTime: z.number().optional().nullable(),
  avgVisitPages: z.number().optional().nullable(),
  newVisitor: z.number(),
  sourceBreakdown: z.array(seoTrafficSourceBreakdownSchema),
  rawPayload: z.record(z.unknown()).optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type SeoTrafficSnapshotResponseOutput = z.infer<typeof seoTrafficSnapshotResponseSchema>;
