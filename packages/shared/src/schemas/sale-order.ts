import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATETIME, COL_SERIAL, COL_STATUS } from './column-widths';
import {
  paginationSchema,
  selectionPaginationSchema,
  stringOrStringArray,
  stringOrStringArrayOfUuid,
} from './common';

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCalendarDateOnly(value: string): boolean {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]!;
}

/** SaleOrder 写入统一使用无时区语义的严格日历日。 */
export const saleOrderDateOnlySchema = z.string().refine(isValidCalendarDateOnly, {
  message: '日期必须是有效的 YYYY-MM-DD 日历日期',
});

function requiredSaleOrderDateOnlySchema(requiredMessage: string) {
  return z
    .string({ required_error: requiredMessage })
    .min(1, requiredMessage)
    .pipe(saleOrderDateOnlySchema);
}

function validateSaleOrderDateRange(
  value: { orderBeginDate?: string | null; orderEndDate?: string | null },
  ctx: z.RefinementCtx
): void {
  const { orderBeginDate, orderEndDate } = value;
  if (
    typeof orderBeginDate === 'string' &&
    typeof orderEndDate === 'string' &&
    isValidCalendarDateOnly(orderBeginDate) &&
    isValidCalendarDateOnly(orderEndDate) &&
    orderEndDate < orderBeginDate
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['orderEndDate'],
      message: '合同结束日期不能早于合同开始日期',
    });
  }
}

export const SALE_ORDER_VOID_PROJECT_ACTION = {
  ROLLBACK_TO_OPPORTUNITY: 'rollback_to_opportunity',
} as const;

export const saleOrderVoidRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, '请填写纠错作废原因')
    .max(500, '纠错作废原因不能超过 500 个字符'),
  version: z.number().int().min(1, '无效的数据版本'),
  projectAction: z.literal(SALE_ORDER_VOID_PROJECT_ACTION.ROLLBACK_TO_OPPORTUNITY).optional(),
});

export const saleOrderVoidPreviewSchema = z.object({
  canSubmit: z.boolean(),
  requiresProjectAction: z.boolean(),
  blockers: z.array(z.string()),
  payments: z.object({
    totalCount: z.number().int().nonnegative(),
    approvedCount: z.number().int().nonnegative(),
    removableCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
    approvedInAmount: z.number().nonnegative(),
    approvedOutAmount: z.number().nonnegative(),
  }),
  invoices: z.object({
    totalCount: z.number().int().nonnegative(),
    preservedCount: z.number().int().nonnegative(),
    removableCount: z.number().int().nonnegative(),
    blockingCount: z.number().int().nonnegative(),
  }),
  project: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      canRollback: z.boolean(),
      activeTicketCount: z.number().int().nonnegative(),
      effortRecordCount: z.number().int().nonnegative(),
      otherSaleOrderCount: z.number().int().nonnegative(),
    })
    .nullable(),
  secondaryProjectCount: z.number().int().nonnegative(),
  manualFinanceLedgerCount: z.number().int().nonnegative(),
});

/**
 * 销售订单产品明细创建 Schema（无 id，用于表单提交）
 */
export const createOrderProductSchema = z.object({
  productName: z.string().min(1, '产品名称不能为空').max(200, '产品名称最多200个字符'),
  productNumber: z.string().max(50).optional().nullable(),
  /** @precision Decimal */
  productPrice: z.coerce.number().optional().nullable(),
  /** @precision Decimal */
  quantity: z.coerce.number({ required_error: '数量不能为空' }).positive('数量必须大于0'),
  /** @precision Decimal */
  unitPrice: z.coerce.number({ required_error: '产品单价不能为空' }).positive('产品单价必须大于0'),
  /** @precision Decimal */
  contractUnitPrice: z.coerce
    .number({ required_error: '合同单价不能为空' })
    .positive('合同单价必须大于0'),
  /** @precision Decimal */
  discount: z.coerce.number().min(-999.99).max(100, '折扣不能超过100%').optional().nullable(),
  /** @precision Decimal */
  subtotalAmount: z.coerce.number().positive('小计金额必须大于0').optional().nullable(),
  remark: z.string().optional().nullable(),
});

/** 销售订单创建/更新共享字段；日期区间约束分别在完整与 partial 对象上追加。 */
const saleOrderInputObjectSchema = z.object({
  orderTitle: z.string().optional().nullable(),
  customerId: z.string().min(1, '请选择客户').uuid('客户ID格式不正确'),
  opportunityId: z
    .string({ required_error: '请选择关联商机' })
    .min(1, '请选择关联商机')
    .uuid('商机ID格式不正确'),
  /** @precision Decimal */
  orderAmount: z.coerce
    .number({ required_error: '请输入合同金额', invalid_type_error: '请输入合同金额' })
    .nonnegative('合同金额不能为负'),
  /** 其他相关费用 @precision Decimal */
  otherFee: z.coerce
    .number({ required_error: '请输入其他相关费用', invalid_type_error: '请输入其他相关费用' })
    .nonnegative('其他相关费用不能为负'),
  /** 坏账金额：从未收余额中核销，不能为负 @precision Decimal */
  badDebtAmount: z.coerce
    .number({ invalid_type_error: '请输入坏账金额' })
    .nonnegative('坏账金额不能为负')
    .default(0),
  businessDate: requiredSaleOrderDateOnlySchema('请选择业务日期'),
  paymentDate: saleOrderDateOnlySchema.optional().nullable(),
  orderBeginDate: requiredSaleOrderDateOnlySchema('请选择合同开始日期'),
  orderEndDate: saleOrderDateOnlySchema.optional().nullable(),
  chargerId: z.string({ required_error: '请选择负责人' }).min(1, '请选择负责人'),
  remark: z.string().optional().nullable(),
  /** 产品明细行（必填，至少一项） */
  products: z.array(createOrderProductSchema).min(1, '请至少添加一项产品明细'),
});

/**
 * 销售订单创建 Schema
 */
export const createSaleOrderSchema = saleOrderInputObjectSchema.superRefine(
  validateSaleOrderDateRange
);

/**
 * 销售订单更新 Schema（含 version 用于乐观锁）
 *
 * opportunityId 单独覆盖为 nullable：
 *   - 创建时仍必填（业务上订单必须关联商机）
 *   - 更新时允许置 null，用于数据治理场景：商机被硬删后留下的孤儿外键需要主动断开
 *     （ky-data-query 2026-06-20 治理体检发现 5 条此类孤儿，无法通过界面修复）
 *
 * partial 请求只有同时携带合同起止日期时，schema 才能判定并校验区间。
 */
export const updateSaleOrderSchema = saleOrderInputObjectSchema
  .partial()
  .extend({
    opportunityId: z.string().uuid('商机ID格式不正确').nullable().optional(),
    version: z.number().int().min(1, '请携带乐观锁版本号'),
  })
  .superRefine(validateSaleOrderDateRange);

/**
 * 销售订单查询 Schema
 */
export const querySaleOrderSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  customerId: stringOrStringArrayOfUuid,
  orderStatus: stringOrStringArray,
  chargerId: z.string().optional(),
});

/**
 * 合同订单关联客户简要信息 Schema
 */
export const saleOrderCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 合同订单关联商机简要信息 Schema
 */
export const saleOrderOpportunityInfoSchema = z.object({
  id: z.string(),
  opportunityName: z.string(),
  serialNumber: z.string(),
});

/**
 * 订单产品明细 Schema
 */
export const orderProductInfoSchema = z.object({
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
  contractUnitPrice: z.number().optional().nullable(),
  /** @precision Decimal */
  discount: z.number().optional().nullable(),
  /** @precision Decimal */
  subtotalAmount: z.number().optional().nullable(),
  remark: z.string().optional().nullable(),
});

/**
 * 合同订单响应 Schema（含关联信息）
 *
 * 字段通过 `withColumn(...)` 附加列 UI 元数据；orderStatus 使用未注册的 `orderStatusMap`，
 * 保留 `type: 'custom'` 由页面 overrides 渲染 StatusBadge。
 */
export const saleOrderResponseSchema = z.object({
  id: z.string(),
  serialNumber: withColumn(z.string(), {
    label: '编号',
    width: COL_SERIAL,
    type: 'serialNumber',
    required: true,
    order: 10,
  }),
  orderTitle: withColumn(z.string().optional().nullable(), {
    label: '合同标题',
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
  opportunityId: z.string().optional().nullable(),
  /** @precision Decimal */
  orderAmount: withColumn(z.number().optional().nullable(), {
    label: '合同金额',
    width: COL_AMOUNT,
    sortable: true,
    align: 'right',
    type: 'decimal',
    order: 50,
  }),
  /** 其他相关费用 @precision Decimal */
  otherFee: withColumn(z.number().optional().nullable(), {
    label: '其他相关费用',
    width: COL_AMOUNT,
    sortable: true,
    align: 'right',
    type: 'decimal',
    order: 55,
  }),
  /** @precision Decimal */
  productAmount: withColumn(z.number().optional().nullable(), {
    label: '产品金额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    sortable: true,
    order: 40,
  }),
  /** @precision Decimal */
  totalReceivables: withColumn(z.number().optional().nullable(), {
    label: '应收总额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    sortable: true,
    order: 70,
  }),
  /** @precision Decimal */
  totalReceived: withColumn(z.number().optional().nullable(), {
    label: '已收总额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    sortable: true,
    order: 80,
  }),
  /** 已退款总额：SUM(Payment WHERE direction='OUT' AND legacyAdjustment=false AND flowStatus='approved') @precision Decimal */
  totalRefunded: withColumn(z.number(), {
    label: '已退总额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    hidden: true,
    sortable: true,
    order: 82,
  }),
  /** 坏账金额：核销未收余额，不计入实际回款 @precision Decimal */
  badDebtAmount: withColumn(z.number(), {
    label: '坏账金额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    sortable: true,
    order: 58,
  }),
  /** @precision Decimal */
  totalUncollected: withColumn(z.number().optional().nullable(), {
    label: '未收余额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    sortable: true,
    order: 60,
  }),
  /** @precision Decimal */
  invoicedAmount: withColumn(z.number(), {
    label: '已开票金额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    sortable: true,
    order: 85,
  }),
  orderInvoiceStatus: withColumn(z.string().optional().nullable(), {
    label: '开票状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'orderInvoiceStatus',
    order: 115,
  }),
  orderStatus: withColumn(z.string().optional().nullable(), {
    label: '回款状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'orderStatus',
    order: 110,
  }),
  /** 历史负向订单标识；仅由受控治理写入，不在表单中展示。 */
  legacyAdjustment: z.boolean().default(false),
  businessDate: withColumn(z.string().optional().nullable(), {
    label: '业务日期',
    type: 'date',
    order: 90,
    sortable: true,
  }),
  paymentDate: withColumn(z.string().optional().nullable(), {
    label: '回款时间',
    type: 'date',
    order: 95,
    sortable: true,
  }),
  /** 最近回款日期（派生列，MAX(IN approved Payment.businessDate)，见 payment-summary.helper） */
  lastPaymentDate: withColumn(z.string().optional().nullable(), {
    label: '最近回款日期',
    type: 'date',
    order: 96,
    sortable: true,
  }),
  // orderBeginDate 在表格上是「合同周期」拼接列，sortKey 显式落 orderBeginDate
  // —— 这样 deriveColumnsFromSchema 仍把 orderBeginDate 作为后端排序字段（已在服务端白名单），
  // 与 column.dataIndex 'orderBeginDate' 配对，UI 不会因 type: 'custom' 而无 sortKey。
  orderBeginDate: withColumn(z.string().optional().nullable(), {
    label: '合同周期',
    type: 'custom', // 需拼接 orderBeginDate ~ orderEndDate
    order: 100,
    sortable: true,
    sortKey: 'orderBeginDate',
  }),
  orderEndDate: z.string().optional().nullable(),
  chargerId: z.string().optional().nullable(),
  chargerName: withColumn(z.string().optional().nullable(), {
    label: '负责人',
    type: 'text',
    order: 120,
  }),
  /** 虚拟列：对应 `item.opportunity?.opportunityName`，页面 overrides 渲染穿透按钮 */
  opportunityName: withColumn(z.string().optional().nullable(), {
    label: '关联商机',
    type: 'custom',
    hidden: true,
    order: 130,
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
  flowStatus: withColumn(z.string().optional().nullable(), {
    label: '审批状态',
    width: COL_STATUS,
    type: 'custom', // 页面 overrides 渲染 ApprovalStatusBadge
    order: 117,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 160,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 170,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  customer: saleOrderCustomerInfoSchema.optional(),
  opportunity: saleOrderOpportunityInfoSchema.optional(),
  products: z.array(orderProductInfoSchema).optional(),
});

/**
 * 合同订单选择器查询 Schema（用于下拉框）
 */
export const saleOrderSelectionQuerySchema = selectionPaginationSchema.extend({
  customerId: z.string().optional(),
  opportunityId: z.string().uuid('商机ID格式不正确').optional(),
  status: z.string().optional(),
});

// ============ 批量操作 Schema ============

const saleOrderBatchIdsSchema = z
  .array(z.string().uuid('无效的订单 ID 格式'))
  .min(1, '至少选择一项')
  .max(200, '单次最多操作 200 条');

const saleOrderBatchVersionSchema = z
  .number({
    required_error: '每张订单都必须携带乐观锁版本号',
    invalid_type_error: '订单乐观锁版本号必须是整数',
  })
  .int('订单乐观锁版本号必须是整数')
  .min(1, '订单乐观锁版本号必须大于等于 1');

const saleOrderVersionedBatchShape = {
  ids: saleOrderBatchIdsSchema,
  versions: z.record(z.string().uuid('无效的订单 ID 格式'), saleOrderBatchVersionSchema),
};

function createVersionedSaleOrderBatchSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...saleOrderVersionedBatchShape, ...shape })
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
          message: '批量订单 ID 不得重复',
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
 * chargerId 必填，置空场景不暴露。
 */
export const batchTransferSaleOrderSchema = createVersionedSaleOrderBatchSchema({
  chargerId: z.string().min(1, '请选择新负责人'),
});

/**
 * 批量编辑可改字段白名单：
 * 仅"客观约束之外"的弱字段——金额族/关系族/状态族/派生字段一律禁批改。
 */
export const batchUpdateSaleOrderSchema = createVersionedSaleOrderBatchSchema({
  patch: z
    .object({
      orderTitle: z.string().max(200).optional(),
      orderBeginDate: saleOrderDateOnlySchema.optional(),
      orderEndDate: saleOrderDateOnlySchema.optional(),
      paymentDate: saleOrderDateOnlySchema.optional(),
      businessDate: saleOrderDateOnlySchema.optional(),
      remark: z.string().optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      message: '至少需要修改一个字段',
    })
    .superRefine(validateSaleOrderDateRange),
});

export type BatchTransferSaleOrderInput = z.infer<typeof batchTransferSaleOrderSchema>;
export type BatchUpdateSaleOrderInput = z.infer<typeof batchUpdateSaleOrderSchema>;

export type CreateOrderProductInput = z.infer<typeof createOrderProductSchema>;
export type CreateSaleOrderInput = z.infer<typeof createSaleOrderSchema>;
export type UpdateSaleOrderInput = z.infer<typeof updateSaleOrderSchema>;
export type QuerySaleOrderInput = z.infer<typeof querySaleOrderSchema>;
export type SaleOrderSelectionQueryInput = z.infer<typeof saleOrderSelectionQuerySchema>;
export type SaleOrderCustomerInfoOutput = z.infer<typeof saleOrderCustomerInfoSchema>;
export type SaleOrderOpportunityInfoOutput = z.infer<typeof saleOrderOpportunityInfoSchema>;
export type OrderProductInfoOutput = z.infer<typeof orderProductInfoSchema>;
export type SaleOrderResponseOutput = z.infer<typeof saleOrderResponseSchema>;
export type SaleOrderVoidRequestInput = z.infer<typeof saleOrderVoidRequestSchema>;
export type SaleOrderVoidPreviewOutput = z.infer<typeof saleOrderVoidPreviewSchema>;
