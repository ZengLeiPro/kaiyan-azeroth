/**
 * 客户活动时间线（2026-06-16 新增）
 *
 * 把 keep_records / visit_records / operation_logs(kind='change') 统一投影成
 * 同一种 ActivityItem，由客户详情「活动」tab 与 azeroth activities CLI 消费。
 *
 * 设计要点：
 *  - 不引入新表，只读视图；写入仍走原 service。
 *  - importance 三档：milestone（销售复盘 + Agent 决策只看这档）/ normal / trivial。
 *  - category 与 source 解耦：跟进/拜访来自原始记录表，订单/商机/回款/开票/联系人/客户
 *    字段级变更全部来自 operation_logs。
 *  - 配色与图标由前端决定，schema 只承诺数据 shape。
 */

import { z } from 'zod';

import { paginationSchema } from './common';

// ── 枚举 ───────────────────────────────────────────────────────────────

export const ACTIVITY_SOURCE = {
  KEEP: 'keep',
  VISIT: 'visit',
  OPERATION_LOG: 'operation_log',
  /** 2026-06-16：sales_action_items 表本身作为独立数据源 */
  SALES_ACTION_ITEM: 'sales_action_item',
} as const;
export type ActivitySource = (typeof ACTIVITY_SOURCE)[keyof typeof ACTIVITY_SOURCE];

export const ACTIVITY_CATEGORY = {
  FOLLOW_UP: 'follow_up',
  VISIT: 'visit',
  OPPORTUNITY: 'opportunity',
  ORDER: 'order',
  PAYMENT: 'payment',
  /** 2026-06-16：退款（payments.direction='OUT'）从 PAYMENT 拆出 */
  REFUND: 'refund',
  INVOICE: 'invoice',
  CONTACT: 'contact',
  CUSTOMER: 'customer',
  /** 2026-06-16：销售待办（sales_action_items） */
  TODO: 'todo',
} as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORY)[keyof typeof ACTIVITY_CATEGORY];

export const ACTIVITY_IMPORTANCE = {
  MILESTONE: 'milestone',
  NORMAL: 'normal',
  TRIVIAL: 'trivial',
} as const;
export type ActivityImportance = (typeof ACTIVITY_IMPORTANCE)[keyof typeof ACTIVITY_IMPORTANCE];

// ── 字段级 diff（与 CrmChangeLogService.CrmFieldChange 同构） ───────────

export const activityFieldChangeSchema = z.object({
  field: z.string(),
  label: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type ActivityFieldChange = z.infer<typeof activityFieldChangeSchema>;

// ── 活动项 ─────────────────────────────────────────────────────────────

export const activityItemSchema = z.object({
  /** 复合 id：`${source}:${refId}`，便于前端 React key */
  id: z.string(),
  /** 时间线排序锚点（ISO 8601 带时区） */
  occurredAt: z.string().datetime({ offset: true }),
  source: z.enum([
    ACTIVITY_SOURCE.KEEP,
    ACTIVITY_SOURCE.VISIT,
    ACTIVITY_SOURCE.OPERATION_LOG,
    ACTIVITY_SOURCE.SALES_ACTION_ITEM,
  ]),
  category: z.enum([
    ACTIVITY_CATEGORY.FOLLOW_UP,
    ACTIVITY_CATEGORY.VISIT,
    ACTIVITY_CATEGORY.OPPORTUNITY,
    ACTIVITY_CATEGORY.ORDER,
    ACTIVITY_CATEGORY.PAYMENT,
    ACTIVITY_CATEGORY.REFUND,
    ACTIVITY_CATEGORY.INVOICE,
    ACTIVITY_CATEGORY.CONTACT,
    ACTIVITY_CATEGORY.CUSTOMER,
    ACTIVITY_CATEGORY.TODO,
  ]),
  importance: z.enum([
    ACTIVITY_IMPORTANCE.MILESTONE,
    ACTIVITY_IMPORTANCE.NORMAL,
    ACTIVITY_IMPORTANCE.TRIVIAL,
  ]),
  /** 操作动作；keep/visit 固定为 'create' '/update' '/delete'，operation_log 沿用原 action */
  action: z.string(),
  /** 事件发生时的负责人 employeeId（不回溯） */
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  /** 所属客户（前端可省略——已是 by customer 查询） */
  customerId: z.string(),
  /** 关联实体类型，例如 'Opportunity' 'SaleOrder' 'KeepRecord' */
  refType: z.string().nullable(),
  /** 关联实体 id，例如 saleOrder.id / opportunity.id；keep/visit 自己即 refId */
  refId: z.string().nullable(),
  /** 实体名（订单标题/商机名/跟进首行内容等）—— 用于时间线一行摘要 */
  refName: z.string().nullable(),
  /** 一行摘要："新增订单 SO90001 ¥12,800" / "商机阶段：发现需求→解决方案" */
  summary: z.string(),
  /** 详情；前端点击展开时渲染（changes 走 ChangeLogPanel 字段级 diff） */
  detail: z
    .object({
      content: z.string().nullable().optional(),
      changes: z.array(activityFieldChangeSchema).optional(),
      location: z.string().nullable().optional(),
      duration: z.number().nullable().optional(),
      /** operation_log 原始 before/after（只取变更字段） */
      before: z.record(z.unknown()).optional(),
      after: z.record(z.unknown()).optional(),
    })
    .nullable()
    .optional(),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

// ── 查询参数 ───────────────────────────────────────────────────────────

const IMPORTANCE_ENUM = z.enum([
  ACTIVITY_IMPORTANCE.MILESTONE,
  ACTIVITY_IMPORTANCE.NORMAL,
  ACTIVITY_IMPORTANCE.TRIVIAL,
]);

const CATEGORY_ENUM = z.enum([
  ACTIVITY_CATEGORY.FOLLOW_UP,
  ACTIVITY_CATEGORY.VISIT,
  ACTIVITY_CATEGORY.OPPORTUNITY,
  ACTIVITY_CATEGORY.ORDER,
  ACTIVITY_CATEGORY.PAYMENT,
  ACTIVITY_CATEGORY.REFUND,
  ACTIVITY_CATEGORY.INVOICE,
  ACTIVITY_CATEGORY.CONTACT,
  ACTIVITY_CATEGORY.CUSTOMER,
  ACTIVITY_CATEGORY.TODO,
]);

/**
 * 接受三种 input：单值（'milestone'）/ 多值数组（已被前端 URL 处理）/ 逗号分隔字符串
 * 统一 normalize 成 ActivityImportance[]；空值/无效值过滤后若为空则为 undefined。
 */
const importanceFilterSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length === 0 ? undefined : parts;
  }
  return value;
}, z.array(IMPORTANCE_ENUM).optional());

const categoryFilterSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length === 0 ? undefined : parts;
  }
  return value;
}, z.array(CATEGORY_ENUM).optional());

export const queryActivitySchema = paginationSchema.extend({
  /** 必填：客户 ID（扁平路由约定，作为 query 参数而非 path） */
  customerId: z.string().min(1, '客户 ID 不能为空'),
  /** 起始时间（含）。ISO 8601 带时区。 */
  since: z.string().datetime({ offset: true }).optional(),
  /** 结束时间（含当天 23:59）。ISO 8601 带时区。 */
  until: z.string().datetime({ offset: true }).optional(),
  /** 单值或逗号分隔多值 */
  importance: importanceFilterSchema,
  /** 单值或逗号分隔多值 */
  category: categoryFilterSchema,
  /** 上限（覆盖 pagination 默认 pageSize；CLI/Agent 偏好 limit 而非 page） */
  limit: z.coerce.number().int().positive().max(500).optional(),
  /** cursor 分页：传上一页最后一条的 occurredAt（ISO），返回更早的 */
  cursor: z.string().datetime({ offset: true }).optional(),
});
export type QueryActivityInput = z.infer<typeof queryActivitySchema>;

// ── 响应 ───────────────────────────────────────────────────────────────

export const activityListResponseSchema = z.object({
  items: z.array(activityItemSchema),
  total: z.number().int().nonnegative(),
  /** 下一页 cursor（传给下一次请求的 cursor 参数；null=没有更早数据） */
  nextCursor: z.string().nullable(),
});
export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;
