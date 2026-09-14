import type {
  CloudMetricNameValue,
  CloudProductCodeValue,
  CloudVendorValue,
} from '../constants/cloud-cost';
import type { DecimalNumber } from './common';

/**
 * 云资源用量指标（只读，由定时同步任务写入）
 *
 * 该类型对应 CloudUsageMetric 模型，按 (vendor, productCode, instanceId, metricName, metricDate) 唯一。
 * 业务层只读。
 */
export interface ICloudUsageMetric {
  id: string;
  /** 度量日期（YYYY-MM-DD），按日聚合 */
  metricDate: string;
  vendor: CloudVendorValue;
  productCode: CloudProductCodeValue | string;
  metricName: CloudMetricNameValue | string;
  /** 实例 ID（聚合数据时为 null） */
  instanceId?: string | null;
  /** @precision Decimal */
  value: DecimalNumber;
  /** 单位（如 CU / GB / bytes / count） */
  unit?: string | null;
  /** 额外维度（如 lineType / bucket / functionName） */
  meta?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  version?: number;
}

export interface ICloudUsageMetricResponse extends ICloudUsageMetric {}

/**
 * 用量时序聚合响应（前端图表用）
 */
export interface ICloudUsageSeries {
  productCode: string;
  metricName: string;
  unit: string | null;
  points: Array<{
    date: string;
    /** @precision Decimal */
    value: DecimalNumber;
  }>;
}
