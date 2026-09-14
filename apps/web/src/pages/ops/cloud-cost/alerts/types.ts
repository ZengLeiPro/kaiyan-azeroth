import { updateCloudAlertSchema } from '@ky-azeroth/shared/schemas/cloud-alert';
import type { ICloudAlertResponse, IUpdateCloudAlert } from '@ky-azeroth/shared/types/cloud-alert';

/**
 * 云预警 Profile（强绑定 ICloudAlertResponse）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudAlertProfile extends ICloudAlertResponse {}

/**
 * 表单数据：只允许处理状态（resolved / dismissed）与备注。
 *
 * Update 接口语义即「处理预警」，因此 FormData 与 IUpdateCloudAlert 同形态，
 * 额外携带 version 用于乐观锁回传。
 */
export interface CloudAlertFormData extends IUpdateCloudAlert {
  version?: number;
}

export const cloudAlertFormSchema = updateCloudAlertSchema;

export function toCloudAlertProfile(data: ICloudAlertResponse): CloudAlertProfile {
  return { ...data };
}

export function toCloudAlertFormData(entity: CloudAlertProfile): CloudAlertFormData {
  return {
    status: entity.status === 'active' ? 'resolved' : entity.status,
    resolutionNote: entity.resolutionNote ?? null,
    version: entity.version,
  } as CloudAlertFormData;
}

export function toCloudAlertPayload(form: CloudAlertFormData) {
  return {
    status: form.status,
    resolutionNote: form.resolutionNote?.trim() || null,
    version: form.version,
  };
}
