/**
 * 经营分析指标键 → 中文标签 + 单位 + 推荐图表色映射
 *
 * 前端图表组件根据 metric key 自动获得 label / unit / color，
 * 不再在 page 内 hardcode 翻译。
 */

import {
  CRM_RANKING_METRICS,
  CRM_TREND_METRICS,
  type CrmRankingMetric,
  type CrmTrendMetric,
} from '../schemas/analytics';

// ==================== CRM 趋势 metric ====================

export const CRM_TREND_METRIC_LABELS: Record<CrmTrendMetric, string> = {
  new_customers: '新增客户数',
  new_opportunity_amount: '新增商机金额',
  new_order_amount: '新签订单金额',
  payment_amount: '回款金额',
  keep_records: '跟进数',
};

/** 是否是金额型 metric（前端格式化用） */
export const CRM_TREND_METRIC_IS_AMOUNT: Record<CrmTrendMetric, boolean> = {
  new_customers: false,
  new_opportunity_amount: true,
  new_order_amount: true,
  payment_amount: true,
  keep_records: false,
};

// ==================== CRM 排行 metric ====================

export const CRM_RANKING_METRIC_LABELS: Record<CrmRankingMetric, string> = {
  paid_amount: '回款金额',
  order_amount: '订单金额',
  opportunity_amount: '商机金额',
  keep_records: '跟进次数',
};

export const CRM_RANKING_METRIC_IS_AMOUNT: Record<CrmRankingMetric, boolean> = {
  paid_amount: true,
  order_amount: true,
  opportunity_amount: true,
  keep_records: false,
};

// ==================== 应收账龄桶 ====================

export const AGING_BUCKETS = [
  { label: '0-30 天', min: 0, max: 30 },
  { label: '31-60 天', min: 31, max: 60 },
  { label: '61-90 天', min: 61, max: 90 },
  { label: '90 天以上', min: 91, max: Infinity },
] as const;

// ==================== 工时填报 / 日报提交 完成度阈值 ====================

/** 完成率告警阈值（前端用于卡片配色） */
export const COMPLETION_RATE_THRESHOLDS = {
  GOOD: 90, // ≥90% 绿色
  WARN: 70, // 70-89% 橙色
  // <70 红色
} as const;

// ==================== 推荐图表色板 ====================

/**
 * 仪表盘统一色板，与云成本 dashboard 保持一致风格
 * 0..N 索引取色，超出循环
 */
export const ANALYTICS_CHART_COLORS = [
  '#2e56e1', // 蓝
  '#7c3aed', // 紫
  '#22c55e', // 绿
  '#f59e0b', // 琥珀
  '#ef4444', // 红
  '#0ea5e9', // 天蓝
  '#10b981', // 翠绿
  '#a855f7', // 亮紫
  '#f97316', // 橙
  '#06b6d4', // 青
] as const;

/** 用于商机阶段漏斗的「赢/输」对照色 */
export const FUNNEL_OUTCOME_COLORS = {
  inFlight: '#2e56e1', // 进行中 4 阶段（蓝）
  won: '#22c55e', // 赢单（绿）
  lost: '#94a3b8', // 输单流失（灰）
} as const;

/** 应收账龄分桶配色（按风险递增） */
export const AGING_BUCKET_COLORS = ['#22c55e', '#f59e0b', '#f97316', '#ef4444'] as const;

// ==================== 重导出常用 metric values（便于前端 import 一次） ====================

export { CRM_RANKING_METRICS, CRM_TREND_METRICS };
