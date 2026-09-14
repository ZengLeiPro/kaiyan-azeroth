import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME, COL_NUMBER, COL_STATUS } from './column-widths';
import { attachmentSchema, paginationSchema, stringOrStringArray } from './common';

/**
 * 拜访记录创建 Schema
 */
export const createVisitRecordSchema = z.object({
  customerId: z.string().min(1, '请选择客户').uuid('客户ID格式不正确'),
  contactId: z
    .string({ required_error: '请选择联系人' })
    .min(1, '请选择联系人')
    .uuid('联系人ID格式不正确'),
  visitType: z.string({ required_error: '请选择拜访类型' }).min(1, '请选择拜访类型'),
  content: z.string({ required_error: '请输入拜访内容' }).min(1, '请输入拜访内容'),
  // 契约：必须为 ISO 8601 带时区（Z 或 ±HH:MM）。
  // 前端 datetime-local 控件统一走 localInputToIso 转 ISO UTC；
  // CLI/外部脚本也必须传带时区的字符串。后端 parseClientDateTime 仍作兜底。
  signInTime: z
    .string({ required_error: '请选择签到时间' })
    .datetime({ offset: true, message: 'signInTime 必须是 ISO 8601 带时区时间' }),
  signOutTime: z
    .string()
    .datetime({ offset: true, message: 'signOutTime 必须是 ISO 8601 带时区时间' })
    .optional()
    .nullable(),
  signAddress: z.string({ required_error: '请选择签到地址' }).min(1, '请选择签到地址'),
  // GCJ-02 坐标 "lng,lat"，用于服务端权威反解、地图跳转与未来距离分析。
  // 前端反解只负责即时预览；服务端发现 signAddress 仍为坐标文本时会再次反解，
  // 仍失败则拒绝入库，避免生产记录只显示经纬度。
  signLocation: z.string().max(50).optional().nullable(),
  duration: z.coerce.number().int().optional().nullable(),
  visitStatus: z.string().optional().nullable(),
  attachments: z.array(attachmentSchema).min(1, '请至少上传一个附件'),
  chargerId: z.string({ required_error: '请选择负责人' }).min(1, '请选择负责人'),
});

/**
 * 拜访记录更新 Schema（含 version 用于乐观锁）
 */
export const updateVisitRecordSchema = createVisitRecordSchema.partial().extend({
  version: z
    .number({
      required_error: '请携带乐观锁版本号',
      invalid_type_error: '乐观锁版本号必须是整数',
    })
    .int('乐观锁版本号必须是整数')
    .min(1, '乐观锁版本号必须大于等于 1'),
});

/**
 * 拜访记录查询 Schema
 */
export const queryVisitRecordSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  customerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  visitType: stringOrStringArray,
});

/**
 * 拜访签到关联客户简要信息 Schema
 */
export const visitRecordCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 拜访签到关联联系人简要信息 Schema
 */
export const visitRecordContactInfoSchema = z.object({
  id: z.string(),
  contactName: z.string(),
});

/**
 * 拜访签到响应 Schema
 *
 * 列 UI 元数据通过 `withColumn(...)` 附着。customer/contact 的显示在页面 Profile
 * 层扁平化为 customerName/contactName 虚拟列，由页面 overrides 以 `mode:'before'` 插入。
 */
export const visitRecordResponseSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  contactId: z.string().optional().nullable(),
  visitType: withColumn(z.string().optional().nullable(), {
    label: '拜访类型',
    type: 'statusBadge',
    statusMapKey: 'visitType',
    order: 30,
  }),
  content: withColumn(z.string().optional().nullable(), {
    label: '拜访内容',
    type: 'custom', // 页面 overrides（line-clamp + 50 字截断）
    order: 110,
  }),
  signInTime: withColumn(z.string().optional().nullable(), {
    label: '签到时间',
    sortable: true,
    type: 'datetime',
    order: 40,
  }),
  signOutTime: withColumn(z.string().optional().nullable(), {
    label: '签退时间',
    width: COL_DATETIME,
    type: 'datetime',
    order: 90,
  }),
  signAddress: withColumn(z.string().optional().nullable(), {
    label: '签到地址',
    // custom：页面 overrides 渲染为高德地图跳转链接（有 signLocation 时可点）
    type: 'custom',
    order: 50,
  }),
  // GCJ-02 坐标 "lng,lat"，用于服务端反解与地图跳转，不出现在表格列
  signLocation: z.string().optional().nullable(),
  duration: withColumn(z.number().optional().nullable(), {
    label: '时长(分钟)',
    width: COL_NUMBER,
    type: 'text',
    order: 60,
  }),
  visitStatus: withColumn(z.string().optional().nullable(), {
    label: '状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'visitStatus',
    order: 70,
  }),
  attachments: withColumn(z.array(attachmentSchema).optional().nullable(), {
    label: '附件',
    type: 'custom', // 页面 overrides（计数）
    order: 100,
  }),
  chargerId: z.string().optional().nullable(),
  chargerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'text',
    order: 80,
  }),
  flowStatus: z.string().optional().nullable(),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 120,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    sortable: true,
    order: 130,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  customer: visitRecordCustomerInfoSchema.optional(),
  contact: visitRecordContactInfoSchema.optional(),
});

export type CreateVisitRecordInput = z.infer<typeof createVisitRecordSchema>;
export type UpdateVisitRecordInput = z.infer<typeof updateVisitRecordSchema>;
export type QueryVisitRecordInput = z.infer<typeof queryVisitRecordSchema>;
export type VisitRecordCustomerInfoOutput = z.infer<typeof visitRecordCustomerInfoSchema>;
export type VisitRecordContactInfoOutput = z.infer<typeof visitRecordContactInfoSchema>;
export type VisitRecordResponseOutput = z.infer<typeof visitRecordResponseSchema>;
