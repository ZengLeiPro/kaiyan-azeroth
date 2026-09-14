import { z } from 'zod';

import {
  PAYMENT_DIRECTION,
  PAYMENT_MODE_VALUES_SALES,
  PAYMENT_REFUND_TYPE_VALUES,
} from '../constants/status-values';
import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATE, COL_DATETIME, COL_SERIAL, COL_STATUS } from './column-widths';
import { paginationSchema, stringOrStringArray, stringOrStringArrayOfUuid } from './common';

export function hasAtMostTwoDecimalPlaces(value: number): boolean {
  return Number.isFinite(value) && Number(value.toFixed(2)) === value;
}

function amountToCents(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || !hasAtMostTwoDecimalPlaces(amount)) return null;
  return Math.round(amount * 100);
}

export function isPaymentItemAmountTotalValid(
  paymentAmount: unknown,
  items: ReadonlyArray<{ amount: unknown }>
): boolean {
  const amountCents = amountToCents(paymentAmount);
  if (amountCents === null || items.length === 0) return false;
  const itemCents = items.map((item) => amountToCents(item.amount));
  if (itemCents.some((value) => value === null)) return false;
  return itemCents.reduce<number>((sum, value) => sum + (value ?? 0), 0) === amountCents;
}

/**
 * PaymentItem 录入 Schema（v2.2，销售下单时随 payment 一起创建）
 *
 * 校验：
 * - saleOrderProductId 必填（NOT NULL，schema 强约束）
 * - amount > 0
 * - paymentMode 销售只能选 direct / dingtalk_collect / pass_through（pass_through_cost
 *   是 admin 调账专用，前端表单不展示）
 * - financeSubjectId 可选，未传时由后端从 OrderProduct.financeSubjectId 继承
 */
export const createPaymentItemInputSchema = z.object({
  saleOrderProductId: z.string().uuid('订单产品 ID 格式不正确'),
  /** @precision Decimal */
  amount: z.coerce
    .number({ required_error: '金额不能为空' })
    .finite('金额必须是有限数字')
    .positive('金额必须大于 0')
    .refine(hasAtMostTwoDecimalPlaces, '金额最多保留两位小数'),
  paymentMode: z.enum(PAYMENT_MODE_VALUES_SALES, {
    required_error: '请选择收款模式',
    invalid_type_error: '收款模式仅支持 direct / dingtalk_collect / pass_through',
  }),
  financeSubjectId: z.string().uuid('财务科目 ID 格式不正确').optional().nullable(),
  productName: z.string().max(200, '产品名最多 200 字').optional().nullable(),
  remark: z.string().optional().nullable(),
});
export type CreatePaymentItemInput = z.infer<typeof createPaymentItemInputSchema>;

/**
 * 回款创建 Schema（IN 方向）
 *
 * 不强制 direction 字段——默认 IN。退款（OUT）走独立的 createPaymentRefundSchema。
 */
export const paymentInputFieldsSchema = z.object({
  saleOrderId: z.string().uuid('销售订单ID格式不正确'),
  /**
   * 兼容旧前端/外部调用。后端以 saleOrder.customerId 为准，禁止跨客户挂账。
   */
  customerId: z.string().uuid('客户ID格式不正确').optional().nullable(),
  /**
   * 业务摘要。IN 方向选「首期款/进度款/尾款/质保金返还/年费续费/月度服务费/培训费/硬件款/一次性买断/其他」，
   * OUT 方向走 createPaymentRefundSchema（refundType 已强约束）。
   * 作为 getEntityDisplayName('payment', e, …) 的派生主源。
   */
  subject: z
    .string({ required_error: '请填写或选择业务摘要' })
    .trim()
    .min(1, '业务摘要不能为空')
    .max(100, '业务摘要最多 100 字'),
  /** @precision Decimal */
  paymentAmount: z.coerce
    .number({ required_error: '回款金额不能为空' })
    .finite('回款金额必须是有限数字')
    .positive('回款金额必须大于 0')
    .refine(hasAtMostTwoDecimalPlaces, '回款金额最多保留两位小数'),
  paymentType: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择付款方式' }),
  businessDate: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择业务日期' }),
  bankName: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择收款账户' }),
  tradeSerialNumber: z.string().optional().nullable(),
  chargerId: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择负责人' }),
  remark: z.string().optional().nullable(),
  /**
   * 方向。前端 IN 表单可省略，默认 IN；后端 OUT 入口会显式置 OUT。
   * 此 schema 仅承载 IN，OUT 应用 createPaymentRefundSchema 以获得更严格校验。
   */
  direction: z.literal(PAYMENT_DIRECTION.IN).optional(),
  /**
   * PaymentItem 子项数组（v2.2）
   *
   * 销售下单时把回款金额按产品拆成 N 行（每行 → 一个 OrderProduct × amount × 模式 × 科目）。
   * 后端校验 Σ items.amount === paymentAmount（误差 < 0.01）；
   * 校验通过后单事务创建所有 PaymentItem 并刷新 OrderProduct.totalReceivedAmount 反向缓存。
   *
   * 新建 IN 回款必须至少拆分一行；头表金额只作为拆分合计，禁止产生没有
   * PaymentItem 的新头表。更新 schema 通过 partial 允许弱字段更新时不重复提交 items，
   * 但一旦提交 items 就必须是非空完整替换快照。
   */
  items: z.array(createPaymentItemInputSchema).min(1, '回款必须至少拆分一条产品明细'),
});

function refinePaymentItemAmountTotal(
  value: { paymentAmount: unknown; items: ReadonlyArray<{ amount: unknown }> },
  ctx: z.RefinementCtx
): void {
  if (!isPaymentItemAmountTotalValid(value.paymentAmount, value.items)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['items'],
      message: '产品明细金额合计必须与回款金额精确一致',
    });
  }
}

/** 新建 IN 回款：拆分行非空且合计必须与头金额一致。 */
export const createPaymentSchema = paymentInputFieldsSchema.superRefine(
  refinePaymentItemAmountTotal
);

/**
 * 退款创建 Schema（OUT 方向专用）
 *
 * 与 createPaymentSchema 的差异：
 * - refundType: 必填，必须命中 PAYMENT_REFUND_TYPE 枚举
 * - relatedPaymentId: 必填（关联原 IN 回款，跨订单由后端拒绝）
 * - relatedInvoiceId: 可选（已开票退款场景同步引用红字发票）
 * - refundReason: 可选自由文本
 * - direction: 固定 OUT
 */
export const createPaymentRefundSchema = z.object({
  saleOrderId: z.string().uuid('销售订单ID格式不正确'),
  customerId: z.string().uuid('客户ID格式不正确').optional().nullable(),
  /**
   * 业务摘要。OUT 方向典型值：「客户退款/多收退还/质保金退还/违约金退还/其他」。
   * 若未显式提供，后端用 refundType 兜底（保持与 P0 阶段 getEntityDisplayName 退化逻辑一致）。
   */
  subject: z.string().trim().min(1, '业务摘要不能为空').max(100, '业务摘要最多 100 字').optional(),
  /** @precision Decimal */
  paymentAmount: z.coerce
    .number({ required_error: '退款金额不能为空' })
    .finite('退款金额必须是有限数字')
    .positive('退款金额必须大于 0')
    .refine(hasAtMostTwoDecimalPlaces, '退款金额最多保留两位小数'),
  paymentType: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择付款方式' }),
  businessDate: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择业务日期' }),
  bankName: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择付款账户' }),
  tradeSerialNumber: z.string().optional().nullable(),
  chargerId: z
    .string()
    .nullable()
    .refine((v) => typeof v === 'string' && v.trim().length > 0, { message: '请选择负责人' }),
  remark: z.string().optional().nullable(),
  refundType: z.enum(PAYMENT_REFUND_TYPE_VALUES, {
    required_error: '请选择退款类型',
    invalid_type_error: '请选择退款类型',
  }),
  refundReason: z.string().max(1000, '退款原因最多 1000 字').optional().nullable(),
  relatedPaymentId: z.string().uuid('请选择关联的原回款'),
  relatedInvoiceId: z.string().uuid('红字发票 ID 格式不正确').optional().nullable(),
});

/**
 * 回款更新 Schema（含 version 用于乐观锁）
 *
 * 后端会显式拒绝 direction / refundType / relatedPaymentId / relatedInvoiceId 等不可逆字段的修改。
 */
export const updatePaymentSchema = paymentInputFieldsSchema
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
  .superRefine((value, ctx) => {
    // 纯弱字段更新不要求 items；同时提交头金额与完整 replacement 时才做交叉校验。
    if (value.paymentAmount !== undefined && value.items !== undefined) {
      refinePaymentItemAmountTotal({ paymentAmount: value.paymentAmount, items: value.items }, ctx);
    }
  });

/**
 * 回款查询 Schema
 */
export const queryPaymentSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  saleOrderId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  paymentType: stringOrStringArray,
  /** 资金流方向多选过滤：IN/OUT */
  direction: stringOrStringArray,
  /** 退款类型多选过滤 */
  refundType: stringOrStringArray,
  /** 关联原回款 ID 过滤（用于"查看某笔回款的所有退款"） */
  relatedPaymentId: stringOrStringArrayOfUuid,
  /** 审批状态多选过滤：draft / pending / approved / rejected */
  flowStatus: stringOrStringArray,
});

/**
 * 回款关联客户简要信息 Schema
 */
export const paymentCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 回款关联销售订单简要信息 Schema
 */
export const paymentSaleOrderInfoSchema = z.object({
  id: z.string(),
  orderTitle: z.string().optional().nullable(),
  serialNumber: z.string(),
});

/**
 * 关联的原回款简要信息 Schema
 */
export const paymentRelatedPaymentInfoSchema = z.object({
  id: z.string(),
  serialNumber: z.string(),
  paymentAmount: z.number(),
  businessDate: z.string().optional().nullable(),
});

/**
 * 关联的红字发票简要信息 Schema
 */
export const paymentRelatedInvoiceInfoSchema = z.object({
  id: z.string(),
  serialNumber: z.string(),
  invoiceAmount: z.number(),
  invoiceStatus: z.string().optional().nullable(),
});

/** 回款拆分明细响应；详情与列表均返回当前未软删行，供既有编辑入口完整回显。 */
export const paymentItemResponseSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  saleOrderProductId: z.string(),
  itemSeq: z.number().int().positive(),
  productName: z.string(),
  /** @precision Decimal */
  amount: z.number(),
  financeSubjectId: z.string().optional().nullable(),
  paymentMode: z.string(),
  remark: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  creatorEmployeeId: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updaterEmployeeId: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int().positive(),
});

/**
 * 回款响应 Schema
 */
export const paymentResponseSchema = z.object({
  id: z.string(),
  serialNumber: withColumn(z.string(), {
    label: '编号',
    width: COL_SERIAL,
    sortable: true,
    type: 'custom',
    required: true,
    order: 10,
  }),
  subject: withColumn(z.string(), {
    label: '业务摘要',
    type: 'text',
    order: 15,
  }),
  saleOrderId: z.string(),
  /** 虚拟列：对应 `item.saleOrder?.serialNumber`，页面 overrides 渲染穿透按钮 */
  orderSerialNumber: withColumn(z.string().optional().nullable(), {
    label: '关联合同',
    type: 'custom',
    order: 30,
  }),
  customerId: z.string(),
  /** 虚拟列：对应 `item.customer?.customerName`，页面 overrides 渲染穿透按钮 */
  customerName: withColumn(z.string().optional().nullable(), {
    label: '客户',
    minWidth: 240,
    type: 'custom',
    order: 20,
  }),
  /** @precision Decimal */
  paymentAmount: withColumn(z.number(), {
    label: '回款金额',
    width: COL_AMOUNT,
    sortable: true,
    align: 'right',
    type: 'custom',
    order: 40,
  }),
  /** 资金流方向 */
  direction: withColumn(z.string(), {
    label: '方向',
    type: 'custom',
    order: 35,
  }),
  legacyAdjustment: z.boolean(),
  refundType: withColumn(z.string().optional().nullable(), {
    label: '退款类型',
    type: 'statusBadge',
    statusMapKey: 'refundType',
    hidden: true,
    order: 55,
  }),
  refundReason: withColumn(z.string().optional().nullable(), {
    label: '退款原因',
    type: 'text',
    hidden: true,
    order: 56,
  }),
  relatedPaymentId: z.string().optional().nullable(),
  relatedInvoiceId: z.string().optional().nullable(),
  invoicedByInvoiceId: withColumn(z.string().optional().nullable(), {
    label: '已合并开票',
    type: 'custom', // 页面 overrides 渲染绿勾 + tooltip
    order: 105,
    hidden: true,
  }),
  paymentType: withColumn(z.string().optional().nullable(), {
    label: '付款方式',
    type: 'statusBadge',
    statusMapKey: 'paymentType',
    order: 50,
  }),
  businessDate: withColumn(z.string().optional().nullable(), {
    label: '业务日期',
    width: COL_DATE,
    type: 'date',
    order: 90,
    sortable: true,
  }),
  bankName: withColumn(z.string().optional().nullable(), {
    label: '收款账户',
    type: 'text',
    order: 70,
  }),
  tradeSerialNumber: withColumn(z.string().optional().nullable(), {
    label: '交易流水号',
    type: 'text',
    order: 80,
  }),
  chargerId: z.string().optional().nullable(),
  chargerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'text',
    order: 100,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    type: 'custom',
    hidden: true,
    order: 120,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'paymentStatus',
    order: 110,
  }),
  flowStatus: withColumn(z.string().optional().nullable(), {
    label: '审批状态',
    width: COL_STATUS,
    type: 'custom',
    order: 115,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 130,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    sortable: true,
    order: 140,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  customer: paymentCustomerInfoSchema.optional(),
  saleOrder: paymentSaleOrderInfoSchema.optional(),
  relatedPayment: paymentRelatedPaymentInfoSchema.optional(),
  relatedInvoice: paymentRelatedInvoiceInfoSchema.optional(),
  /** 当前未软删 PaymentItem，按 itemSeq/id 稳定排序。 */
  items: z.array(paymentItemResponseSchema),
  /** 已退总额（仅 IN 行）@precision Decimal */
  refundedAmount: z.number().optional().nullable(),
  /** 剩余可退余额（仅 IN 行）@precision Decimal */
  refundableAmount: z.number().optional().nullable(),
});

// ============ 批量操作 Schema ============

const paymentBatchIdsSchema = z
  .array(z.string().uuid('无效的回款 ID 格式'))
  .min(1, '至少选择一项')
  .max(200, '单次最多操作 200 条');

const paymentBatchVersionSchema = z
  .number({
    required_error: '每条回款都必须携带乐观锁版本号',
    invalid_type_error: '回款乐观锁版本号必须是整数',
  })
  .int('回款乐观锁版本号必须是整数')
  .min(1, '回款乐观锁版本号必须大于等于 1');

const paymentVersionedBatchShape = {
  ids: paymentBatchIdsSchema,
  versions: z.record(z.string().uuid('无效的回款 ID 格式'), paymentBatchVersionSchema),
};

function createVersionedPaymentBatchSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...paymentVersionedBatchShape, ...shape })
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
          message: '批量回款 ID 不得重复',
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
 * 批量转交：换负责人（仅具备对应管理权限）。
 */
export const batchTransferPaymentSchema = createVersionedPaymentBatchSchema({
  chargerId: z.string().min(1, '请选择新负责人'),
});

/**
 * 批量编辑可改字段白名单：弱字段。
 * 金额/方向/审批/退款族/订单/客户禁批改。
 */
export const batchUpdatePaymentSchema = createVersionedPaymentBatchSchema({
  patch: z
    .object({
      paymentType: z.string().max(50).optional(),
      businessDate: z.string().optional(),
      payer: z.string().max(100).optional(),
      bankName: z.string().max(100).optional(),
      tradeSerialNumber: z.string().max(100).optional(),
      remark: z.string().optional(),
    })
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      message: '至少需要修改一个字段',
    }),
});

/** 批量软删：每个待删回款都必须携带客户端读取到的精确 version。 */
export const batchRemovePaymentSchema = createVersionedPaymentBatchSchema({});

/**
 * 合并开票 Schema（v1）：
 * paymentIds 严校验同 customerId + 同 saleOrderId + 全 IN + 已审批 + 未合并过；
 * invoice 子对象除 invoiceAmount/customerId/saleOrderId（由 service 从回款汇总+推导）外的全部发票字段。
 */
export const mergeInvoiceSchema = z.object({
  paymentIds: z
    .array(z.string().uuid('无效的回款 ID 格式'))
    .min(2, '合并开票至少需要 2 条回款')
    .max(50, '单次最多合并 50 条回款'),
  invoice: z.object({
    subject: z
      .string({ required_error: '请填写或选择开票业务摘要' })
      .trim()
      .min(1, '开票业务摘要不能为空')
      .max(100, '开票业务摘要最多 100 字'),
    invoiceType: z.string({ required_error: '请选择发票类型' }).min(1, '请选择发票类型'),
    invoiceDate: z.string({ required_error: '请选择开票日期' }).min(1, '请选择开票日期'),
    invoiceNumber: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    taxIdentifyNum: z.string().optional().nullable(),
    invoiceStatus: z.string().optional().nullable(),
    itemType: z.string().optional().nullable(),
    bankName: z.string().optional().nullable(),
    bankAccount: z.string().optional().nullable(),
    registeredAddress: z.string().optional().nullable(),
    registeredPhone: z.string().optional().nullable(),
    remark: z.string().optional().nullable(),
  }),
});

export type BatchTransferPaymentInput = z.infer<typeof batchTransferPaymentSchema>;
export type BatchUpdatePaymentInput = z.infer<typeof batchUpdatePaymentSchema>;
export type BatchRemovePaymentInput = z.infer<typeof batchRemovePaymentSchema>;
export type MergeInvoiceInput = z.infer<typeof mergeInvoiceSchema>;

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreatePaymentRefundInput = z.infer<typeof createPaymentRefundSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type QueryPaymentInput = z.infer<typeof queryPaymentSchema>;
export type PaymentCustomerInfoOutput = z.infer<typeof paymentCustomerInfoSchema>;
export type PaymentSaleOrderInfoOutput = z.infer<typeof paymentSaleOrderInfoSchema>;
export type PaymentRelatedPaymentInfoOutput = z.infer<typeof paymentRelatedPaymentInfoSchema>;
export type PaymentRelatedInvoiceInfoOutput = z.infer<typeof paymentRelatedInvoiceInfoSchema>;
export type PaymentItemResponseOutput = z.infer<typeof paymentItemResponseSchema>;
export type PaymentResponseOutput = z.infer<typeof paymentResponseSchema>;
