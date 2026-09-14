import { z } from 'zod';

import { COUNTRY_NAMES, DEFAULT_COUNTRY } from '../constants/countries';
import {
  HAS_CONTACT_PHONE_VALUES,
  INDUSTRY_VALUES,
  LEAD_PROGRESS_STATUS_VALUES,
  LEAD_STAGE_VALUES,
} from '../constants/status-values';
import { withColumn } from './column-meta';
import {
  COL_AMOUNT,
  COL_DATE,
  COL_DATETIME,
  COL_SERIAL,
  COL_STATUS,
  COL_STATUS_SM,
} from './column-widths';
import { paginationSchema, selectionPaginationSchema, stringOrStringArray } from './common';

/**
 * 客户创建 Schema
 *
 * forceCreate: 软查重旁路。create 默认会按 customerName / shortName / uncId / organizationId
 * 调 checkDuplicates，若命中已存在 active 客户则抛 409。前端弹卡确认后传 true 跳过校验。
 */
// 业务必填但 TS 类型保持 `T | null`：
// schema 通过 `.nullable().refine(v !== null/空白)` 在运行时拒绝空值，
// 兼容编辑历史数据（字段可能为 null）的 form 中间态——用户必须重选才能提交。
const createCustomerBaseSchema = z.object({
  customerName: z.string().min(1, '客户名称不能为空').max(200, '客户名称最多200个字符'),
  shortName: z.string().max(100, '简称最多100个字符').optional().nullable(),
  industry: z
    .enum(INDUSTRY_VALUES, { message: '请选择行业' })
    .nullable()
    .refine((v) => v !== null, { message: '请选择行业' }),
  customerLevel: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择客户等级' }),
  customerSource: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择客户来源' }),
  customerRelationship: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择客户关系' }),
  customerTags: z.array(z.string()).optional().nullable(),
  // 国家：必填，且必须在白名单内（COUNTRIES）
  country: z
    .enum(COUNTRY_NAMES, { message: '请选择国家' })
    .nullable()
    .refine((v): v is string => typeof v === 'string' && v.trim().length > 0, {
      message: '请选择国家',
    }),
  // 省/市/区：基础类型放宽为可空字符串；
  // "中国时必填、其他国家可空" 的联动校验由文末 superRefine 实现
  province: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
  aiInfoSummary: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  uncId: z.string().optional().nullable(),
  headcountRange: z.string().optional().nullable(),
  chargerId: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择负责人' }),
  collaboratorName: z.string().optional().nullable(),
  collaboratorIds: z.array(z.string()).optional().nullable(),
  contactStatus: z.string().optional().nullable(),
  dealStatus: z.string().optional().nullable(),
  // 线索阶段（MQL/SQL）—— 字段级守卫在 service 层：非 ADMIN 通过 PUT 修改这两个字段会被拒，
  // 必须走 POST /customers/:id/lead-stage-change-request 走审批
  leadStage: z.enum(LEAD_STAGE_VALUES).nullable().optional(),
  leadStageQualifiedById: z.string().nullable().optional(),
  leadValidity: z.enum(['VALID', 'INVALID']).optional(),
  leadInvalidReason: z
    .enum(['EMPTY_PHONE', 'CLOSED', 'DUPLICATE', 'NON_TARGET'])
    .optional()
    .nullable(),
  forceCreate: z.boolean().optional(),
  // 仅在「软重复 + forceCreate=true」场景使用：用户填写的强制创建原因，
  // 跳过软查重并成功创建后写入审计日志（operation_logs）。
  forceCreateReason: z.string().max(200, '强制创建原因最多200个字符').optional().nullable(),
});

/**
 * "中国时省/市/区必填，其他国家可空" 的联动校验。
 *
 * 同时复用于 create / update（update 用 partial，未提供 country 时跳过整个检查）。
 */
const addressRequiredWhenChinaSuperRefine = (
  data: {
    country?: string | null;
    province?: string | null;
    city?: string | null;
    district?: string | null;
    leadValidity?: 'VALID' | 'INVALID';
    leadInvalidReason?: string | null;
  },
  ctx: z.RefinementCtx
) => {
  if (data.leadValidity === 'INVALID' && !data.leadInvalidReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['leadInvalidReason'],
      message: '请选择无效原因',
    });
  }
  if (data.country === undefined) return; // partial update 未传国家时跳过
  if (data.country !== DEFAULT_COUNTRY) return; // 仅在 "中国" 时强制省/市/区
  const required = [
    ['province', '省份'],
    ['city', '城市'],
    ['district', '区县'],
  ] as const;
  for (const [field, label] of required) {
    const v = data[field];
    if (typeof v !== 'string' || v.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `请选择${label}`,
      });
    }
  }
};

export const createCustomerSchema = createCustomerBaseSchema.superRefine(
  addressRequiredWhenChinaSuperRefine
);

const customerVersionSchema = z
  .number({
    required_error: '必须携带客户乐观锁版本号',
    invalid_type_error: '客户乐观锁版本号必须是整数',
  })
  .int('客户乐观锁版本号必须是整数')
  .min(1, '客户乐观锁版本号必须大于等于 1');

/**
 * 客户更新 Schema（含必填 version 用于乐观锁）。
 *
 * AI 摘要、协作人名称、联系/成交状态、线索阶段等字段均由专用人工入口、审批或事实
 * 生命周期维护；普通 PUT 使用 strict schema 明确拒绝这些只读/派生字段，不能静默吞掉。
 */
export const updateCustomerSchema = createCustomerBaseSchema
  .partial()
  .omit({
    aiInfoSummary: true,
    collaboratorName: true,
    contactStatus: true,
    dealStatus: true,
    leadStage: true,
    leadStageQualifiedById: true,
    forceCreate: true,
    forceCreateReason: true,
  })
  .extend({ version: customerVersionSchema })
  .strict()
  .superRefine(addressRequiredWhenChinaSuperRefine);

/** 恢复必须携带调用方从回收站响应读取到的精确版本。 */
export const restoreCustomerSchema = z.object({ version: customerVersionSchema }).strict();

/** 永久删除必须携带调用方从回收站响应读取到的精确版本。 */
export const permanentRemoveCustomerSchema = z.object({ version: customerVersionSchema }).strict();

/** 公海认领必须携带调用方读取到的精确版本。 */
export const claimCustomerSchema = z.object({ version: customerVersionSchema }).strict();

/** DELETE query 来自 URL 字符串，coerce 后仍强制正整数。 */
export const removeCustomerQuerySchema = z
  .object({
    version: z.coerce
      .number({ invalid_type_error: '删除客户必须携带有效的 version' })
      .int('删除客户必须携带有效的 version')
      .min(1, '删除客户必须携带有效的 version'),
  })
  .strict();

const hasContactPhoneQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}, z.enum(HAS_CONTACT_PHONE_VALUES).optional());

/**
 * 客户查询 Schema
 */
export const queryCustomerSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  pool: z.enum(['private', 'public', 'leads']).optional(),
  status: stringOrStringArray,
  customerLevel: stringOrStringArray,
  customerSource: stringOrStringArray,
  contactStatus: stringOrStringArray,
  dealStatus: stringOrStringArray,
  leadStage: stringOrStringArray,
  leadProgressStatus: stringOrStringArray,
  intentTemperature: stringOrStringArray,
  leadValidity: stringOrStringArray,
  chargerId: z.string().optional(),
  hasContactPhone: hasContactPhoneQuerySchema,
});

/**
 * 提交线索阶段（MQL/SQL）变更审批 Schema
 *
 * 电销专用：从当前 leadStage（含 null）转到目标 leadStage（MQL/SQL）。
 * - leadStage 必填，且只能是 MQL/SQL（当前阶段不支持取消标签）
 * - leadStageQualifiedById 可选（默认 = currentUser.employeeId；填则代表"外勤反馈+中台代录"场景）
 * - reason 可选备注，将写入 ApprovalChangeRequest.patch.__reason
 * - version 必填，乐观锁，避免并发覆盖
 */
export const submitLeadStageChangeSchema = z.object({
  leadStage: z.enum(LEAD_STAGE_VALUES, { message: '请选择目标线索阶段' }),
  leadStageQualifiedById: z.string().nullable().optional(),
  reason: z.string().max(1000, '备注最多1000个字符').optional().nullable(),
  version: customerVersionSchema,
});

/**
 * Leads 看板人工推进。
 * VISITED/WON 只能由拜访记录/商机赢单事实自动产生，不能人工伪造。
 */
export const correctLeadStageSchema = z.object({
  leadStage: z.enum(LEAD_STAGE_VALUES, { message: '请选择目标线索阶段' }),
  leadStageQualifiedAt: z
    .string()
    .datetime({ offset: true, message: '原始打标时间必须是 ISO 8601 带时区时间' }),
  reason: z.string().trim().min(1, '修正原因不能为空').max(500, '修正原因最多500个字符'),
  version: customerVersionSchema,
});

export const updateLeadProgressSchema = z
  .object({
    status: z.enum(['ACTIVE', 'NO_SHOW', 'PENDING_VISIT', 'LOST']),
    appointmentAt: z
      .string()
      .datetime({ offset: true, message: '预约拜访时间必须是 ISO 8601 带时区时间' })
      .optional()
      .nullable(),
    reason: z.string().trim().max(500, '原因最多500个字符').optional().nullable(),
    version: customerVersionSchema,
  })
  .superRefine((data, ctx) => {
    if (data.status === 'PENDING_VISIT' && !data.appointmentAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['appointmentAt'],
        message: '请填写预约拜访时间',
      });
    }
    if ((data.status === 'NO_SHOW' || data.status === 'LOST') && !data.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: data.status === 'NO_SHOW' ? '请填写毁约原因' : '请填写流失原因',
      });
    }
  });

const duplicateCheckTextSchema = z.string().trim().min(1).max(200).optional().nullable();

export const checkCustomerDuplicateSchema = z
  .object({
    customerName: duplicateCheckTextSchema,
    shortName: z.string().trim().min(1).max(100).optional().nullable(),
    phone: z.string().trim().min(1).max(50).optional().nullable(),
    uncId: z.string().trim().min(1).max(50).optional().nullable(),
    organizationId: z.string().trim().min(1).max(100).optional().nullable(),
    excludeId: z.string().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasCriterion = [
      value.customerName,
      value.shortName,
      value.phone,
      value.uncId,
      value.organizationId,
    ].some((item) => Boolean(item?.trim()));

    if (!hasCriterion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerName'],
        message: '至少填写一个查重条件',
      });
    }
  });

export const customerDuplicateMatchFieldSchema = z.enum([
  'customerName',
  'shortName',
  'contactPhone',
  'uncId',
  'organizationId',
]);

export const customerDuplicateMatchSchema = z.object({
  id: z.string(),
  serialNumber: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
  uncId: z.string().optional().nullable(),
  organizationId: z.string().optional().nullable(),
  chargerId: z.string().optional().nullable(),
  chargerName: z.string().optional().nullable(),
  pool: z.enum(['private', 'public']),
  matchedFields: z.array(customerDuplicateMatchFieldSchema),
  // 当前用户能否穿透打开详情（口径=GET /customers/:id：范围内私海 OR 协作 OR 公海）
  accessible: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const customerDuplicateCheckResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(customerDuplicateMatchSchema),
});

/**
 * 客户关联联系人简要信息 Schema
 */
export const customerContactInfoSchema = z.object({
  id: z.string(),
  contactName: z.string(),
  mobile: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
});

/**
 * 客户响应 Schema（含关联信息）
 *
 * 字段上通过 `withColumn(...)` 附加了列 UI 元数据，供前端 `deriveColumnsFromSchema` 与
 * `deriveExcelColumnsFromSchema` 派生表格列/导出列。页面级业务渲染（穿透按钮、特殊
 * 截断、复合字段如"地区=省+市"）在 CustomersPage 的 `overrides` 中保留。
 */
export const customerResponseSchema = z.object({
  id: z.string(),
  serialNumber: withColumn(z.string(), {
    label: '编号',
    width: COL_SERIAL,
    type: 'serialNumber',
    required: true,
    exportWidth: 15,
    order: 10,
  }),
  customerName: withColumn(z.string(), {
    label: '客户名称',
    minWidth: 240,
    sortable: true,
    type: 'custom',
    required: true,
    exportWidth: 50,
    order: 20,
  }),
  shortName: withColumn(z.string().optional().nullable(), {
    label: '简称',
    type: 'text',
    exportWidth: 15,
    order: 30,
  }),
  industry: withColumn(z.string().optional().nullable(), {
    label: '行业',
    type: 'statusBadge',
    statusMapKey: 'industry',
    exportWidth: 15,
    order: 40,
  }),
  customerLevel: withColumn(z.string().optional().nullable(), {
    label: '客户等级',
    width: COL_STATUS * 2,
    sortable: true,
    type: 'statusBadge',
    statusMapKey: 'customerLevel',
    exportWidth: 24,
    order: 50,
  }),
  customerSource: withColumn(z.string().optional().nullable(), {
    label: '客户来源',
    minWidth: 240,
    type: 'statusBadge',
    statusMapKey: 'customerSource',
    hidden: true,
    exportWidth: 24,
    order: 60,
  }),
  customerRelationship: withColumn(z.string().optional().nullable(), {
    label: '客户关系',
    minWidth: 240,
    type: 'statusBadge',
    statusMapKey: 'customerRelationship',
    hidden: true,
    exportWidth: 24,
    order: 190,
  }),
  customerTags: withColumn(z.array(z.string()).optional().nullable(), {
    label: '客户标签',
    minWidth: 240,
    type: 'tagBadgeList',
    statusMapKey: 'customerTag',
    hidden: true,
    exportWidth: 40,
    exportFormatterKey: 'arrayJoin',
    order: 200,
  }),
  country: withColumn(z.string().optional().nullable(), {
    label: '国家',
    type: 'text',
    hidden: true,
    exportWidth: 10,
    order: 185,
  }),
  province: withColumn(z.string().optional().nullable(), {
    // 页面 overrides 会覆盖 header 为"地区"并 render 拼接 province+city
    label: '省份',
    type: 'custom',
    exportWidth: 10,
    order: 120,
  }),
  city: withColumn(z.string().optional().nullable(), {
    label: '城市',
    type: 'text',
    hidden: true,
    exportWidth: 10,
    order: 125,
  }),
  district: withColumn(z.string().optional().nullable(), {
    label: '区县',
    type: 'text',
    hidden: true,
    exportWidth: 10,
    order: 180,
  }),
  address: withColumn(z.string().optional().nullable(), {
    label: '详细地址',
    type: 'text',
    hidden: true,
    exportWidth: 30,
    order: 170,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    type: 'custom',
    hidden: true,
    exportWidth: 30,
    order: 240,
  }),
  aiInfoSummary: z.string().optional().nullable(),
  aiInfoGeneratedAt: z.string().optional().nullable(),
  organizationId: withColumn(z.string().optional().nullable(), {
    label: '组织ID',
    type: 'text',
    hidden: true,
    exportWidth: 15,
    order: 210,
  }),
  uncId: withColumn(z.string().optional().nullable(), {
    label: '统一信用代码',
    type: 'text',
    hidden: true,
    exportWidth: 22,
    order: 220,
  }),
  headcountRange: withColumn(z.string().optional().nullable(), {
    label: '员工数范围',
    type: 'statusBadge',
    statusMapKey: 'headcountRange',
    hidden: true,
    exportWidth: 12,
    order: 230,
  }),
  chargerId: z.string().optional().nullable(),
  chargerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'text',
    exportWidth: 12,
    order: 130,
  }),
  collaboratorName: withColumn(z.string().optional().nullable(), {
    label: '协作人',
    type: 'text',
    hidden: true,
    exportWidth: 12,
    order: 140,
  }),
  collaboratorIds: z.array(z.string()).optional().nullable(),
  contactStatus: withColumn(z.string().optional().nullable(), {
    label: '跟进状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'contactStatus',
    exportWidth: 12,
    order: 70,
  }),
  dealStatus: withColumn(z.string().optional().nullable(), {
    label: '成交状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'dealStatus',
    exportWidth: 12,
    order: 80,
  }),
  // 线索阶段（MQL/SQL）—— 电销跟踪线索质量
  leadStage: withColumn(z.string().optional().nullable(), {
    label: '线索阶段',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'leadStage',
    exportWidth: 12,
    order: 85,
  }),
  leadStageUpdatedAt: withColumn(z.string().optional().nullable(), {
    label: '线索阶段更新时间',
    type: 'datetime',
    hidden: true,
    exportWidth: 18,
    exportFormatterKey: 'datetime',
    order: 86,
  }),
  leadStageUpdatedById: z.string().optional().nullable(),
  leadStageUpdatedByName: withColumn(z.string().optional().nullable(), {
    label: '线索阶段操作人',
    type: 'text',
    hidden: true,
    exportWidth: 12,
    order: 87,
  }),
  leadStageQualifiedById: z.string().optional().nullable(),
  leadStageQualifiedByName: withColumn(z.string().optional().nullable(), {
    label: '合格判定人',
    type: 'text',
    hidden: true,
    exportWidth: 12,
    order: 88,
  }),
  leadStageQualifiedAt: withColumn(z.string().optional().nullable(), {
    label: '合格判定时间',
    type: 'datetime',
    hidden: true,
    sortable: true,
    exportWidth: 18,
    exportFormatterKey: 'datetime',
    order: 89,
  }),
  // 首次进入 MQL/SQL 时间（write-once，永不覆盖；cohort 漏斗分析用）
  firstMqlAt: withColumn(z.string().optional().nullable(), {
    label: '首次MQL时间',
    type: 'datetime',
    hidden: true,
    sortable: true,
    exportWidth: 18,
    exportFormatterKey: 'datetime',
    order: 89.1,
  }),
  firstSqlAt: withColumn(z.string().optional().nullable(), {
    label: '首次SQL时间',
    type: 'datetime',
    hidden: true,
    sortable: true,
    exportWidth: 18,
    exportFormatterKey: 'datetime',
    order: 89.2,
  }),
  leadProgressStatus: withColumn(z.enum(LEAD_PROGRESS_STATUS_VALUES).optional().nullable(), {
    label: '推进状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'leadProgressStatus',
    exportWidth: 14,
    order: 89.3,
  }),
  leadAppointmentAt: withColumn(z.string().optional().nullable(), {
    label: '预约拜访时间',
    type: 'datetime',
    sortable: true,
    exportWidth: 20,
    exportFormatterKey: 'datetime',
    order: 89.4,
  }),
  leadProgressReason: withColumn(z.string().optional().nullable(), {
    label: '推进原因',
    type: 'text',
    hidden: true,
    exportWidth: 30,
    order: 89.5,
  }),
  leadProgressUpdatedAt: withColumn(z.string().optional().nullable(), {
    label: '推进状态更新时间',
    type: 'datetime',
    hidden: true,
    exportWidth: 20,
    exportFormatterKey: 'datetime',
    order: 89.6,
  }),
  leadProgressUpdatedById: z.string().optional().nullable(),
  intentTemperature: withColumn(
    z.enum(['UNJUDGED', 'HIGH', 'MEDIUM', 'LOW', 'NONE']).optional().nullable(),
    {
      label: '意向温度',
      width: COL_STATUS,
      sortable: true,
      type: 'statusBadge',
      statusMapKey: 'intentTemperature',
      exportFormatterKey: 'intentTemperature',
      order: 81,
    }
  ),
  intentReasons: z.array(z.string()).optional().nullable(),
  nextFollowUpAt: withColumn(z.string().optional().nullable(), {
    label: '下次回访日期',
    width: COL_DATE,
    sortable: true,
    type: 'date',
    order: 82,
  }),
  intentUpdatedAt: z.string().optional().nullable(),
  intentUpdatedById: z.string().optional().nullable(),
  intentUpdatedByName: z.string().optional().nullable(),
  intentSourceKeepRecordId: z.string().optional().nullable(),
  leadValidity: withColumn(z.enum(['VALID', 'INVALID']).optional().nullable(), {
    label: '线索有效性',
    width: COL_STATUS,
    sortable: true,
    type: 'statusBadge',
    statusMapKey: 'leadValidity',
    exportFormatterKey: 'leadValidity',
    order: 83,
  }),
  leadInvalidReason: z.string().optional().nullable(),
  lastKeepRecordTime: withColumn(z.string().optional().nullable(), {
    label: '最近跟进',
    type: 'datetime',
    sortable: true,
    exportWidth: 18,
    exportFormatterKey: 'datetime',
    order: 90,
  }),
  lastKeepRecordContent: withColumn(z.string().optional().nullable(), {
    label: '最后跟进内容',
    type: 'custom',
    hidden: true,
    order: 100,
  }),
  /** @precision Decimal */
  accountsReceivable: withColumn(z.number().optional().nullable(), {
    label: '应收账款',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    hidden: true,
    sortable: true,
    exportWidth: 15,
    exportFormatterKey: 'decimal2',
    order: 160,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'recordStatus',
    order: 280,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    exportWidth: 18,
    exportFormatterKey: 'datetime',
    order: 260,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 270,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: customerVersionSchema,
  contacts: z.array(customerContactInfoSchema).optional(),
});

/**
 * 客户选择器查询 Schema（用于下拉框）
 */
export const customerSelectionQuerySchema = selectionPaginationSchema.extend({
  status: z.string().optional(),
  customerLevel: z.string().optional(),
});

/**
 * 客户批量操作 Schema 系列
 *
 * 五个 batch 接口共用 ids 校验：UUID 数组、至少一项。
 * 无上限——业务上允许全选删/全选转交，由权限层 chargerScope 兜底（越权 id 静默跳过）。
 */
const customerBatchIdsSchema = z
  .array(z.string().uuid('无效的客户 ID 格式'))
  .min(1, '至少选择一项');

const customerVersionedBatchShape = {
  ids: customerBatchIdsSchema,
  versions: z.record(z.string().uuid('无效的客户 ID 格式'), customerVersionSchema),
};

function createVersionedCustomerBatchSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...customerVersionedBatchShape, ...shape })
    .strict()
    .superRefine((selection, ctx) => {
      const { ids, versions } = selection as {
        ids: string[];
        versions: Record<string, number>;
      };
      const idSet = new Set(ids);
      if (idSet.size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ids'],
          message: '批量客户 ID 不得重复',
        });
      }

      const versionIds = Object.keys(versions);
      const missingIds = [...idSet].filter((id) => !(id in versions));
      const extraIds = versionIds.filter((id) => !idSet.has(id));
      if (missingIds.length > 0 || extraIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['versions'],
          message: 'versions 必须与 ids 一一对应，不得缺漏或包含额外 ID',
        });
      }
    });
}

/**
 * 批量转交：换负责人
 * chargerId 必填——批量转交场景不允许置空（要置空走「批量编辑」改 chargerId? 不暴露此能力）
 */
export const batchTransferCustomerSchema = createVersionedCustomerBatchSchema({
  chargerId: z.string().min(1, '请选择新负责人'),
});

/**
 * 批量编辑可改字段白名单（2026-05-18 决策）：
 * 仅 SABC(customerLevel) + industry + customerSource + customerRelationship 四个标签类字段。
 * 唯一字段（customerName/uncId/organizationId 等）不可批量改。
 * 至少传一个字段；空值/undefined 表示不改该字段。
 */
export const batchUpdateCustomerSchema = createVersionedCustomerBatchSchema({
  patch: z
    .object({
      customerLevel: z.string().min(1).optional(),
      industry: z.enum(INDUSTRY_VALUES).optional(),
      customerSource: z.string().min(1).optional(),
      customerRelationship: z.string().min(1).optional(),
    })
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      message: '至少需要修改一个字段',
    }),
});

/**
 * 批量加/移协作人：collaboratorIds 是要 merge/diff 进 customer.collaboratorIds 的员工 id 列表
 */
export const batchCollaboratorsCustomerSchema = createVersionedCustomerBatchSchema({
  collaboratorIds: z.array(z.string().min(1)).min(1, '请选择至少一位协作人'),
});

/** 批量软删：每个目标都必须携带调用方读取到的精确版本。 */
export const batchRemoveCustomerSchema = createVersionedCustomerBatchSchema({});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type UpdateLeadProgressInput = z.infer<typeof updateLeadProgressSchema>;
export type CorrectLeadStageInput = z.infer<typeof correctLeadStageSchema>;
export type QueryCustomerInput = z.infer<typeof queryCustomerSchema>;
export type CheckCustomerDuplicateInput = z.infer<typeof checkCustomerDuplicateSchema>;
export type CustomerDuplicateMatchFieldOutput = z.infer<typeof customerDuplicateMatchFieldSchema>;
export type CustomerDuplicateMatchOutput = z.infer<typeof customerDuplicateMatchSchema>;
export type CustomerDuplicateCheckResponseOutput = z.infer<
  typeof customerDuplicateCheckResponseSchema
>;
export type CustomerSelectionQueryInput = z.infer<typeof customerSelectionQuerySchema>;
export type CustomerContactInfoOutput = z.infer<typeof customerContactInfoSchema>;
export type CustomerResponseOutput = z.infer<typeof customerResponseSchema>;
export type RestoreCustomerInput = z.infer<typeof restoreCustomerSchema>;
export type PermanentRemoveCustomerInput = z.infer<typeof permanentRemoveCustomerSchema>;
export type ClaimCustomerInput = z.infer<typeof claimCustomerSchema>;
export type RemoveCustomerQueryInput = z.infer<typeof removeCustomerQuerySchema>;
export type BatchTransferCustomerInput = z.infer<typeof batchTransferCustomerSchema>;
export type BatchUpdateCustomerInput = z.infer<typeof batchUpdateCustomerSchema>;
export type BatchCollaboratorsCustomerInput = z.infer<typeof batchCollaboratorsCustomerSchema>;
export type BatchRemoveCustomerInput = z.infer<typeof batchRemoveCustomerSchema>;
export type SubmitLeadStageChangeInput = z.infer<typeof submitLeadStageChangeSchema>;
