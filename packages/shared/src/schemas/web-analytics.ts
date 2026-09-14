import { z } from 'zod';

import { WEB_ANALYTICS_BREAKDOWN_DIMENSIONS } from '../constants/web-analytics';
import { dateString, paginationSchema, stringOrStringArray } from './common';

const booleanQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean().default(false));

const baseRangeRefine = (data: { startDate: string; endDate: string }) =>
  data.startDate <= data.endDate;

const baseRangeRefineOpts = {
  message: 'startDate 必须 ≤ endDate',
  path: ['startDate'],
};

/**
 * 官网分析筛选条件。
 *
 * startDate/endDate 是北京日（YYYY-MM-DD，含 endDate 当天），service 层转换成
 * `+08:00 00:00 ~ next day +08:00 00:00` 的 timestamptz 边界。
 */
export const webAnalyticsFiltersSchema = z.object({
  startDate: dateString,
  endDate: dateString,
  site: z.string().max(255).optional(),
  events: stringOrStringArray,
  pageTypes: stringOrStringArray,
  utmSources: stringOrStringArray,
  refHosts: stringOrStringArray,
  placements: stringOrStringArray,
  channels: stringOrStringArray,
  pathSearch: z.string().max(200).optional(),
  vid: z.string().max(80).optional(),
  includeBots: booleanQuery,
});

export type WebAnalyticsFiltersInput = z.infer<typeof webAnalyticsFiltersSchema>;

// @no-pagination
export const webAnalyticsSummaryQuerySchema = webAnalyticsFiltersSchema.refine(
  baseRangeRefine,
  baseRangeRefineOpts
);
export type WebAnalyticsSummaryQueryInput = z.infer<typeof webAnalyticsSummaryQuerySchema>;

// @no-pagination
export const webAnalyticsTrendQuerySchema = webAnalyticsFiltersSchema.refine(
  baseRangeRefine,
  baseRangeRefineOpts
);
export type WebAnalyticsTrendQueryInput = z.infer<typeof webAnalyticsTrendQuerySchema>;

// @no-pagination
export const webAnalyticsBreakdownQuerySchema = webAnalyticsFiltersSchema
  .extend({
    dimension: z.enum(WEB_ANALYTICS_BREAKDOWN_DIMENSIONS),
    limit: z.coerce.number().int().min(1).max(100).default(15),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsBreakdownQueryInput = z.infer<typeof webAnalyticsBreakdownQuerySchema>;

// @no-pagination
export const webAnalyticsFunnelQuerySchema = webAnalyticsFiltersSchema.refine(
  baseRangeRefine,
  baseRangeRefineOpts
);
export type WebAnalyticsFunnelQueryInput = z.infer<typeof webAnalyticsFunnelQuerySchema>;

// @no-pagination
export const webAnalyticsAttributionQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsAttributionQueryInput = z.infer<typeof webAnalyticsAttributionQuerySchema>;

// @no-pagination
export const webAnalyticsSearchKeywordsQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsSearchKeywordsQueryInput = z.infer<
  typeof webAnalyticsSearchKeywordsQuerySchema
>;

// @no-pagination
export const webAnalyticsLeadRadarQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsLeadRadarQueryInput = z.infer<typeof webAnalyticsLeadRadarQuerySchema>;

// @no-pagination
export const webAnalyticsLandingPagesQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsLandingPagesQueryInput = z.infer<
  typeof webAnalyticsLandingPagesQuerySchema
>;

// @no-pagination
export const webAnalyticsEngineLandingMatrixQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(50).default(15),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsEngineLandingMatrixQueryInput = z.infer<
  typeof webAnalyticsEngineLandingMatrixQuerySchema
>;

// @no-pagination
export const webAnalyticsCampaignConversionQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsCampaignConversionQueryInput = z.infer<
  typeof webAnalyticsCampaignConversionQuerySchema
>;

// @no-pagination
export const webAnalyticsVisitorTypeQuerySchema = webAnalyticsFiltersSchema.refine(
  baseRangeRefine,
  baseRangeRefineOpts
);
export type WebAnalyticsVisitorTypeQueryInput = z.infer<typeof webAnalyticsVisitorTypeQuerySchema>;

// @no-pagination
export const webAnalyticsContentQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsContentQueryInput = z.infer<typeof webAnalyticsContentQuerySchema>;

export const webAnalyticsEventsQuerySchema = paginationSchema
  .extend(webAnalyticsFiltersSchema.shape)
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsEventsQueryInput = z.infer<typeof webAnalyticsEventsQuerySchema>;

// @no-pagination
export const webAnalyticsFilterOptionsQuerySchema = webAnalyticsFiltersSchema
  .extend({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine(baseRangeRefine, baseRangeRefineOpts);
export type WebAnalyticsFilterOptionsQueryInput = z.infer<
  typeof webAnalyticsFilterOptionsQuerySchema
>;
