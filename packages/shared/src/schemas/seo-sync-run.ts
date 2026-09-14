import { z } from 'zod';

import { paginationSchema } from './common';

/**
 * SEO 同步任务状态枚举
 */
export const SEO_SYNC_RUN_STATUSES = ['running', 'success', 'partial', 'failed'] as const;

/**
 * SEO 同步任务触发源枚举
 * - timer: FC 定时触发（每日 09:00 北京时间）
 * - http: FC HTTP 触发（手动）
 * - manual: 后端管理面板触发（未来扩展）
 */
export const SEO_SYNC_RUN_TRIGGERS = ['timer', 'http', 'manual'] as const;

/**
 * 时间字符串校验：YYYY-MM-DD 或 ISO datetime（YYYY-MM-DDTHH:mm:ss[.sss][Z|+HH:MM]）。
 * 严格 regex 校验后再用 `new Date()` 解析，避免 `'abc'` 之类被直接交给 Prisma 引发 500。
 */
const dateOrIsoSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    '需要 YYYY-MM-DD 或 ISO 8601 datetime'
  )
  .refine((s) => !Number.isNaN(new Date(s).getTime()), '无效的日期/时间')
  .optional();

/**
 * 查询 SEO 同步任务列表参数 Schema（只读模块）
 */
export const querySeoSyncRunSchema = paginationSchema
  .extend({
    status: z.enum(SEO_SYNC_RUN_STATUSES).optional(),
    triggerSource: z.enum(SEO_SYNC_RUN_TRIGGERS).optional(),
    /** YYYY-MM-DD（按当天 00:00 起算）或完整 ISO datetime */
    startedAtFrom: dateOrIsoSchema,
    startedAtTo: dateOrIsoSchema,
  })
  .refine(
    (d) =>
      !d.startedAtFrom ||
      !d.startedAtTo ||
      new Date(d.startedAtFrom).getTime() <= new Date(d.startedAtTo).getTime(),
    { message: 'startedAtFrom 必须 ≤ startedAtTo', path: ['startedAtFrom'] }
  );

export type QuerySeoSyncRunInput = z.infer<typeof querySeoSyncRunSchema>;

/**
 * SEO 同步任务错误明细子结构（与 types/seo-sync-run.ts 的 ISeoSyncRunError 对齐）
 */
export const seoSyncRunErrorSchema = z.object({
  source: z.string(),
  stage: z.string(),
  message: z.string(),
});

/**
 * SEO 同步任务各源成功条数子结构（与 ISeoSyncRunCounts 对齐）
 */
export const seoSyncRunCountsSchema = z.object({
  bing: z.number().optional(),
  google: z.number().optional(),
  clarity: z.number().optional(),
  baiduTongji: z.number().optional(),
});

/**
 * SEO 同步任务响应 Schema（与 types/seo-sync-run.ts 的 ISeoSyncRunResponse 对齐）。
 * CLI 自动派生需要的「两件套」之一。
 */
export const seoSyncRunResponseSchema = z.object({
  id: z.string(),
  triggerSource: z.string(),
  status: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional().nullable(),
  elapsedMs: z.number().optional().nullable(),
  counts: seoSyncRunCountsSchema,
  errors: z.array(seoSyncRunErrorSchema),
  report: z.record(z.unknown()).optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type SeoSyncRunResponseOutput = z.infer<typeof seoSyncRunResponseSchema>;
