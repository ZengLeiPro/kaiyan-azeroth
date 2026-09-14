import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATE, COL_DATETIME, COL_SERIAL, COL_STATUS } from './column-widths';
import { paginationSchema, stringOrStringArray } from './common';

/**
 * 发票创建 Schema
 */
export const createInvoiceSchema = z.object({
  saleOrderId: z.string().uuid('销售订单ID格式不正确'),
  /**
   * 兼容旧前端/外部调用。后端以 saleOrder.customerId 为准，禁止跨客户开票。
   */
  customerId: z.string().uuid('客户ID格式不正确').optional().nullable(),
  /**
   * 开票业务摘要。典型值：「软件开发服务费/技术服务费/钉钉软件费/钉钉硬件款/培训费/咨询服务费/年度授权费/维护服务费/其他」。
   * 注意区分 `title` 字段——那是"发票抬头"（客户公司名），不是开票主题。
   * 作为 getEntityDisplayName('invoice', e, …) 的派生主源。
   */
  subject: z
    .string({ required_error: '请填写或选择开票业务摘要' })
    .trim()
    .min(1, '开票业务摘要不能为空')
    .max(100, '开票业务摘要最多 100 字'),
  /** @precision Decimal */
  invoiceAmount: z.coerce
    .number({ required_error: '发票金额不能为空' })
    .finite('发票金额必须是有限数字')
    .positive('发票金额必须大于 0'),
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
});

/**
 * 发票更新 Schema（含 version 用于乐观锁）
 */
export const updateInvoiceSchema = createInvoiceSchema.partial().extend({
  version: z
    .number({
      required_error: '请携带乐观锁版本号',
      invalid_type_error: '乐观锁版本号必须是整数',
    })
    .int('乐观锁版本号必须是整数')
    .min(1, '乐观锁版本号必须大于等于 1'),
});

/**
 * 发票冲红 Schema（POST /invoices/:id/red-void body）
 *
 * 只支持全额冲红；部分冲红场景 = 全冲 + 重开。
 */
export const redVoidInvoiceSchema = z.object({
  version: z.number().int().min(1, '请携带乐观锁版本号'),
  reason: z.string().min(1, '冲红原因不能为空').max(500, '冲红原因最多 500 字'),
});

/**
 * 发票查询 Schema
 */
export const queryInvoiceSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  saleOrderId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  invoiceStatus: stringOrStringArray,
});

/**
 * 发票关联客户简要信息 Schema
 */
export const invoiceCustomerInfoSchema = z.object({
  id: z.string(),
  customerName: z.string(),
  shortName: z.string().optional().nullable(),
});

/**
 * 发票关联销售订单简要信息 Schema
 */
export const invoiceSaleOrderInfoSchema = z.object({
  id: z.string(),
  serialNumber: z.string(),
  orderTitle: z.string().optional().nullable(),
  chargerName: z.string().optional().nullable(),
});

/**
 * 发票响应 Schema
 *
 * 字段通过 `withColumn(...)` 附加列 UI 元数据。invoiceStatus 使用未注册的
 * `invoiceStatusMap`，保留 `type: 'custom'` 由页面 overrides 渲染 StatusBadge。
 */
export const invoiceResponseSchema = z.object({
  id: z.string(),
  serialNumber: withColumn(z.string(), {
    label: '编号',
    width: COL_SERIAL,
    sortable: true,
    type: 'custom', // 原页面 render 为加粗（非 serialNumber muted 风格）
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
  invoiceAmount: withColumn(z.number(), {
    label: '发票金额',
    width: COL_AMOUNT,
    sortable: true,
    align: 'right',
    type: 'custom', // 原 render 用 font-mono + toFixed(2)，保留页面写法
    order: 40,
  }),
  invoiceType: withColumn(z.string().optional().nullable(), {
    label: '发票类型',
    type: 'statusBadge',
    statusMapKey: 'invoiceType',
    order: 60,
  }),
  invoiceDate: withColumn(z.string().optional().nullable(), {
    label: '开票日期',
    width: COL_DATE,
    type: 'date',
    order: 70,
    sortable: true,
  }),
  invoiceNumber: withColumn(z.string().optional().nullable(), {
    label: '发票号码',
    type: 'text',
    order: 50,
  }),
  title: withColumn(z.string().optional().nullable(), {
    label: '抬头',
    type: 'text',
    order: 90,
  }),
  taxIdentifyNum: withColumn(z.string().optional().nullable(), {
    label: '纳税识别号',
    width: 160,
    type: 'custom', // 需要 font-mono text-xs
    order: 100,
  }),
  invoiceStatus: withColumn(z.string().optional().nullable(), {
    label: '开票状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'invoiceStatus',
    order: 80,
  }),
  itemType: withColumn(z.string().optional().nullable(), {
    label: '发票项目',
    type: 'statusBadge',
    statusMapKey: 'invoiceItemType',
    hidden: true,
    order: 120,
  }),
  bankName: withColumn(z.string().optional().nullable(), {
    label: '开户银行',
    type: 'text',
    hidden: true,
    order: 130,
  }),
  bankAccount: withColumn(z.string().optional().nullable(), {
    label: '银行账号',
    type: 'text',
    hidden: true,
    order: 140,
  }),
  registeredAddress: withColumn(z.string().optional().nullable(), {
    label: '注册地址',
    type: 'text',
    hidden: true,
    order: 150,
  }),
  registeredPhone: withColumn(z.string().optional().nullable(), {
    label: '注册电话',
    type: 'text',
    hidden: true,
    order: 160,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    width: 200,
    type: 'custom',
    hidden: true,
    order: 110,
  }),
  status: withColumn(z.string(), {
    label: '记录状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'recordStatus',
    hidden: true,
    order: 170,
  }),
  flowStatus: withColumn(z.string().optional().nullable(), {
    label: '审批状态',
    width: COL_STATUS,
    type: 'custom', // 页面 overrides 渲染 ApprovalStatusBadge
    order: 85,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 180,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    order: 190,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  chargerName: z.string().optional().nullable(),
  customer: invoiceCustomerInfoSchema.optional(),
  saleOrder: invoiceSaleOrderInfoSchema.optional(),
});

// ============ 批量操作 Schema ============

const invoiceBatchIdsSchema = z
  .array(z.string().uuid('无效的发票 ID 格式'))
  .min(1, '至少选择一项')
  .max(200, '单次最多操作 200 条');

const invoiceBatchVersionSchema = z
  .number({
    required_error: '每张发票都必须携带乐观锁版本号',
    invalid_type_error: '发票乐观锁版本号必须是整数',
  })
  .int('发票乐观锁版本号必须是整数')
  .min(1, '发票乐观锁版本号必须大于等于 1');

const invoiceVersionedBatchShape = {
  ids: invoiceBatchIdsSchema,
  versions: z.record(z.string().uuid('无效的发票 ID 格式'), invoiceBatchVersionSchema),
};

function createVersionedInvoiceBatchSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object({ ...invoiceVersionedBatchShape, ...shape })
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
          message: '批量发票 ID 不得重复',
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
export const batchTransferInvoiceSchema = createVersionedInvoiceBatchSchema({
  chargerId: z.string().min(1, '请选择新负责人'),
});

/**
 * 批量编辑可改字段白名单：默认禁抬头/税号/银行/地址/电话（法定信息错改风险大）。
 * 金额/发票号/客户/订单/审批/状态/版本一律禁批改。
 */
export const batchUpdateInvoiceSchema = createVersionedInvoiceBatchSchema({
  patch: z
    .object({
      invoiceType: z.string().max(50).optional(),
      invoiceDate: z.string().optional(),
      itemType: z.string().max(50).optional(),
      remark: z.string().optional(),
    })
    .strict()
    .refine((v) => Object.values(v).some((x) => x !== undefined), {
      message: '至少需要修改一个字段',
    }),
});

/** 批量软删：每张待删发票都必须携带客户端读取到的精确 version。 */
export const batchRemoveInvoiceSchema = createVersionedInvoiceBatchSchema({});

export type BatchTransferInvoiceInput = z.infer<typeof batchTransferInvoiceSchema>;
export type BatchUpdateInvoiceInput = z.infer<typeof batchUpdateInvoiceSchema>;
export type BatchRemoveInvoiceInput = z.infer<typeof batchRemoveInvoiceSchema>;

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type RedVoidInvoiceInput = z.infer<typeof redVoidInvoiceSchema>;
export type QueryInvoiceInput = z.infer<typeof queryInvoiceSchema>;
export type InvoiceCustomerInfoOutput = z.infer<typeof invoiceCustomerInfoSchema>;
export type InvoiceSaleOrderInfoOutput = z.infer<typeof invoiceSaleOrderInfoSchema>;
export type InvoiceResponseOutput = z.infer<typeof invoiceResponseSchema>;
