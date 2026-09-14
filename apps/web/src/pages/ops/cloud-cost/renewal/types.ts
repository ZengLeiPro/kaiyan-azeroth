import type { ICloudCostOverview } from '@ky-azeroth/shared/types/cloud-bill-snapshot';

// @no-payload: 只读页面，数据来自定时同步
// @no-formdata-needed: 只读展示页面

/**
 * Overview.upcomingExpirations 单条记录的 Profile。
 *
 * Renewal 页面是 overview 的一个截面视图，没有独立的 shared 类型；
 * 这里通过元素类型派生 Profile，保留强绑定语义。
 */
export type CloudRenewalItemSource = ICloudCostOverview['upcomingExpirations'][number];

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudRenewalItemProfile extends CloudRenewalItemSource {}

export function toCloudRenewalItemProfile(item: CloudRenewalItemSource): CloudRenewalItemProfile {
  return { ...item };
}
