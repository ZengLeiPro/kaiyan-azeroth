import { z } from 'zod';

import { paginationSchema } from './common';

/**
 * SEO 关键词数据源枚举
 * - bing: Bing Webmaster Tools `/GetQueryStats`
 * - google: Google Search Console
 * - baidu: 百度站长（未来扩展）
 * - bing-ai: Bing AI Performance（公测中）
 * - baidu-suggest: 百度联想词（未来扩展）
 */
export const SEO_SEARCH_QUERY_SOURCES = [
  'bing',
  'google',
  'baidu',
  'bing-ai',
  'baidu-suggest',
] as const;

/**
 * 查询 SEO 关键词列表参数 Schema（只读模块，无 create/update）
 */
export const querySeoSearchQuerySchema = paginationSchema.extend({
  siteUrl: z.string().optional(),
  source: z.enum(SEO_SEARCH_QUERY_SOURCES).optional(),
  /** 模糊匹配关键词 */
  keyword: z.string().max(100).optional(),
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

export type QuerySeoSearchQueryInput = z.infer<typeof querySeoSearchQuerySchema>;

/**
 * SEO 关键词查询响应 Schema（与 types/seo-search-query.ts 的 ISeoSearchQueryResponse 对齐）。
 *
 * 此 schema 是 CLI 自动派生需要的「两件套」之一——registry.ts Pass 2 要求
 * query<X>Schema + <x>ResponseSchema 同时存在才注册命令；缺一不可。
 */
export const seoSearchQueryResponseSchema = z.object({
  id: z.string(),
  statDate: z.string(),
  source: z.string(),
  siteUrl: z.string(),
  query: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  avgPosition: z.number().optional().nullable(),
  ctr: z.number().optional().nullable(),
  rawPayload: z.record(z.unknown()).optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type SeoSearchQueryResponseOutput = z.infer<typeof seoSearchQueryResponseSchema>;
