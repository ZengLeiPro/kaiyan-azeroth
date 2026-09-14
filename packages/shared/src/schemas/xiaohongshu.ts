import { z } from 'zod';

import {
  XIAOHONGSHU_RANKING_METRICS,
  XIAOHONGSHU_REPORT_LEVELS,
  XIAOHONGSHU_SYNC_STATUSES,
} from '../constants/xiaohongshu';
import { dateString, paginationSchema } from './common';

const reportLevelSchema = z.enum(XIAOHONGSHU_REPORT_LEVELS);
const syncStatusSchema = z.enum(XIAOHONGSHU_SYNC_STATUSES);
const dataCaliberSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() ? Number(value) : value),
  z.union([z.literal(0), z.literal(1)])
);
const advertiserIdSchema = z.string().trim().min(1).max(128);
export const xiaohongshuDatasetIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, '数据集标识格式不正确');
const xiaohongshuJsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(xiaohongshuJsonValueSchema),
    z.record(z.string(), xiaohongshuJsonValueSchema),
  ])
);
const optionalDateRangeShape = {
  startDate: dateString.optional(),
  endDate: dateString.optional(),
};
const requiredDateRangeShape = {
  startDate: dateString,
  endDate: dateString,
};
const dateRangeRefine = (data: { startDate?: string; endDate?: string }) =>
  !data.startDate || !data.endDate || data.startDate <= data.endDate;
const dateRangeRefineOptions = {
  message: 'startDate 必须 ≤ endDate',
  path: ['startDate'],
};

/** POST /xiaohongshu/sync —— 手动发起日报同步。 */
export const xiaohongshuManualSyncBodySchema = z
  .object({
    ...optionalDateRangeShape,
    levels: z
      .array(reportLevelSchema)
      .min(1)
      .default([...XIAOHONGSHU_REPORT_LEVELS]),
    advertiserIds: z.array(advertiserIdSchema).min(1).optional(),
  })
  .refine(dateRangeRefine, dateRangeRefineOptions);
export type XiaohongshuManualSyncBodyInput = z.infer<typeof xiaohongshuManualSyncBodySchema>;

/** GET /xiaohongshu/reports —— 聚光日报明细列表。 */
export const xiaohongshuDailyReportQuerySchema = paginationSchema
  .extend({
    ...optionalDateRangeShape,
    advertiserId: advertiserIdSchema.optional(),
    level: reportLevelSchema.optional(),
    dataCaliber: dataCaliberSchema.default(0),
  })
  .refine(dateRangeRefine, dateRangeRefineOptions);
export type XiaohongshuDailyReportQueryInput = z.infer<typeof xiaohongshuDailyReportQuerySchema>;

/** GET /xiaohongshu/sync-runs —— 同步任务列表。 */
export const xiaohongshuSyncRunQuerySchema = paginationSchema.extend({
  status: syncStatusSchema.optional(),
  advertiserId: advertiserIdSchema.optional(),
});
export type XiaohongshuSyncRunQueryInput = z.infer<typeof xiaohongshuSyncRunQuerySchema>;

const analyticsRangeShape = {
  ...requiredDateRangeShape,
  advertiserId: advertiserIdSchema.optional(),
  level: reportLevelSchema.default('account'),
  dataCaliber: dataCaliberSchema.default(0),
};

/** GET /xiaohongshu/summary —— 区间汇总，可选对比区间。 */
// @no-pagination
export const xiaohongshuSummaryQuerySchema = z
  .object({
    ...analyticsRangeShape,
    compareStartDate: dateString.optional(),
    compareEndDate: dateString.optional(),
  })
  .refine(dateRangeRefine, dateRangeRefineOptions)
  .refine((data) => Boolean(data.compareStartDate) === Boolean(data.compareEndDate), {
    message: 'compareStartDate 与 compareEndDate 必须同时提供',
    path: ['compareStartDate'],
  })
  .refine(
    (data) =>
      !data.compareStartDate ||
      !data.compareEndDate ||
      data.compareStartDate <= data.compareEndDate,
    { message: 'compareStartDate 必须 ≤ compareEndDate', path: ['compareStartDate'] }
  );
export type XiaohongshuSummaryQueryInput = z.infer<typeof xiaohongshuSummaryQuerySchema>;

/** GET /xiaohongshu/trend —— 按日趋势。 */
// @no-pagination
export const xiaohongshuTrendQuerySchema = z
  .object(analyticsRangeShape)
  .refine(dateRangeRefine, dateRangeRefineOptions);
export type XiaohongshuTrendQueryInput = z.infer<typeof xiaohongshuTrendQuerySchema>;

/** GET /xiaohongshu/ranking —— 指定层级 Top N 排行。 */
// @no-pagination
export const xiaohongshuRankingQuerySchema = z
  .object({
    ...requiredDateRangeShape,
    advertiserId: advertiserIdSchema.optional(),
    level: reportLevelSchema,
    dataCaliber: dataCaliberSchema.default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    metric: z.enum(XIAOHONGSHU_RANKING_METRICS).default('fee'),
  })
  .refine(dateRangeRefine, dateRangeRefineOptions);
export type XiaohongshuRankingQueryInput = z.infer<typeof xiaohongshuRankingQuerySchema>;

/** POST /xiaohongshu/datasets/:dataset/query —— 按动态 registry 契约受控查询任意只读数据集。 */
export const xiaohongshuDatasetQuerySchema = z
  .object({
    advertiserId: advertiserIdSchema,
    ...optionalDateRangeShape,
    dataCaliber: dataCaliberSchema.default(0),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    /** 仅合并到 registry 白名单接口的请求体；账户、分页与日期由服务端覆盖。 */
    params: z.record(z.string(), xiaohongshuJsonValueSchema).default({}),
  })
  .strict()
  .refine((data) => Boolean(data.startDate) === Boolean(data.endDate), {
    message: 'startDate 与 endDate 必须同时提供',
    path: ['startDate'],
  })
  .refine(dateRangeRefine, dateRangeRefineOptions);
export type XiaohongshuDatasetQueryInput = z.infer<typeof xiaohongshuDatasetQuerySchema>;

/** GET /xiaohongshu/datasets —— 按当前选中广告主解析真实授权范围。 */
export const xiaohongshuDatasetCatalogQuerySchema = z
  .object({
    advertiserId: advertiserIdSchema.optional(),
  })
  .strict();
export type XiaohongshuDatasetCatalogQueryInput = z.infer<
  typeof xiaohongshuDatasetCatalogQuerySchema
>;
