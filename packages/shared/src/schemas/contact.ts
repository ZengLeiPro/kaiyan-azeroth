import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME, COL_STATUS, COL_STATUS_SM } from './column-widths';
import { paginationSchema, selectionPaginationSchema, stringOrStringArrayOfUuid } from './common';

/**
 * 联系人创建 Schema
 */
/**
 * KP 决策角色枚举（2026-06-20 引入，用于联系人 kpRole 字段）
 * - 拍板：最终签字/审批权
 * - 技术守门：技术选型评估、否决权
 * - 财务守门：预算/采购流程把关
 * - 影响人：建议/推荐方但非决策权
 * - 其他：自定义
 */
export const KP_ROLES = ['拍板', '技术守门', '财务守门', '影响人', '其他'] as const;

export const createContactSchema = z.object({
  contactName: z.string().min(1, '联系人姓名不能为空').max(100, '联系人姓名最多100个字符'),
  customerId: z.string().min(1, '请选择客户').uuid('客户ID格式不正确'),
  sex: z.string().optional().nullable(),
  mobile: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  wechat: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  // KP 标记（2026-06-20 治理引入）
  isKp: z.boolean().optional(),
  kpRole: z.enum(KP_ROLES).optional().nullable(),
  remark: z.string().optional().nullable(),
});

/**
 * 联系人更新 Schema（含 version 用于乐观锁）
 */
export const updateContactSchema = createContactSchema.partial().extend({
  version: z.number().int().optional(),
});

/**
 * 联系人查询 Schema
 */
export const queryContactSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  customerId: stringOrStringArrayOfUuid,
  status: z.string().optional(),
  // KP 筛选（2026-06-20）：传 true 只返回标记 KP 的联系人；传 false/不传 = 不过滤
  isKp: z.coerce.boolean().optional(),
});

/**
 * 联系人关联客户简要信息 Schema
 */
export const contactCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 联系人响应 Schema（含关联客户、创建人与修改人信息）
 *
 * 字段通过 `withColumn(...)` 附加列 UI 元数据。sex 已标注 statusBadge/gender 自动渲染。
 */
export const contactResponseSchema = z.object({
  id: z.string(),
  contactName: withColumn(z.string(), {
    label: '联系人',
    sortable: true,
    type: 'custom',
    required: true,
    order: 10,
  }),
  customerId: z.string(),
  /** 虚拟列：对应 `item.customer?.customerName`，原页面直接显示无穿透按钮 */
  customerName: withColumn(z.string().optional().nullable(), {
    label: '所属客户',
    minWidth: 240,
    type: 'custom',
    order: 20,
  }),
  sex: withColumn(z.string().optional().nullable(), {
    label: '性别',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'gender',
    order: 30,
  }),
  mobile: withColumn(z.string().optional().nullable(), {
    label: '手机号',
    type: 'text',
    order: 40,
  }),
  phone: withColumn(z.string().optional().nullable(), {
    label: '电话',
    type: 'text',
    order: 50,
  }),
  email: withColumn(z.string().optional().nullable(), {
    label: '邮箱',
    type: 'text',
    order: 70,
  }),
  wechat: withColumn(z.string().optional().nullable(), {
    label: '微信',
    type: 'text',
    order: 80,
  }),
  position: withColumn(z.string().optional().nullable(), {
    label: '职位',
    type: 'text',
    order: 60,
  }),
  department: withColumn(z.string().optional().nullable(), {
    label: '部门',
    type: 'text',
    order: 100,
  }),
  isKp: withColumn(z.boolean().optional(), {
    label: 'KP',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'isKp',
    order: 65,
  }),
  kpRole: withColumn(z.string().optional().nullable(), {
    label: '决策角色',
    type: 'text',
    width: COL_STATUS,
    order: 66,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 120,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'recordStatus',
    order: 110,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 130,
  }),
  createdBy: withColumn(z.string().optional().nullable(), {
    label: '创建人',
    width: COL_STATUS,
    type: 'text',
    order: 135,
  }),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    order: 140,
  }),
  updatedBy: withColumn(z.string().optional().nullable(), {
    label: '修改人',
    width: COL_STATUS,
    type: 'text',
    order: 150,
  }),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  customer: contactCustomerInfoSchema.optional(),
});

/**
 * 联系人选择器查询 Schema（用于下拉框）
 */
export const contactSelectionQuerySchema = selectionPaginationSchema.extend({
  customerId: z.string().optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type QueryContactInput = z.infer<typeof queryContactSchema>;
export type ContactSelectionQueryInput = z.infer<typeof contactSelectionQuerySchema>;
export type ContactCustomerInfoOutput = z.infer<typeof contactCustomerInfoSchema>;
export type ContactResponseOutput = z.infer<typeof contactResponseSchema>;
