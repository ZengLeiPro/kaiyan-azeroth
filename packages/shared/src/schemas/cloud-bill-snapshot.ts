import { z } from 'zod';

import {
  CLOUD_ALERT_LEVEL_VALUES,
  CLOUD_PRODUCT_CODE_VALUES,
  CLOUD_VENDOR_VALUES,
} from '../constants/cloud-cost';
import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATE } from './column-widths';
import { paginationSchema } from './common';

/**
 * 单产品当月明细
 */
export const cloudBillProductBreakdownSchema = z.object({
  productCode: z.string(),
  productName: z.string(),
  paidAmount: z.number(),
  grossAmount: z.number(),
  subscriptionType: z.string().optional().nullable(),
});

/**
 * 资源包快照元素
 */
export const cloudResourcePackageSnapshotSchema = z.object({
  instanceId: z.string(),
  productCode: z.string(),
  packageType: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  totalAmount: z.number(),
  remainingAmount: z.number(),
  unit: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  effectiveTime: z.string().optional().nullable(),
  expiryTime: z.string().optional().nullable(),
  applicableProducts: z.array(z.string()).optional().nullable(),
  remark: z.string().optional().nullable(),
});

/**
 * 订阅类资源快照元素
 */
export const cloudSubscriptionSnapshotSchema = z.object({
  instanceId: z.string(),
  productCode: z.string(),
  productName: z.string().optional().nullable(),
  paidAmount: z.number(),
  billingType: z.string().optional().nullable(),
  expireTime: z.string().optional().nullable(),
});

/**
 * 快照查询 Schema（只读模块，无 create/update）
 */
export const queryCloudBillSnapshotSchema = paginationSchema.extend({
  vendor: z.enum(CLOUD_VENDOR_VALUES).optional(),
  /** YYYY-MM-DD */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  /** YYYY-MM（账期月份） */
  billingCycle: z.string().optional(),
});

export type QueryCloudBillSnapshotInput = z.infer<typeof queryCloudBillSnapshotSchema>;

/**
 * 快照响应 Schema
 */
export const cloudBillSnapshotResponseSchema = z.object({
  id: z.string(),
  snapshotDate: withColumn(z.string(), {
    label: '快照日期',
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
  billingCycle: withColumn(z.string(), {
    label: '账期',
    width: 100,
    type: 'text',
  }),
  accountId: z.string().optional().nullable(),
  balanceAvailable: withColumn(z.number().optional().nullable(), {
    label: '可用余额',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
  }),
  balanceCash: z.number().optional().nullable(),
  mtdAmount: withColumn(z.number().optional().nullable(), {
    label: '当月扣费',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
  }),
  mtdGrossAmount: withColumn(z.number().optional().nullable(), {
    label: '当月消耗原价',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    hidden: true,
  }),
  productBills: z.array(cloudBillProductBreakdownSchema),
  resourcePackages: z.array(cloudResourcePackageSnapshotSchema),
  subscriptions: z.array(cloudSubscriptionSnapshotSchema),
  rawPayload: z.record(z.unknown()).optional().nullable(),

  createdAt: withColumn(z.string().optional(), {
    label: '创建时间',
    width: COL_DATE,
    type: 'datetime',
    hidden: true,
  }),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
});

export type CloudBillSnapshotResponseOutput = z.infer<typeof cloudBillSnapshotResponseSchema>;

/**
 * 仪表盘汇总响应 Schema（聚合接口，非数据库 1:1）
 *
 * 该 schema 不参与分页查询，仅用于 controller 返回类型校验。
 */
export const cloudCostOverviewResponseSchema = z.object({
  latestSnapshotDate: z.string(),
  vendor: z.enum(CLOUD_VENDOR_VALUES),
  balanceAvailable: z.number().nullable(),
  mtdAmount: z.number().nullable(),
  mtdGrossAmount: z.number().nullable(),
  activeAlertCount: z.number().int().nonnegative(),
  resourcePackageHealthScore: z.number().min(0).max(100),
  topProducts: z.array(cloudBillProductBreakdownSchema),
  monthlyTrend: z.array(
    z.object({
      billingCycle: z.string(),
      paidAmount: z.number(),
      grossAmount: z.number(),
    })
  ),
  upcomingExpirations: z.array(
    z.object({
      kind: z.enum(['package', 'subscription']),
      instanceId: z.string(),
      productCode: z.string(),
      expiryTime: z.string(),
      daysLeft: z.number().int(),
      label: z.string(),
    })
  ),
});

export type CloudCostOverviewResponseOutput = z.infer<typeof cloudCostOverviewResponseSchema>;

/**
 * Overview 查询参数（无分页，简单 vendor 过滤）
 */
// @no-pagination: 汇总查询，返回聚合数据
export const queryCloudCostOverviewSchema = z.object({
  vendor: z.enum(CLOUD_VENDOR_VALUES).default('aliyun'),
});

export type QueryCloudCostOverviewInput = z.infer<typeof queryCloudCostOverviewSchema>;

/**
 * 资源包预测响应 Schema
 */
export const cloudPackageProjectionSchema = z.object({
  instanceId: z.string(),
  productCode: z.string(),
  packageType: z.string().nullable(),
  region: z.string().nullable(),
  totalAmount: z.number(),
  remainingAmount: z.number(),
  unit: z.string().nullable(),
  recentDailyAvg: z.number(),
  projectedRunoutDate: z.string().nullable(),
  expiryTime: z.string().nullable(),
  runoutSurplusDays: z.number().nullable(),
  applicableProducts: z.array(z.string()).nullable(),
  status: z.string().nullable(),
  remark: z.string().nullable(),
});

export type CloudPackageProjectionOutput = z.infer<typeof cloudPackageProjectionSchema>;

// @no-pagination: 资源包列表为有限集合，一次性返回
export const queryCloudPackageProjectionSchema = z.object({
  vendor: z.enum(CLOUD_VENDOR_VALUES).default('aliyun'),
  productCode: z.enum(CLOUD_PRODUCT_CODE_VALUES).optional(),
});

export type QueryCloudPackageProjectionInput = z.infer<typeof queryCloudPackageProjectionSchema>;

// 预留：预警级别 schema 复用导出，便于其他模块校验
export const cloudAlertLevelSchema = z.enum(CLOUD_ALERT_LEVEL_VALUES);
