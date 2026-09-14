import { z } from 'zod';

import { OPPORTUNITY_LOSE_REASON_VALUES } from '../constants/status-values';
import { withColumn } from './column-meta';
import {
  COL_AMOUNT,
  COL_DATE,
  COL_DATETIME,
  COL_PERCENT,
  COL_SERIAL,
  COL_STATUS_SM,
} from './column-widths';
import {
  paginationSchema,
  selectionPaginationSchema,
  stringOrStringArray,
  stringOrStringArrayOfUuid,
} from './common';

/**
 * 商机产品明细创建 Schema（无 id，用于表单提交）
 */
export const createOpportunityProductSchema = z.object({
  productName: z.string().min(1, '产品名称不能为空').max(200, '产品名称最多200个字符'),
  productNumber: z.string().max(50).optional().nullable(),
  /** @precision Decimal */
  productPrice: z.coerce.number().optional().nullable(),
  /** @precision Decimal */
  quantity: z.coerce.number({ required_error: '数量不能为空' }).positive('数量必须大于0'),
  /** @precision Decimal */
  unitPrice: z.coerce.number({ required_error: '单价不能为空' }).positive('单价必须大于0'),
  /** @precision Decimal */
  discount: z.coerce.number().min(0).max(100).optional().nullable(),
  /** @precision Decimal */
  subtotalAmount: z.coerce.number().optional().nullable(),
  remark: z.string().optional().nullable(),
});

/**
 * 商机创建 Schema
 *
 * 注：「商机阶段=输单流失 → 失单原因必填」联动校验**不**写在 shared schema 层，
 * 原因：nestjs-zod 的 OpenAPI 元数据反射依赖 ZodObject.shape，外层 .refine() 会包成 ZodEffects 失去 shape。
 * 联动校验由两侧分别做：
 *  - 前端：types.ts 的 opportunityFormSchema 在本 schema 外层加 .refine（即时反馈）
 *  - 后端：opportunities.service.ts 的 assertLostReasonOnLost（基于合并 existing 后的最终态权威兜底）
 */
export const createOpportunitySchema = z.object({
  opportunityName: z.string().max(200, '商机名称最多200个字符').optional().nullable(),
  customerId: z.string().min(1, '请选择客户').uuid('客户ID格式不正确'),
  contactId: z.string().uuid().optional().nullable(),
  opportunityStage: z.string({ required_error: '请选择商机阶段' }).min(1, '请选择商机阶段'),
  /** @precision Decimal */
  opportunityAmount: z.coerce.number({
    required_error: '请输入商机金额',
    invalid_type_error: '请输入商机金额',
  }),
  /** @precision Decimal */
  winRate: z.coerce.number().optional().nullable(),
  expectedDealDate: z.string({ required_error: '请选择预计成交日期' }).min(1, '请选择预计成交日期'),
  realDealDate: z.string().optional().nullable(),
  /** 输单流失日期（前端可手改；为空且 stage=输单流失 时由后端自动填当前时间） */
  lostDate: z.string().optional().nullable(),
  chargerId: z.string({ required_error: '请选择负责人' }).min(1, '请选择负责人'),
  loseReason: z
    .enum(OPPORTUNITY_LOSE_REASON_VALUES, { invalid_type_error: '失单原因取值无效' })
    .optional()
    .nullable(),
  /** 失单原因备注（仅当 loseReason='其他' 时使用，承载自由文本说明） */
  loseReasonDetail: z.string().max(500, '失单原因备注最多500个字符').optional().nullable(),
  remark: z.string().optional().nullable(),
  /** 产品明细行：至少 1 项 */
  products: z.array(createOpportunityProductSchema).min(1, '请至少添加一个产品明细'),
});

/**
 * 商机更新 Schema（含 version 用于乐观锁）
 */
export const updateOpportunitySchema = createOpportunitySchema.partial().extend({
  version: z.number().int().positive(),
});

/**
 * 商机查询 Schema
 */
export const queryOpportunitySchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  customerId: stringOrStringArrayOfUuid,
  opportunityStage: stringOrStringArray,
  chargerId: z.string().optional(),
  /** 是否在列表响应中带回 products（看板视图用） */
  withProducts: z.coerce.boolean().optional(),
});

/**
 * 商机关联客户简要信息 Schema
 */
export const opportunityCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 商机产品明细 Schema
 */
export const opportunityProductInfoSchema = z.object({
  id: z.string(),
  productName: z.string(),
  productNumber: z.string().optional().nullable(),
  /** @precision Decimal */
  productPrice: z.number().optional().nullable(),
  /** @precision Decimal */
  quantity: z.number().optional().nullable(),
  /** @precision Decimal */
  unitPrice: z.number().optional().nullable(),
  /** @precision Decimal */
  discount: z.number().optional().nullable(),
  /** @precision Decimal */
  subtotalAmount: z.number().optional().nullable(),
  remark: z.string().optional().nullable(),
});

/**
 * 商机关联联系人简要信息 Schema
 */
export const opportunityContactInfoSchema = z.object({
  id: z.string(),
  contactName: z.string(),
});

/**
 * 商机响应 Schema（含关联信息）
 *
 * 字段上通过 `withColumn(...)` 附加列 UI 元数据，供前端 `deriveColumnsFromSchema` 派生表格列。
 * opportunityStage 使用未注册的 `opportunityStageMap`，故保持 `type: 'custom'`，
 * 在页面 overrides 里保留 StatusBadge 原写法。
 */
export const opportunityResponseSchema = z.object({
  id: z.string(),
  serialNumber: withColumn(z.string(), {
    label: '编号',
    width: COL_SERIAL,
    type: 'serialNumber',
    required: true,
    order: 10,
  }),
  opportunityName: withColumn(z.string(), {
    label: '商机名称',
    sortable: true,
    type: 'custom',
    required: true,
    order: 20,
  }),
  customerId: z.string(),
  /** 虚拟列：对应 `item.customer?.customerName`，页面 overrides 渲染穿透按钮 */
  customerName: withColumn(z.string().optional().nullable(), {
    label: '客户',
    minWidth: 240,
    type: 'custom',
    order: 30,
  }),
  contactId: z.string().optional().nullable(),
  /** 虚拟列：对应 `item.contact?.contactName`，页面 overrides 渲染穿透按钮 */
  contactName: withColumn(z.string().optional().nullable(), {
    label: '联系人',
    type: 'custom',
    order: 40,
  }),
  opportunityStage: withColumn(z.string().optional().nullable(), {
    label: '阶段',
    width: 110,
    type: 'statusBadge',
    statusMapKey: 'opportunityStage',
    order: 50,
  }),
  /** @precision Decimal */
  opportunityAmount: withColumn(z.number().optional().nullable(), {
    label: '商机金额',
    width: COL_AMOUNT,
    sortable: true,
    align: 'right',
    type: 'decimal',
    order: 60,
  }),
  /** @precision Decimal */
  winRate: withColumn(z.number().optional().nullable(), {
    label: '赢单率',
    width: COL_PERCENT,
    type: 'percent',
    order: 70,
  }),
  expectedDealDate: withColumn(z.string().optional().nullable(), {
    label: '预计成交日期',
    width: COL_DATE,
    type: 'date',
    order: 90,
    sortable: true,
  }),
  realDealDate: withColumn(z.string().optional().nullable(), {
    label: '实际成交日期',
    width: COL_DATE,
    type: 'date',
    order: 100,
    sortable: true,
  }),
  lostDate: withColumn(z.string().optional().nullable(), {
    label: '输单日期',
    width: COL_DATE,
    type: 'date',
    sortable: true,
    order: 105,
  }),
  chargerId: z.string().optional().nullable(),
  chargerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'text',
    order: 80,
  }),
  chargerAvatar: z.string().optional().nullable(),
  loseReason: withColumn(z.string().optional().nullable(), {
    label: '失单原因',
    width: 150,
    type: 'custom', // 需要 truncate + title tooltip + 拼接 loseReasonDetail
    order: 110,
  }),
  loseReasonDetail: z.string().optional().nullable(),
  /** WON 来源 provenance；legacy NULL 按不破坏数据处理。 */
  wonSourceType: z.enum(['manual', 'sale_order']).nullable(),
  wonSourceSaleOrderId: z.string().nullable(),
  wonSourcePreviousStage: z.string().nullable(),
  wonSourcePreviousDealDate: z.string().nullable(),
  wonSourcePreviousWinRate: z.number().nullable(),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 130,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'recordStatus',
    order: 120,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 140,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 150,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  customer: opportunityCustomerInfoSchema.optional(),
  contact: opportunityContactInfoSchema.optional(),
  products: z.array(opportunityProductInfoSchema).optional(),
});

/**
 * 商机选择器查询 Schema（用于下拉框）
 */
export const opportunitySelectionQuerySchema = selectionPaginationSchema.extend({
  customerId: z.string().optional(),
  stage: z.string().optional(),
  availableForSaleOrder: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  currentSaleOrderId: z.string().uuid('订单ID格式不正确').optional(),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type CreateOpportunityProductInput = z.infer<typeof createOpportunityProductSchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
export type QueryOpportunityInput = z.infer<typeof queryOpportunitySchema>;
export type OpportunitySelectionQueryInput = z.infer<typeof opportunitySelectionQuerySchema>;
export type OpportunityCustomerInfoOutput = z.infer<typeof opportunityCustomerInfoSchema>;
export type OpportunityContactInfoOutput = z.infer<typeof opportunityContactInfoSchema>;
export type OpportunityProductInfoOutput = z.infer<typeof opportunityProductInfoSchema>;
export type OpportunityResponseOutput = z.infer<typeof opportunityResponseSchema>;
