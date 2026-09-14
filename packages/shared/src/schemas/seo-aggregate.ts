import { z } from 'zod';

import { SEO_PAGE_INSIGHT_SOURCES } from './seo-page-insight';
import { SEO_SEARCH_QUERY_SOURCES } from './seo-search-query';

/**
 * SEO 聚合端点共享的 query schema。
 *
 * 这些端点不返回明细行，而是在后端按区间做 groupBy/sum 聚合，
 * 用于前端看板 KPI、趋势图、Top N 排行 —— 解决"前端拉分页明细做全局聚合"
 * 在 pageSize 截尾下数据失真的问题。
 *
 * 时间字段语义：北京日（YYYY-MM-DD），service 层会按
 * `+08:00 0:00 ~ 次日 +08:00 0:00` 转 Date 后下推 Prisma。
 */
const baseRangeSchema = z.object({
  /** 起始日期（北京日，YYYY-MM-DD），必传 */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '需要 YYYY-MM-DD'),
  /** 结束日期（北京日，YYYY-MM-DD，含当日），必传 */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '需要 YYYY-MM-DD'),
  siteUrl: z.string().max(200).optional(),
});

const baseRangeRefine = (data: { startDate: string; endDate: string }) =>
  data.startDate <= data.endDate;

const baseRangeRefineOpts = {
  message: 'startDate 必须 ≤ endDate',
  path: ['startDate'],
};

/**
 * GET /seo/summary —— 搜索平台 + Clarity 综合 KPI（一次算完）
 */
// @no-pagination
export const querySeoSummarySchema = baseRangeSchema
  .extend({
    source: z.enum(SEO_SEARCH_QUERY_SOURCES).optional(),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type QuerySeoSummaryInput = z.infer<typeof querySeoSummarySchema>;

/**
 * GET /seo/search-trend —— 搜索平台按日聚合（Google 使用 site 权威维度）
 */
// @no-pagination
export const querySeoSearchTrendSchema = baseRangeSchema
  .extend({
    source: z.enum(SEO_SEARCH_QUERY_SOURCES).optional(),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type QuerySeoSearchTrendInput = z.infer<typeof querySeoSearchTrendSchema>;

/**
 * SEO 排行维度枚举
 * - keyword: 按关键词聚合（数据源为已接入搜索平台）
 * - page: 按页面 URL 聚合（数据源 Google Search Console page 权威维度）
 */
export const SEO_RANKING_DIMENSIONS = ['keyword', 'page'] as const;
export type SeoRankingDimension = (typeof SEO_RANKING_DIMENSIONS)[number];

/**
 * GET /seo/search-ranking —— Top N 关键词或落地页排行
 */
// @no-pagination
export const querySeoSearchRankingSchema = baseRangeSchema
  .extend({
    dim: z.enum(SEO_RANKING_DIMENSIONS).default('keyword'),
    limit: z.coerce.number().int().min(1).max(100).default(15),
    source: z.string().optional(),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type QuerySeoSearchRankingInput = z.infer<typeof querySeoSearchRankingSchema>;

/**
 * GET /seo/page-insights/site-summary —— Clarity 全站聚合行 (__SITE__) 按日序列
 */
// @no-pagination
export const querySeoSiteSummarySchema = baseRangeSchema
  .extend({
    source: z.enum(SEO_PAGE_INSIGHT_SOURCES).optional(),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type QuerySeoSiteSummaryInput = z.infer<typeof querySeoSiteSummarySchema>;
