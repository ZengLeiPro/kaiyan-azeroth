import type { ICloudCostOverview } from '@ky-azeroth/shared/types/cloud-bill-snapshot';

// @no-payload: 只读页面，数据来自定时同步
// @no-formdata-needed: 只读展示页面

/**
 * 云成本仪表盘 Profile（强绑定 ICloudCostOverview）
 *
 * 该页面是聚合视图（多张卡片 + 图表），数据来自 /cloud-bill-snapshots/overview。
 * 没有表单/提交场景，因此无需 FormData / Payload 类型。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudCostOverviewProfile extends ICloudCostOverview {}

export function toCloudCostOverviewProfile(data: ICloudCostOverview): CloudCostOverviewProfile {
  return { ...data };
}
