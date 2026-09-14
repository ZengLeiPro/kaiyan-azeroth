import { z } from 'zod';

/**
 * 表格列宽 / 列显隐 / 列顺序 / 默认排序的全员默认配置。
 *
 * - `visibility`: 列 key → 是否显示
 * - `widths`: 列 key → 列宽（正整数像素）
 * - `order`: 列 key 的有序数组（决定列的水平顺序）
 * - `sortBy` / `sortOrder`: 默认排序字段与方向（来自前端 sortable 列的 `sortKey || key`）
 *
 * 所有字段均为可选：管理员一键推送时通常一起带上，但 schema 允许任意子集；
 * 旧记录无 sortBy/sortOrder 时，前端会回退到 page hard-coded initialSortBy。
 */
export const tablePreferenceConfigSchema = z.object({
  visibility: z.record(z.string(), z.boolean()).optional(),
  widths: z.record(z.string(), z.number().int().positive()).optional(),
  order: z.array(z.string().min(1).max(100)).optional(),
  sortBy: z.string().min(1).max(100).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

/** 查询单条全员默认 - @no-pagination: 按 pageKey 精确查询，无需分页 */
export const queryTablePreferenceSchema = z.object({
  pageKey: z.string().min(1).max(200),
});

/** 管理员推送 / 上行请求体 */
export const upsertTablePreferenceSchema = z.object({
  pageKey: z.string().min(1).max(200),
  config: tablePreferenceConfigSchema,
});

/** 单条全员默认的响应体（GET 时若不存在，HTTP 层返回 null） */
export const tablePreferenceResponseSchema = z.object({
  id: z.string(),
  pageKey: z.string(),
  config: tablePreferenceConfigSchema,
  version: z.number().int().positive(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

export type TablePreferenceConfig = z.infer<typeof tablePreferenceConfigSchema>;
export type UpsertTablePreferenceInput = z.infer<typeof upsertTablePreferenceSchema>;
export type QueryTablePreferenceInput = z.infer<typeof queryTablePreferenceSchema>;
export type TablePreferenceResponse = z.infer<typeof tablePreferenceResponseSchema>;
