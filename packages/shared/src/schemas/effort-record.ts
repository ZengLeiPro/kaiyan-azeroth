import { z } from 'zod';

import { EFFORT_RECORD_TYPE_VALUES } from '../constants/effort-record-types';
import { EFFORT_WORK_TYPE_VALUES } from '../constants/effort-work-types';
import { withColumn } from './column-meta';
import { COL_DATE, COL_DATETIME, COL_NUMBER, COL_STATUS } from './column-widths';
import { paginationSchema, stringOrStringArray, stringOrStringArrayOfUuid } from './common';

/**
 * 工时记录创建 Schema
 */
export const createEffortRecordSchema = z.object({
  projectId: z.string().uuid('项目ID格式不正确'),
  /** @precision Decimal */
  actualTime: z.coerce.number({ required_error: '实际工时不能为空' }).positive('工时必须大于0'),
  description: z.string().min(1, '请填写工作描述'),
  workType: z.enum(EFFORT_WORK_TYPE_VALUES, { message: '无效的工作类型' }).optional().nullable(),
  workDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .optional()
    .nullable(),
  recordType: z.enum(EFFORT_RECORD_TYPE_VALUES).default('ACTUAL').optional(),
  ownerId: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

/**
 * 工时记录更新 Schema（含 version 用于乐观锁）
 * 注：description 在 update 时保持 optional，不强制历史记录补填
 */
export const updateEffortRecordSchema = z
  .object({
    projectId: z.string().uuid('项目ID格式不正确'),
    actualTime: z.coerce.number({ required_error: '实际工时不能为空' }),
    description: z.string().optional().nullable(),
    workType: z.enum(EFFORT_WORK_TYPE_VALUES, { message: '无效的工作类型' }).optional().nullable(),
    workDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
      .optional()
      .nullable(),
    recordType: z.enum(EFFORT_RECORD_TYPE_VALUES).optional(),
    ownerId: z.string().optional().nullable(),
    startDate: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
  })
  .partial()
  .extend({
    version: z.number().int().min(1),
  });

/**
 * 工时记录查询 Schema
 */
export const queryEffortRecordSchema = paginationSchema.extend({
  ownerId: z.string().optional(),
  keyword: z.string().max(100).optional(),
  projectId: stringOrStringArrayOfUuid,
  workType: z.string().optional(),
  recordType: z.enum(EFFORT_RECORD_TYPE_VALUES).optional(),
  /** 按工时日期筛选（>=） */
  startDate: z.string().optional(),
  /** 按工时日期筛选（<=，含当日） */
  endDate: z.string().optional(),
});

/**
 * 批量创建工时记录 Schema
 */
export const batchCreateEffortRecordSchema = z.object({
  items: z
    .array(createEffortRecordSchema)
    .min(1, '至少提交一条工时记录')
    .max(20, '单次最多提交20条')
    .default([]),
});

/**
 * 工时记录关联项目简要信息 Schema
 */
export const effortRecordProjectInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  customerName: z.string().optional().nullable(),
});

/**
 * 工时记录响应 Schema（含关联信息）
 *
 * 列 UI 元数据附着在字段 schema 上，供前端 `deriveColumnsFromSchema` 派生表格列。
 * 业务 Badge（记录类型蓝色/灰色区分、工时类型 label 翻译）在页面 overrides 保留。
 *
 * 注：`projectName` 是前端 `transformData` 从 `project.name` 展平的视图字段，
 * `customerName` 是前端 `transformData` 从 `project.customerName` 展平的视图字段，
 * 作为可选字段登记以获得列 meta；后端返回时可能没有这个字段。
 */
export const effortRecordResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: withColumn(z.string().optional().nullable(), {
    label: '项目名称',
    type: 'custom',
    required: true,
    order: 10,
  }),
  customerName: withColumn(z.string().optional().nullable(), {
    label: '客户',
    type: 'custom',
    order: 15,
  }),
  /** @precision Decimal */
  actualTime: withColumn(z.number(), {
    label: '实际工时',
    width: COL_NUMBER,
    sortable: true,
    type: 'custom',
    order: 20,
  }),
  description: withColumn(z.string().optional().nullable(), {
    label: '工时描述',
    width: 200,
    type: 'custom',
    order: 80,
  }),
  workType: withColumn(z.string().optional().nullable(), {
    label: '工时类型',
    width: COL_STATUS,
    type: 'custom',
    order: 70,
  }),
  workDate: z.string().optional().nullable(),
  recordType: withColumn(z.string().optional().nullable(), {
    label: '记录类型',
    width: COL_STATUS,
    type: 'custom',
    order: 40,
  }),
  ownerId: z.string().optional().nullable(),
  ownerName: withColumn(z.string().optional().nullable(), {
    label: '记录人',
    type: 'custom',
    order: 30,
  }),
  startDate: withColumn(z.string().optional().nullable(), {
    label: '开始日期',
    width: COL_DATE,
    sortable: true,
    type: 'custom',
    order: 50,
  }),
  endDate: withColumn(z.string().optional().nullable(), {
    label: '结束日期',
    width: COL_DATE,
    sortable: true,
    type: 'custom',
    order: 60,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    order: 90,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int().min(1),
  project: effortRecordProjectInfoSchema.optional(),
});

/**
 * 工时统计查询 Schema
 */
export const effortStatsQuerySchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '开始日期格式应为 YYYY-MM-DD')
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '结束日期格式应为 YYYY-MM-DD')
      .optional(),
    groupBy: z.enum(['person', 'project', 'customer', 'workType', 'completion']),
    projectId: stringOrStringArrayOfUuid,
    customerId: z.string().uuid().optional(),
    ownerId: stringOrStringArray,
  })
  .superRefine((data, ctx) => {
    const hasStartDate = Boolean(data.startDate);
    const hasEndDate = Boolean(data.endDate);

    if (hasStartDate !== hasEndDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'startDate 和 endDate 必须同时提供',
      });
      return;
    }

    if (data.groupBy !== 'project' && (!hasStartDate || !hasEndDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: '除按项目统计外，startDate 和 endDate 为必填项',
      });
    }
  });

export type CreateEffortRecordInput = z.infer<typeof createEffortRecordSchema>;
export type UpdateEffortRecordInput = z.infer<typeof updateEffortRecordSchema>;
export type QueryEffortRecordInput = z.infer<typeof queryEffortRecordSchema>;
export type BatchCreateEffortRecordInput = z.infer<typeof batchCreateEffortRecordSchema>;
export type EffortRecordProjectInfoOutput = z.infer<typeof effortRecordProjectInfoSchema>;
export type EffortRecordResponseOutput = z.infer<typeof effortRecordResponseSchema>;
export type EffortStatsQueryInput = z.infer<typeof effortStatsQuerySchema>;
