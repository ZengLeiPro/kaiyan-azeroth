import { z } from 'zod';

import { paginationSchema } from './common';

/**
 * SEO 页面级洞察数据源枚举
 * - clarity: Microsoft Clarity Data Export `live-insights`
 * - baidu-tongji: 百度统计页面级数据（未来扩展）
 */
export const SEO_PAGE_INSIGHT_SOURCES = ['clarity', 'baidu-tongji'] as const;

/**
 * 全站聚合行的特殊 pageUrl 标识
 * Clarity 同步时单独写入 1 行 pageUrl='__SITE__' 表示全站聚合，
 * 其他 PopularPages 行使用真实路径。
 */
export const SEO_PAGE_INSIGHT_SITE_AGGREGATE = '__SITE__';

/**
 * 查询 SEO 页面级洞察列表参数 Schema（只读模块）
 */
export const querySeoPageInsightSchema = paginationSchema.extend({
  siteUrl: z.string().optional(),
  source: z.enum(SEO_PAGE_INSIGHT_SOURCES).optional(),
  /** 页面 URL（可传 '__SITE__' 取全站聚合） */
  pageUrl: z.string().optional(),
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

export type QuerySeoPageInsightInput = z.infer<typeof querySeoPageInsightSchema>;

/**
 * SEO 页面级洞察响应 Schema（与 types/seo-page-insight.ts 的 ISeoPageInsightResponse 对齐）。
 * CLI 自动派生需要的「两件套」之一。
 */
export const seoPageInsightResponseSchema = z.object({
  id: z.string(),
  statDate: z.string(),
  source: z.string(),
  siteUrl: z.string(),
  pageUrl: z.string(),
  sessions: z.number(),
  uniqueUsers: z.number(),
  pageViews: z.number(),
  /** 历史命名带 Ms 但实际是秒数，详见 types/seo-page-insight.ts 注释 */
  avgEngagementMs: z.number().optional().nullable(),
  scrollDepthAvg: z.number().optional().nullable(),
  deadClicks: z.number(),
  rageClicks: z.number(),
  quickbacks: z.number(),
  excessiveScroll: z.number(),
  jsErrors: z.number(),
  rawPayload: z.record(z.unknown()).optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type SeoPageInsightResponseOutput = z.infer<typeof seoPageInsightResponseSchema>;
