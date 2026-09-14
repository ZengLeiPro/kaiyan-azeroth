import type { ICloudPackageProjection } from '@ky-azeroth/shared/types/cloud-bill-snapshot';

// @no-payload: 只读页面，数据来自定时同步
// @no-formdata-needed: 只读展示页面

/**
 * 资源包预测 Profile（强绑定 ICloudPackageProjection）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudPackageProjectionProfile extends ICloudPackageProjection {}

export function toCloudPackageProjectionProfile(
  data: ICloudPackageProjection
): CloudPackageProjectionProfile {
  return { ...data };
}
