import type { ICloudBillSnapshotResponse } from '@ky-azeroth/shared/types/cloud-bill-snapshot';

// @no-payload: 只读页面，数据来自定时同步
// @no-formdata-needed: 只读展示页面

/**
 * 云账单快照 Profile（强绑定 ICloudBillSnapshotResponse）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudBillSnapshotProfile extends ICloudBillSnapshotResponse {}

export function toCloudBillSnapshotProfile(
  data: ICloudBillSnapshotResponse
): CloudBillSnapshotProfile {
  return { ...data };
}
