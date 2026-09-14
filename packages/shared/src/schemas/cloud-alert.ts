import { z } from 'zod';

import {
  CLOUD_ALERT_CATEGORY_VALUES,
  CLOUD_ALERT_LEVEL_VALUES,
  CLOUD_ALERT_STATUS_VALUES,
  CLOUD_VENDOR_VALUES,
} from '../constants/cloud-cost';
import { withColumn } from './column-meta';
import { COL_DATE, COL_STATUS, COL_STATUS_SM } from './column-widths';
import { paginationSchema } from './common';

/**
 * 预警查询 Schema
 */
export const queryCloudAlertSchema = paginationSchema.extend({
  vendor: z.enum(CLOUD_VENDOR_VALUES).optional(),
  level: z.enum(CLOUD_ALERT_LEVEL_VALUES).optional(),
  category: z.enum(CLOUD_ALERT_CATEGORY_VALUES).optional(),
  status: z.enum(CLOUD_ALERT_STATUS_VALUES).optional(),
  /** YYYY-MM-DD */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type QueryCloudAlertInput = z.infer<typeof queryCloudAlertSchema>;

/**
 * 处理预警的 Schema（status 限定为 resolved/dismissed）
 *
 * 注：用作 update 接口，但语义只允许人工处理状态变更。
 */
export const updateCloudAlertSchema = z
  .object({
    status: z.enum(['resolved', 'dismissed']),
    resolutionNote: z.string().max(2000).optional().nullable(),
    version: z.number().int().optional(),
  })
  .partial({ resolutionNote: true, version: true });

/**
 * Create schema 仅供 nestjs-zod 与 prisma-coverage 检查通过；实际写入仅由系统内部 service 调用。
 */
export const createCloudAlertSchema = z.object({
  vendor: z.enum(CLOUD_VENDOR_VALUES).default('aliyun'),
  level: z.enum(CLOUD_ALERT_LEVEL_VALUES),
  category: z.enum(CLOUD_ALERT_CATEGORY_VALUES),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  payload: z.record(z.unknown()).optional().nullable(),
  relatedResource: z.string().max(300).optional().nullable(),
  status: z.enum(CLOUD_ALERT_STATUS_VALUES).default('active'),
  triggeredAt: z.coerce.date().optional(),
});

export type CreateCloudAlertInput = z.infer<typeof createCloudAlertSchema>;
export type UpdateCloudAlertInput = z.infer<typeof updateCloudAlertSchema>;

/**
 * 预警响应 Schema
 */
export const cloudAlertResponseSchema = z.object({
  id: z.string(),
  triggeredAt: withColumn(z.string(), {
    label: '触发时间',
    width: COL_DATE,
    type: 'datetime',
    sortable: true,
    required: true,
    order: 10,
  }),
  vendor: withColumn(z.enum(CLOUD_VENDOR_VALUES), {
    label: '厂商',
    width: 90,
    type: 'text',
    hidden: true,
    order: 20,
  }),
  level: withColumn(z.enum(CLOUD_ALERT_LEVEL_VALUES), {
    label: '等级',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'cloudAlertLevel',
    order: 30,
  }),
  category: withColumn(z.enum(CLOUD_ALERT_CATEGORY_VALUES), {
    label: '类别',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'cloudAlertCategory',
    order: 40,
  }),
  title: withColumn(z.string(), {
    label: '标题',
    minWidth: 200,
    type: 'text',
    required: true,
    order: 50,
  }),
  message: withColumn(z.string(), {
    label: '描述',
    minWidth: 300,
    type: 'text',
    order: 60,
  }),
  payload: z.record(z.unknown()).optional().nullable(),
  relatedResource: withColumn(z.string().optional().nullable(), {
    label: '关联资源',
    minWidth: 200,
    type: 'text',
    hidden: true,
    order: 70,
  }),
  status: withColumn(z.enum(CLOUD_ALERT_STATUS_VALUES), {
    label: '状态',
    width: COL_STATUS_SM,
    type: 'statusBadge',
    statusMapKey: 'cloudAlertStatus',
    order: 80,
  }),
  resolvedAt: withColumn(z.string().optional().nullable(), {
    label: '处理时间',
    width: COL_DATE,
    type: 'datetime',
    hidden: true,
    order: 90,
  }),
  resolvedBy: z.string().optional().nullable(),
  resolutionNote: withColumn(z.string().optional().nullable(), {
    label: '处理备注',
    minWidth: 200,
    type: 'text',
    hidden: true,
    order: 100,
  }),
  createdAt: z.string().optional(),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CloudAlertResponseOutput = z.infer<typeof cloudAlertResponseSchema>;
