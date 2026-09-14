import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATETIME, COL_SERIAL, COL_STATUS, COL_STATUS_SM } from './column-widths';
import { paginationSchema, selectionPaginationSchema, stringOrStringArray } from './common';

/**
 * CRM 产品创建 Schema
 */
export const createCrmProductSchema = z.object({
  productName: z.string().min(1, '产品名称不能为空').max(200, '产品名称最多200个字符'),
  productNumber: z.string().optional().nullable(),
  productTypes: z.string().optional().nullable(),
  productUnit: z.string().optional().nullable(),
  /** @precision Decimal */
  standardPrice: z.coerce.number().optional().nullable(),
  productStatus: z.string().optional().nullable(),
  remark: z.string().optional().nullable(),
});

/**
 * CRM 产品更新 Schema（含 version 用于乐观锁）
 */
export const updateCrmProductSchema = createCrmProductSchema.partial().extend({
  version: z.number().int().optional(),
});

/**
 * CRM 产品查询 Schema
 */
export const queryCrmProductSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  productStatus: stringOrStringArray,
});

/**
 * CRM 产品响应 Schema
 *
 * 列 UI 元数据通过 `withColumn(...)` 附着，供前端 `deriveColumnsFromSchema` 派生表格列。
 * productTypes/productUnit/productStatus 已标注 statusBadge 自动渲染；
 * 页面级业务渲染（加粗名称、截断备注）在 CrmProductsPage 的 `overrides` 中保留。
 */
export const crmProductResponseSchema = z.object({
  id: z.string(),
  productName: withColumn(z.string(), {
    label: '产品名称',
    sortable: true,
    type: 'custom', // 页面 overrides 自定义 render（加粗）
    required: true,
    order: 10,
  }),
  productNumber: withColumn(z.string().optional().nullable(), {
    label: '产品编号',
    width: COL_SERIAL,
    type: 'serialNumber',
    hidden: true,
    order: 20,
  }),
  productTypes: withColumn(z.string().optional().nullable(), {
    label: '产品类型',
    type: 'statusBadge',
    statusMapKey: 'productType',
    order: 30,
  }),
  productUnit: withColumn(z.string().optional().nullable(), {
    label: '单位',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'productUnit',
    order: 40,
  }),
  /** @precision Decimal */
  standardPrice: withColumn(z.number().optional().nullable(), {
    label: '标准价格',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    order: 50,
  }),
  productStatus: withColumn(z.string().optional().nullable(), {
    label: '产品状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'productStatus',
    order: 60,
  }),
  remark: withColumn(z.string().optional().nullable(), {
    label: '备注',
    width: 200,
    type: 'custom', // 页面 overrides（line-clamp）
    hidden: true,
    order: 70,
  }),
  status: withColumn(z.string(), {
    label: '记录状态',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'recordStatus',
    hidden: true,
    order: 80,
  }),
  // 审计
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    hidden: true,
    order: 90,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    sortable: true,
    order: 100,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

/**
 * CRM 产品选择器查询 Schema（用于下拉框）
 */
export const crmProductSelectionQuerySchema = selectionPaginationSchema.extend({
  productStatus: z.string().optional(),
});

export type CreateCrmProductInput = z.infer<typeof createCrmProductSchema>;
export type UpdateCrmProductInput = z.infer<typeof updateCrmProductSchema>;
export type QueryCrmProductInput = z.infer<typeof queryCrmProductSchema>;
export type CrmProductSelectionQueryInput = z.infer<typeof crmProductSelectionQuerySchema>;
export type CrmProductResponseOutput = z.infer<typeof crmProductResponseSchema>;
