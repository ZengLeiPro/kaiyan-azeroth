import { z } from 'zod';

import {
  CLOUD_OWNER_CATEGORY_VALUES,
  CLOUD_PRODUCT_CODE_VALUES,
  CLOUD_RENEWAL_INTENT_VALUES,
  CLOUD_VENDOR_VALUES,
} from '../constants/cloud-cost';
import { withColumn } from './column-meta';
import { COL_DATE, COL_STATUS } from './column-widths';
import { paginationSchema } from './common';

/**
 * 创建实例元数据 Schema
 */
export const createCloudInstanceMetaSchema = z.object({
  vendor: z.enum(CLOUD_VENDOR_VALUES).default('aliyun'),
  productCode: z.string().min(1, '产品代码不能为空'),
  instanceId: z.string().min(1, '实例 ID 不能为空').max(200),
  alias: z.string().max(100).optional().nullable(),
  purpose: z.string().max(1000).optional().nullable(),
  ownerCategory: z.enum(CLOUD_OWNER_CATEGORY_VALUES).optional().nullable(),
  ownerName: z.string().max(100).optional().nullable(),
  renewalIntent: z.enum(CLOUD_RENEWAL_INTENT_VALUES).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  archived: z.boolean().optional(),
});

/**
 * 更新实例元数据 Schema（含 version 用于乐观锁）
 */
export const updateCloudInstanceMetaSchema = createCloudInstanceMetaSchema.partial().extend({
  version: z.number().int().optional(),
});

/**
 * 实例元数据查询 Schema
 */
export const queryCloudInstanceMetaSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  vendor: z.enum(CLOUD_VENDOR_VALUES).optional(),
  productCode: z.enum(CLOUD_PRODUCT_CODE_VALUES).optional(),
  ownerCategory: z.enum(CLOUD_OWNER_CATEGORY_VALUES).optional(),
  renewalIntent: z.enum(CLOUD_RENEWAL_INTENT_VALUES).optional(),
  archived: z.coerce.boolean().optional(),
});

/**
 * 实例元数据响应 Schema
 */
export const cloudInstanceMetaResponseSchema = z.object({
  id: z.string(),
  vendor: withColumn(z.enum(CLOUD_VENDOR_VALUES), {
    label: '厂商',
    width: 90,
    type: 'text',
    order: 10,
  }),
  productCode: withColumn(z.string(), {
    label: '产品',
    width: 90,
    type: 'text',
    order: 20,
  }),
  instanceId: withColumn(z.string(), {
    label: '实例 ID',
    minWidth: 260,
    type: 'text',
    required: true,
    order: 30,
  }),
  alias: withColumn(z.string().optional().nullable(), {
    label: '别名',
    minWidth: 160,
    type: 'text',
    order: 40,
  }),
  purpose: withColumn(z.string().optional().nullable(), {
    label: '用途',
    minWidth: 240,
    type: 'text',
    order: 50,
  }),
  ownerCategory: withColumn(z.string().optional().nullable(), {
    label: '归属类别',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'cloudOwnerCategory',
    order: 60,
  }),
  ownerName: withColumn(z.string().optional().nullable(), {
    label: '归属名称',
    minWidth: 120,
    type: 'text',
    order: 70,
  }),
  renewalIntent: withColumn(z.string().optional().nullable(), {
    label: '续费意愿',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'cloudRenewalIntent',
    order: 80,
  }),
  notes: withColumn(z.string().optional().nullable(), {
    label: '备注',
    minWidth: 200,
    type: 'text',
    hidden: true,
    order: 90,
  }),
  archived: withColumn(z.boolean(), {
    label: '已归档',
    width: 80,
    type: 'text',
    hidden: true,
    order: 100,
  }),
  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATE,
    type: 'datetime',
    hidden: true,
    order: 110,
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATE,
    type: 'datetime',
    hidden: true,
    order: 120,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CreateCloudInstanceMetaInput = z.infer<typeof createCloudInstanceMetaSchema>;
export type UpdateCloudInstanceMetaInput = z.infer<typeof updateCloudInstanceMetaSchema>;
export type QueryCloudInstanceMetaInput = z.infer<typeof queryCloudInstanceMetaSchema>;
export type CloudInstanceMetaResponseOutput = z.infer<typeof cloudInstanceMetaResponseSchema>;
