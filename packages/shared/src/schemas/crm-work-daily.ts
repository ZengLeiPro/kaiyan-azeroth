import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATE, COL_NUMBER, COL_STATUS } from './column-widths';
import { attachmentSchema, paginationSchema, stringOrStringArray } from './common';

/**
 * CRM 工作日报创建 Schema
 */
export const createCrmWorkDailySchema = z.object({
  reportDate: z.string().optional().nullable(),
  reportType: z.string().optional().nullable(),
  submitStatus: z.string().optional().nullable(),
  senderId: z.string().optional().nullable(),
  keyCustomerSummary: z.string().optional().nullable(),
  tomorrowVisitPlan: z.string().optional().nullable(),
  otherPlanArrangements: z.string().optional().nullable(),
  coordinationItems: z.string().optional().nullable(),
  callsMadeCount: z.coerce.number().int().optional().nullable(),
  callsConnectedCount: z.coerce.number().int().optional().nullable(),
  callsOver30sCount: z.coerce.number().int().optional().nullable(),
  totalCallMinutes: z.coerce.number().int().optional().nullable(),
  visitCustomerCount: z.coerce.number().int().optional().nullable(),
  newCustomerCount: z.coerce.number().int().optional().nullable(),
  newContactMethodCount: z.coerce.number().int().optional().nullable(),
  remark: z.string().optional().nullable(),
  attachments: z.array(attachmentSchema).optional().nullable(),
});

/**
 * CRM 工作日报更新 Schema（含 version 用于乐观锁）
 */
export const updateCrmWorkDailySchema = createCrmWorkDailySchema.partial().extend({
  version: z.number().int().optional(),
});

/**
 * CRM 工作日报查询 Schema
 */
export const queryCrmWorkDailySchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  senderId: z.string().optional(),
  reportType: stringOrStringArray,
  submitStatus: stringOrStringArray,
});

/**
 * CRM 工作日报响应 Schema
 *
 * 列 UI 元数据通过 `withColumn(...)` 附着。workDailyStatusMap 未注册到 column-renderers，
 * submitStatus 用页面 overrides 保留 StatusBadge。
 */
export const crmWorkDailyResponseSchema = z.object({
  id: z.string(),
  reportDate: withColumn(z.string().optional().nullable(), {
    label: '日报日期',
    width: COL_DATE,
    sortable: true,
    type: 'date',
    required: true,
    order: 10,
  }),
  reportType: withColumn(z.string().optional().nullable(), {
    label: '报告类型',
    type: 'statusBadge',
    statusMapKey: 'reportType',
    order: 30,
  }),
  submitStatus: withColumn(z.string().optional().nullable(), {
    label: '提交状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'workDailyStatus',
    order: 40,
  }),
  senderId: z.string().optional().nullable(),
  senderName: withColumn(z.string().optional().nullable(), {
    label: '提交人',
    type: 'text',
    order: 20,
  }),
  keyCustomerSummary: withColumn(z.string().optional().nullable(), {
    label: '重点客户总结',
    width: 200,
    type: 'custom', // 页面 overrides（line-clamp）
    hidden: true,
    order: 100,
  }),
  tomorrowVisitPlan: withColumn(z.string().optional().nullable(), {
    label: '明日拜访计划',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 110,
  }),
  otherPlanArrangements: withColumn(z.string().optional().nullable(), {
    label: '其他计划安排',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 120,
  }),
  coordinationItems: withColumn(z.string().optional().nullable(), {
    label: '协调事项',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 130,
  }),
  callsMadeCount: withColumn(z.number().optional().nullable(), {
    label: '拨打电话',
    width: COL_NUMBER,
    type: 'custom', // 页面 overrides（null vs number 展示）
    order: 50,
  }),
  callsConnectedCount: withColumn(z.number().optional().nullable(), {
    label: '接通电话',
    width: COL_NUMBER,
    type: 'custom',
    order: 60,
  }),
  callsOver30sCount: withColumn(z.number().optional().nullable(), {
    label: '三十秒',
    width: COL_NUMBER,
    type: 'custom',
    order: 62,
  }),
  totalCallMinutes: withColumn(z.number().optional().nullable(), {
    label: '总时长(分)',
    width: COL_NUMBER,
    type: 'custom',
    order: 64,
  }),
  visitCustomerCount: withColumn(z.number().optional().nullable(), {
    label: '拜访客户',
    width: COL_NUMBER,
    type: 'custom',
    order: 70,
  }),
  newCustomerCount: withColumn(z.number().optional().nullable(), {
    label: '新增客户',
    width: COL_NUMBER,
    type: 'custom',
    order: 80,
  }),
  newContactMethodCount: withColumn(z.number().optional().nullable(), {
    label: '新增联系方式',
    width: COL_NUMBER,
    type: 'custom',
    order: 85,
  }),
  attachments: withColumn(z.array(attachmentSchema).optional().nullable(), {
    label: '附件',
    width: COL_NUMBER,
    type: 'custom', // 页面 overrides（计数）
    order: 90,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 140,
  }),
  status: withColumn(z.string(), {
    label: '记录状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'recordStatus',
    hidden: true,
    order: 150,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '录入时间',
    width: COL_DATE,
    type: 'datetime',
    order: 160,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CreateCrmWorkDailyInput = z.infer<typeof createCrmWorkDailySchema>;
export type UpdateCrmWorkDailyInput = z.infer<typeof updateCrmWorkDailySchema>;
export type QueryCrmWorkDailyInput = z.infer<typeof queryCrmWorkDailySchema>;
export type CrmWorkDailyResponseOutput = z.infer<typeof crmWorkDailyResponseSchema>;
