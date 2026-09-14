import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME, COL_STATUS } from './column-widths';
import { attachmentSchema, paginationSchema, stringOrStringArray } from './common';

export const INTENT_TEMPERATURE_VALUES = ['UNJUDGED', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const;
export const INTENT_REASON_VALUES = [
  'PAIN_POINT',
  'ASKED_PRICE',
  'DEMO',
  'VISIT',
  'BUDGET_UNCERTAIN',
  'TIMING_UNCERTAIN',
  'DECISION_MAKER_UNFOUND',
  'REJECTED',
] as const;

/**
 * 跟进记录创建 Schema
 */
export const keepRecordBaseSchema = z.object({
  customerId: z.string().min(1, '请选择客户').uuid('客户ID格式不正确'),
  contactId: z.string().uuid().optional().nullable(),
  keepRecordType: z.string().trim().min(1, '请选择跟进类型'),
  // 契约：必须为 ISO 8601 带时区（Z 或 ±HH:MM）。
  // 前端 datetime-local 控件统一走 localInputToIso 转 ISO UTC；
  // CLI/外部脚本也必须传带时区的字符串。后端 parseClientDateTime 仍作兜底。
  keepRecordTime: z
    .string()
    .min(1, '请选择跟进时间')
    .datetime({ offset: true, message: 'keepRecordTime 必须是 ISO 8601 带时区时间' }),
  keepRecordContent: z.string().trim().min(1, '请输入跟进内容'),
  keepRecordStatus: z.string().trim().min(1, '请选择跟进状态'),
  chargerId: z.string().trim().min(1, '请选择负责人'),
  intentTemperature: z.enum(INTENT_TEMPERATURE_VALUES).optional().nullable(),
  intentReasons: z.array(z.enum(INTENT_REASON_VALUES)).optional().nullable(),
  nextFollowUpAt: z.string().date('下次回访日期格式不正确').optional().nullable(),
  attachments: z.array(attachmentSchema).optional().nullable(),
  // 闭环来源（采纳写入时由后端注入；前端创建一般不传）
  source: z.string().max(50).optional().nullable(),
  sourceActionItemId: z.string().uuid().optional().nullable(),
});

export const validateIntentFields = (
  data: {
    intentTemperature?: string | null;
    intentReasons?: string[] | null;
    nextFollowUpAt?: string | null;
  },
  ctx: z.RefinementCtx
) => {
  if (
    data.intentTemperature &&
    data.intentTemperature !== 'UNJUDGED' &&
    !data.intentReasons?.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['intentReasons'],
      message: '请选择至少一项意向依据',
    });
  }
  if (['HIGH', 'MEDIUM', 'LOW'].includes(data.intentTemperature ?? '') && !data.nextFollowUpAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nextFollowUpAt'],
      message: '请填写下次回访日期',
    });
  }
};

export const createKeepRecordSchema = keepRecordBaseSchema.superRefine(validateIntentFields);

/**
 * 跟进记录更新 Schema（含 version 用于乐观锁）
 */
export const updateKeepRecordSchema = keepRecordBaseSchema
  .partial()
  .extend({
    version: z
      .number({
        required_error: '请携带乐观锁版本号',
        invalid_type_error: '乐观锁版本号必须是整数',
      })
      .int('乐观锁版本号必须是整数')
      .min(1, '乐观锁版本号必须大于等于 1'),
  })
  .superRefine(validateIntentFields);

/**
 * 跟进记录查询 Schema
 */
export const queryKeepRecordSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  customerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  keepRecordType: stringOrStringArray,
});

/**
 * 跟进记录关联客户简要信息 Schema
 */
export const keepRecordCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 跟进记录关联联系人简要信息 Schema
 */
export const keepRecordContactInfoSchema = z.object({
  id: z.string(),
  contactName: z.string(),
});

/**
 * 跟进记录响应 Schema
 *
 * 列 UI 元数据通过 `withColumn(...)` 附着。customer/contact 在页面 Profile 层扁平化为
 * customerName/contactName，通过 overrides `mode:'before'` 注入。
 */
export const keepRecordResponseSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  contactId: z.string().optional().nullable(),
  keepRecordType: withColumn(z.string().optional().nullable(), {
    label: '跟进类型',
    type: 'statusBadge',
    statusMapKey: 'keepRecordType',
    order: 30,
  }),
  keepRecordTime: withColumn(z.string().optional().nullable(), {
    label: '跟进时间',
    sortable: true,
    type: 'datetime',
    order: 40,
  }),
  keepRecordContent: withColumn(z.string().optional().nullable(), {
    label: '跟进内容',
    type: 'custom', // 页面 overrides（30 字截断）
    order: 50,
  }),
  keepRecordStatus: withColumn(z.string().optional().nullable(), {
    label: '状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'keepRecordStatus',
    order: 60,
  }),
  attachments: withColumn(z.array(attachmentSchema).optional().nullable(), {
    label: '附件',
    type: 'custom', // 页面 overrides（计数）
    order: 90,
  }),
  chargerId: z.string().optional().nullable(),
  intentTemperature: z.enum(INTENT_TEMPERATURE_VALUES).optional().nullable(),
  intentReasons: z.array(z.enum(INTENT_REASON_VALUES)).optional().nullable(),
  nextFollowUpAt: z.string().optional().nullable(),
  chargerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'text',
    order: 70,
  }),
  // 闭环来源（采纳写入标记 + 反查待办）
  source: z.string().optional().nullable(),
  sourceActionItemId: z.string().optional().nullable(),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 110,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    sortable: true,
    order: 120,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  customer: keepRecordCustomerInfoSchema.optional(),
  contact: keepRecordContactInfoSchema.optional(),
});

export type CreateKeepRecordInput = z.infer<typeof createKeepRecordSchema>;
export type UpdateKeepRecordInput = z.infer<typeof updateKeepRecordSchema>;
export type QueryKeepRecordInput = z.infer<typeof queryKeepRecordSchema>;
export type KeepRecordCustomerInfoOutput = z.infer<typeof keepRecordCustomerInfoSchema>;
export type KeepRecordContactInfoOutput = z.infer<typeof keepRecordContactInfoSchema>;
export type KeepRecordResponseOutput = z.infer<typeof keepRecordResponseSchema>;
