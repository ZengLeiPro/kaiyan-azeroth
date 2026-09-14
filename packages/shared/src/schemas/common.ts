import { z } from 'zod';

/**
 * 普通列表分页参数验证
 * pageSize 上限 10000，支持 CLI/Agent 批量导出场景。
 * 高风险业务表（customers/keep-records/opportunities）在 Service 层
 * 另有 pageSize>500 需 ADMIN 角色的守卫，防前端 bug / 非 ADMIN 恶意脚本
 * 一次性拉大表导致 OOM。
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(10000).default(100),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

/**
 * 选择器场景分页参数验证
 * pageSize 上限设为 10000，支持下拉选择器一次性加载所有选项
 * 适用于：员工/产品/仓库/客户等下拉选择器接口
 */
export const selectionPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(10000).default(100),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  keyword: z.string().max(100).optional(),
});

export type SelectionPaginationInput = z.infer<typeof selectionPaginationSchema>;

/**
 * ID 参数验证
 */
export const idParamSchema = z.object({
  id: z.string().uuid('无效的 ID 格式'),
});

export type IdParam = z.infer<typeof idParamSchema>;

/** 所有更新/软删除接口统一要求客户端提交当前版本。 */
export const mutationVersionQuerySchema = z.object({
  version: z.coerce.number().int().min(1, 'version 必须是正整数'),
});

export type MutationVersionQuery = z.infer<typeof mutationVersionQuerySchema>;

/**
 * 批量操作验证
 */
export const batchIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, '至少选择一项'),
});

export type BatchIds = z.infer<typeof batchIdsSchema>;

/**
 * 日期范围验证
 */
export const dateRangeSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: '开始日期不能大于结束日期',
    }
  );

export type DateRange = z.infer<typeof dateRangeSchema>;

/**
 * 地址验证
 */
export const addressSchema = z.object({
  province: z.string().min(1, '请选择省份'),
  city: z.string().min(1, '请选择城市'),
  district: z.string().min(1, '请选择区县'),
  detail: z.string().max(200, '详细地址最多200个字符').optional(),
});

export type AddressInput = z.infer<typeof addressSchema>;

/**
 * 附件创建验证
 */
export const attachmentCreateSchema = z.object({
  name: z.string().min(1, '文件名不能为空'),
  url: z.string().min(1, 'URL 不能为空').url('URL 格式不正确'),
  size: z.number().int().min(0),
  mimeType: z.string().min(1, 'MIME 类型不能为空'),
});

export type AttachmentCreateInput = z.infer<typeof attachmentCreateSchema>;

/**
 * 附件验证
 */
export const attachmentSchema = attachmentCreateSchema.extend({
  id: z.string().min(1, 'ID 不能为空'),
});

export type AttachmentInput = z.infer<typeof attachmentSchema>;

/**
 * 搜索关键词验证
 */
export const searchSchema = z.object({
  keyword: z.string().max(100, '搜索关键词最多100个字符').optional(),
});

export type SearchInput = z.infer<typeof searchSchema>;

/**
 * 日期字符串验证 (YYYY-MM-DD)
 */
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

/**
 * 可选日期字符串验证
 */
export const optionalDateString = dateString.optional().nullable();

/**
 * 创建分页列表响应 Schema
 * @param itemSchema 列表项的 Zod Schema
 */
export function createPaginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });
}

/**
 * 多选查询参数 helper
 *
 * 接受三种输入形态并统一归一化为 `string[] | undefined`：
 * - `undefined` / `null` / `''` / `[]` → `undefined`
 * - 单个非空字符串 `'A'` → `['A']`（兼容旧的单值 query string）
 * - 字符串数组 `['A', 'B']` → `['A', 'B']`
 *
 * 使用场景：后端 query schema 中的枚举/状态/类型等"可多选"字段。
 * 使用后：
 *   - Zod 类型推导为 `string[] | undefined`
 *   - Service 层直接 `if (x?.length) where.x = { in: x }` 无需判 `Array.isArray`
 *   - 前端 axios 默认数组序列化（`?a[]=1&a[]=2`）与旧单值 URL（`?a=1`）都能被接受
 */
export const stringOrStringArray = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) {
    const filtered = v.filter((x) => typeof x === 'string' && x.length > 0);
    return filtered.length > 0 ? filtered : undefined;
  }
  if (typeof v === 'string') return [v];
  return v;
}, z.array(z.string()).optional());

/**
 * 多选查询参数 helper（UUID 校验版）
 *
 * 与 `stringOrStringArray` 相同，但底层 schema 是 `z.array(z.string().uuid())`。
 * 适用于后端 query schema 中的 `customerId`/`projectId` 等关联实体 ID 字段。
 */
export const stringOrStringArrayOfUuid = z.preprocess((v) => {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) {
    const filtered = v.filter((x) => typeof x === 'string' && x.length > 0);
    return filtered.length > 0 ? filtered : undefined;
  }
  if (typeof v === 'string') return [v];
  return v;
}, z.array(z.string().uuid()).optional());
