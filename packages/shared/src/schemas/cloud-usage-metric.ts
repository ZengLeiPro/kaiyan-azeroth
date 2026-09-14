import { z } from 'zod';

import {
  CLOUD_METRIC_NAME_VALUES,
  CLOUD_PRODUCT_CODE_VALUES,
  CLOUD_VENDOR_VALUES,
} from '../constants/cloud-cost';
import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATE } from './column-widths';
import { paginationSchema } from './common';

/**
 * 用量查询 Schema（只读模块）
 */
export const queryCloudUsageMetricSchema = paginationSchema.extend({
  vendor: z.enum(CLOUD_VENDOR_VALUES).optional(),
  productCode: z.enum(CLOUD_PRODUCT_CODE_VALUES).optional(),
  metricName: z.enum(CLOUD_METRIC_NAME_VALUES).optional(),
  instanceId: z.string().optional(),
  /** YYYY-MM-DD */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export type QueryCloudUsageMetricInput = z.infer<typeof queryCloudUsageMetricSchema>;

/**
 * 用量响应 Schema
 */
export const cloudUsageMetricResponseSchema = z.object({
  id: z.string(),
  metricDate: withColumn(z.string(), {
    label: '日期',
    width: COL_DATE,
    type: 'date',
    sortable: true,
    required: true,
  }),
  vendor: withColumn(z.enum(CLOUD_VENDOR_VALUES), {
    label: '厂商',
    width: 100,
    type: 'text',
  }),
  productCode: withColumn(z.string(), {
    label: '产品',
    width: 100,
    type: 'text',
  }),
  metricName: withColumn(z.string(), {
    label: '指标',
    minWidth: 180,
    type: 'text',
  }),
  instanceId: withColumn(z.string().optional().nullable(), {
    label: '实例 ID',
    minWidth: 240,
    type: 'text',
  }),
  value: withColumn(z.number(), {
    label: '数值',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
  }),
  unit: withColumn(z.string().optional().nullable(), {
    label: '单位',
    width: 80,
    type: 'text',
  }),
  meta: z.record(z.unknown()).optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CloudUsageMetricResponseOutput = z.infer<typeof cloudUsageMetricResponseSchema>;

/**
 * 用量时序聚合查询参数（曲线图用）
 */
// @no-pagination: 时序聚合返回固定时间窗内的点序列
export const queryCloudUsageSeriesSchema = z.object({
  vendor: z.enum(CLOUD_VENDOR_VALUES).default('aliyun'),
  productCode: z.enum(CLOUD_PRODUCT_CODE_VALUES),
  metricName: z.enum(CLOUD_METRIC_NAME_VALUES),
  instanceId: z.string().optional(),
  /** YYYY-MM-DD */
  startDate: z.string(),
  endDate: z.string(),
});

export type QueryCloudUsageSeriesInput = z.infer<typeof queryCloudUsageSeriesSchema>;

export const cloudUsageSeriesResponseSchema = z.object({
  productCode: z.string(),
  metricName: z.string(),
  unit: z.string().nullable(),
  points: z.array(
    z.object({
      date: z.string(),
      value: z.number(),
    })
  ),
});

export type CloudUsageSeriesResponseOutput = z.infer<typeof cloudUsageSeriesResponseSchema>;
