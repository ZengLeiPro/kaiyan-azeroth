/**
 * 经营分析（/analytics）模块的入参 Zod Schema
 *
 * 19 个端点契约：
 * - 1 个跨盘总览：GET /analytics/overview
 * - 7 个 CRM 经营盘：kpis / funnel / trend / distribution / ranking / aging / sleeping
 * - 5 个项目交付盘：kpis / distribution / effort / tickets / overdue
 * - 6 个组织效率盘：kpis / completion / sales-activity / approval-sla / headcount-trend / department-overview
 *
 * 所有端点公用 `analyticsRangeSchema`（dateRange 预设 + 可选自定义起止）。
 */

import { z } from 'zod';

// ==================== 公共：日期范围 ====================

/**
 * 日期范围预设值
 * - mtd: month to date（本月初到今日）
 * - last30d: 滚动近 30 天
 * - qtd: quarter to date（本季初到今日）
 * - ytd: year to date（本年初到今日）
 * - custom: 配合 startDate/endDate 使用
 */
export const ANALYTICS_DATE_PRESETS = ['mtd', 'last30d', 'qtd', 'ytd', 'custom'] as const;
export type AnalyticsDatePreset = (typeof ANALYTICS_DATE_PRESETS)[number];

/**
 * 通用日期范围入参
 *
 * 当 preset='custom' 时，startDate/endDate 必填且按 YYYY-MM-DD 校验。
 */
export const analyticsRangeSchema = z
  .object({
    preset: z.enum(ANALYTICS_DATE_PRESETS).default('mtd'),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '开始日期格式应为 YYYY-MM-DD')
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '结束日期格式应为 YYYY-MM-DD')
      .optional(),
  })
  .refine(
    (data) => {
      if (data.preset === 'custom') {
        return Boolean(data.startDate && data.endDate);
      }
      return true;
    },
    { message: 'preset=custom 时必须提供 startDate 与 endDate' }
  );

export type AnalyticsRangeInput = z.infer<typeof analyticsRangeSchema>;

// ==================== 公共：趋势桶粒度 ====================

export const TREND_BUCKETS = ['day', 'week', 'month'] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

// ==================== CRM 经营盘 ====================

/** CRM 趋势 metric 枚举（5 选 1） */
export const CRM_TREND_METRICS = [
  'new_customers', // 新增客户数
  'new_opportunity_amount', // 新增商机金额
  'new_order_amount', // 新签订单金额
  'payment_amount', // 回款金额
  'keep_records', // 跟进数
] as const;
export type CrmTrendMetric = (typeof CRM_TREND_METRICS)[number];

export const crmTrendQuerySchema = analyticsRangeSchema.and(
  z.object({
    metric: z.enum(CRM_TREND_METRICS),
    bucket: z.enum(TREND_BUCKETS).default('day'),
  })
);
export type CrmTrendQueryInput = z.infer<typeof crmTrendQuerySchema>;

/** CRM 客户分布维度（4 选 1） */
export const CRM_DISTRIBUTION_DIMENSIONS = ['level', 'source', 'industry', 'relationship'] as const;
export type CrmDistributionDimension = (typeof CRM_DISTRIBUTION_DIMENSIONS)[number];

export const crmDistributionQuerySchema = z.object({
  dimension: z.enum(CRM_DISTRIBUTION_DIMENSIONS),
});
export type CrmDistributionQueryInput = z.infer<typeof crmDistributionQuerySchema>;

/** CRM 排行 dimension + metric */
export const CRM_RANKING_DIMENSIONS = ['salesperson', 'customer', 'product'] as const;
export type CrmRankingDimension = (typeof CRM_RANKING_DIMENSIONS)[number];

export const CRM_RANKING_METRICS = [
  'paid_amount', // 回款金额（推荐）
  'order_amount', // 订单金额
  'opportunity_amount', // 商机金额
  'keep_records', // 跟进次数
] as const;
export type CrmRankingMetric = (typeof CRM_RANKING_METRICS)[number];

export const crmRankingQuerySchema = analyticsRangeSchema.and(
  z.object({
    dimension: z.enum(CRM_RANKING_DIMENSIONS),
    metric: z.enum(CRM_RANKING_METRICS).default('paid_amount'),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
);
export type CrmRankingQueryInput = z.infer<typeof crmRankingQuerySchema>;

// ==================== 项目交付盘 ====================

/** 项目分布维度（2 选 1） */
export const PROJECT_DISTRIBUTION_DIMENSIONS = ['status', 'category'] as const;
export type ProjectDistributionDimension = (typeof PROJECT_DISTRIBUTION_DIMENSIONS)[number];

export const projectDistributionQuerySchema = z.object({
  dimension: z.enum(PROJECT_DISTRIBUTION_DIMENSIONS),
});
export type ProjectDistributionQueryInput = z.infer<typeof projectDistributionQuerySchema>;

// ==================== 组织效率盘 ====================

/** 月度在职/入职/离职趋势：months 默认 12 */
export const orgHeadcountTrendQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(36).default(12),
});
export type OrgHeadcountTrendQueryInput = z.infer<typeof orgHeadcountTrendQuerySchema>;
