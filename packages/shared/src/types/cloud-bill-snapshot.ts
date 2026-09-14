import type { CloudProductCodeValue, CloudVendorValue } from '../constants/cloud-cost';
import type { DecimalNumber } from './common';

/**
 * 云账单按产品的当月明细（snapshot.productBills 的元素）
 */
export interface ICloudBillProductBreakdown {
  productCode: string;
  productName: string;
  /** @precision Decimal */
  paidAmount: DecimalNumber;
  /** @precision Decimal */
  grossAmount: DecimalNumber;
  /** Subscription | PayAsYouGo */
  subscriptionType?: string | null;
}

/**
 * 资源包快照元素（snapshot.resourcePackages 的元素）
 */
export interface ICloudResourcePackageSnapshot {
  instanceId: string;
  productCode: string;
  packageType?: string | null;
  region?: string | null;
  /** @precision Decimal */
  totalAmount: DecimalNumber;
  /** @precision Decimal */
  remainingAmount: DecimalNumber;
  unit?: string | null;
  status?: string | null;
  effectiveTime?: string | null;
  expiryTime?: string | null;
  applicableProducts?: string[] | null;
  remark?: string | null;
}

/**
 * 订阅类资源快照元素（snapshot.subscriptions 的元素）
 */
export interface ICloudSubscriptionSnapshot {
  instanceId: string;
  productCode: string;
  productName?: string | null;
  /** @precision Decimal */
  paidAmount: DecimalNumber;
  billingType?: string | null;
  /** ISO 字符串 */
  expireTime?: string | null;
}

/**
 * 云账单每日快照实体（只读，由定时同步任务写入）
 *
 * 该类型对应 CloudBillSnapshot 模型，数据由 cloud-cost-sync FC 每日定时写入。
 * 不提供 ICreate/IUpdate 类型（业务层只读）。
 */
export interface ICloudBillSnapshot {
  id: string;
  /** 快照日期（YYYY-MM-DD） */
  snapshotDate: string;
  vendor: CloudVendorValue;
  /** 账期月份（YYYY-MM），对应当前月份 */
  billingCycle: string;
  /** 云账号 UID（多账号扩展用） */
  accountId?: string | null;

  // 账户余额
  /** @precision Decimal */
  balanceAvailable?: DecimalNumber | null;
  /** @precision Decimal */
  balanceCash?: DecimalNumber | null;

  // 当月累计
  /** @precision Decimal */
  mtdAmount?: DecimalNumber | null;
  /** @precision Decimal */
  mtdGrossAmount?: DecimalNumber | null;

  /** 按产品的当月明细 */
  productBills: ICloudBillProductBreakdown[];
  /** 资源包余量列表 */
  resourcePackages: ICloudResourcePackageSnapshot[];
  /** 订阅类实例列表 */
  subscriptions: ICloudSubscriptionSnapshot[];

  /** 同步原始数据（调试用，可选） */
  rawPayload?: Record<string, unknown> | null;

  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}

/**
 * 云账单每日快照 API 响应类型
 */
export interface ICloudBillSnapshotResponse extends ICloudBillSnapshot {}

/**
 * 仪表盘汇总响应（由后端按需聚合，非数据库 1:1）
 *
 * V1 后端提供 /cloud-bill-snapshots/latest-overview 接口直接返回此结构，
 * 避免前端在多个 endpoint 间拼装。
 */
export interface ICloudCostOverview {
  /** 最新快照日期 */
  latestSnapshotDate: string;
  vendor: CloudVendorValue;
  /** @precision Decimal */
  balanceAvailable: DecimalNumber | null;
  /** @precision Decimal */
  mtdAmount: DecimalNumber | null;
  /** @precision Decimal */
  mtdGrossAmount: DecimalNumber | null;
  /** 当前活跃预警数 */
  activeAlertCount: number;
  /** 资源包健康度 0~100，按余量加权 */
  resourcePackageHealthScore: number;
  /** 当月按产品 Top N */
  topProducts: ICloudBillProductBreakdown[];
  /** 近 6 个月扣费趋势 */
  monthlyTrend: Array<{
    billingCycle: string;
    /** @precision Decimal */
    paidAmount: DecimalNumber;
    /** @precision Decimal */
    grossAmount: DecimalNumber;
  }>;
  /** 30 天内到期的资源（包年实例 + 资源包） */
  upcomingExpirations: Array<{
    kind: 'package' | 'subscription';
    instanceId: string;
    productCode: CloudProductCodeValue | string;
    expiryTime: string;
    daysLeft: number;
    label: string;
  }>;
}

/**
 * 资源包预测信息（V1 由后端 /cloud-bill-snapshots/packages-projection 计算）
 */
export interface ICloudPackageProjection {
  instanceId: string;
  productCode: string;
  packageType: string | null;
  region: string | null;
  /** @precision Decimal */
  totalAmount: DecimalNumber;
  /** @precision Decimal */
  remainingAmount: DecimalNumber;
  unit: string | null;
  /** @precision Decimal */
  recentDailyAvg: DecimalNumber;
  /** 预测耗尽日（按 recentDailyAvg 推算），null 表示无近期消耗或已耗尽 */
  projectedRunoutDate: string | null;
  /** 实际到期日 */
  expiryTime: string | null;
  /** 预测耗尽日 - 实际到期日 的差值（天）；正数=用不完，负数=不够用 */
  runoutSurplusDays: number | null;
  applicableProducts: string[] | null;
  status: string | null;
  remark: string | null;
}
