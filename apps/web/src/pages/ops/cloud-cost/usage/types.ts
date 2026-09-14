import type {
  ICloudUsageMetricResponse,
  ICloudUsageSeries,
} from '@ky-azeroth/shared/types/cloud-usage-metric';

// @no-payload: 只读页面，数据来自定时同步
// @no-formdata-needed: 只读展示页面

/**
 * 云用量记录 Profile（强绑定 ICloudUsageMetricResponse）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudUsageMetricProfile extends ICloudUsageMetricResponse {}

export function toCloudUsageMetricProfile(
  data: ICloudUsageMetricResponse
): CloudUsageMetricProfile {
  return { ...data };
}

/**
 * 用量时序聚合（曲线图用），与 shared ICloudUsageSeries 强绑定
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudUsageSeriesProfile extends ICloudUsageSeries {}

export function toCloudUsageSeriesProfile(data: ICloudUsageSeries): CloudUsageSeriesProfile {
  return { ...data };
}
