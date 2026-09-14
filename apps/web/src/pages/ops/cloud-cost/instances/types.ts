import type {
  CloudOwnerCategoryValue,
  CloudRenewalIntentValue,
  CloudVendorValue,
} from '@ky-azeroth/shared/constants/cloud-cost';
import { createCloudInstanceMetaSchema } from '@ky-azeroth/shared/schemas/cloud-instance-meta';
import type {
  ICloudInstanceMetaResponse,
  ICreateCloudInstanceMeta,
} from '@ky-azeroth/shared/types/cloud-instance-meta';
import type { z } from 'zod';

/**
 * 云实例元数据 Profile（强绑定 ICloudInstanceMetaResponse）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CloudInstanceMetaProfile extends ICloudInstanceMetaResponse {}

/**
 * 表单数据：与 shared create schema 输入对齐。
 *
 * 注意：shared schema 的 `vendor` 有 `.default('aliyun')`，输入类型为可选；
 * FormData 表单字段在 UI 上必填，所以仍声明为 required。
 * 与 ICreateCloudInstanceMeta（业务契约）兼容，且额外携带 version（乐观锁）。
 */
export interface CloudInstanceMetaFormData extends ICreateCloudInstanceMeta {
  version?: number;
}

/**
 * 给 useCrud 用的 schema，类型上窄化为 `ZodType<CloudInstanceMetaFormData>`：
 * - 运行时与 shared `createCloudInstanceMetaSchema` 完全等价
 * - 类型层抹平 `.default('aliyun')` 带来的 `vendor?:` 可选问题
 */
export const cloudInstanceMetaFormSchema =
  createCloudInstanceMetaSchema as unknown as z.ZodType<CloudInstanceMetaFormData>;

export function toCloudInstanceMetaProfile(
  data: ICloudInstanceMetaResponse
): CloudInstanceMetaProfile {
  return { ...data };
}

export function toCloudInstanceMetaFormData(
  entity: CloudInstanceMetaProfile
): CloudInstanceMetaFormData {
  return {
    vendor: entity.vendor as CloudVendorValue,
    productCode: entity.productCode,
    instanceId: entity.instanceId,
    alias: entity.alias ?? null,
    purpose: entity.purpose ?? null,
    ownerCategory: (entity.ownerCategory ?? null) as CloudOwnerCategoryValue | null,
    ownerName: entity.ownerName ?? null,
    renewalIntent: (entity.renewalIntent ?? null) as CloudRenewalIntentValue | null,
    notes: entity.notes ?? null,
    archived: entity.archived,
    version: entity.version,
  };
}

export function toCloudInstanceMetaPayload(form: CloudInstanceMetaFormData) {
  return {
    vendor: form.vendor,
    productCode: form.productCode.trim(),
    instanceId: form.instanceId.trim(),
    alias: form.alias?.trim() || null,
    purpose: form.purpose?.trim() || null,
    ownerCategory: form.ownerCategory || null,
    ownerName: form.ownerName?.trim() || null,
    renewalIntent: form.renewalIntent || null,
    notes: form.notes?.trim() || null,
    archived: form.archived ?? false,
    version: form.version,
  };
}
