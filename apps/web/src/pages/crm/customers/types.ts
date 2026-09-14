import { INDUSTRY_VALUES, type IndustryValue } from '@ky-azeroth/shared/constants/status-values';
import { createCustomerSchema } from '@ky-azeroth/shared/schemas/customer';
import type { ICreateCustomer, ICustomerResponse } from '@ky-azeroth/shared/types/customer';

const INDUSTRY_VALUE_SET: ReadonlySet<string> = new Set<string>(INDUSTRY_VALUES);

/** 历史脏值（如 '-'）或上游 ETL 写入的白名单外值，编辑时统一清空让用户重选 */
function normalizeIndustry(value: string | null | undefined): IndustryValue | null {
  if (!value) return null;
  return INDUSTRY_VALUE_SET.has(value) ? (value as IndustryValue) : null;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomerProfile extends ICustomerResponse {}

export interface CustomerFormData extends ICreateCustomer {
  version?: number;
  collaboratorIds?: string[] | null;
}

export const customerFormSchema = createCustomerSchema;

export function toCustomerProfile(data: ICustomerResponse): CustomerProfile {
  return { ...data };
}

export function toCustomerFormData(entity: CustomerProfile): CustomerFormData {
  return {
    customerName: entity.customerName,
    industry: normalizeIndustry(entity.industry),
    customerLevel: entity.customerLevel ?? null,
    customerSource: entity.customerSource ?? null,
    customerRelationship: entity.customerRelationship ?? null,
    customerTags: entity.customerTags ?? null,
    country: entity.country ?? null,
    province: entity.province ?? null,
    city: entity.city ?? null,
    district: entity.district ?? null,
    address: entity.address ?? null,
    remark: entity.remark ?? null,
    aiInfoSummary: entity.aiInfoSummary ?? null,
    chargerId: entity.chargerId ?? null,
    collaboratorName: entity.collaboratorName ?? null,
    collaboratorIds: entity.collaboratorIds ?? null,
    contactStatus: entity.contactStatus ?? null,
    dealStatus: entity.dealStatus ?? null,
    leadStage: (entity.leadStage ?? null) as CustomerFormData['leadStage'],
    leadStageQualifiedById: entity.leadStageQualifiedById ?? null,
    leadValidity: entity.leadValidity ?? 'VALID',
    leadInvalidReason: entity.leadInvalidReason ?? null,
    organizationId: entity.organizationId ?? null,
    uncId: entity.uncId ?? null,
    headcountRange: entity.headcountRange ?? null,
    version: entity.version,
  };
}

function toCustomerEditableFields(form: CustomerFormData) {
  return {
    customerName: form.customerName.trim(),
    industry: form.industry || null,
    customerLevel: form.customerLevel || null,
    customerSource: form.customerSource || null,
    customerRelationship: form.customerRelationship || null,
    customerTags: form.customerTags,
    remark: form.remark?.trim() || null,
    country: form.country || null,
    province: form.province || null,
    city: form.city || null,
    district: form.district || null,
    address: form.address?.trim() || null,
    chargerId: form.chargerId || null,
    collaboratorIds:
      form.collaboratorIds && form.collaboratorIds.length > 0 ? form.collaboratorIds : null,
    organizationId: form.organizationId || null,
    uncId: form.uncId || null,
    headcountRange: form.headcountRange || null,
    leadValidity: form.leadValidity ?? 'VALID',
    leadInvalidReason: form.leadValidity === 'INVALID' ? (form.leadInvalidReason ?? null) : null,
  };
}

/** 创建可携带录入字段；普通更新必须改用 toCustomerUpdatePayload。 */
export function toCustomerCreatePayload(form: CustomerFormData) {
  return {
    ...toCustomerEditableFields(form),
    aiInfoSummary: form.aiInfoSummary?.trim() || null,
    collaboratorName: form.collaboratorName?.trim() || null,
    leadStage: form.leadStage ?? undefined,
    leadStageQualifiedById: form.leadStageQualifiedById ?? undefined,
  };
}

/**
 * 普通客户更新白名单。
 *
 * AI 摘要及生成时间、协作人展示名、跟进/成交事实、线索阶段与审计字段均由专用流程维护，
 * 不得因为详情回填到页面对象而被 PUT /customers/:id 反向透传。
 */
export function toCustomerUpdatePayload(form: CustomerFormData) {
  return {
    ...toCustomerEditableFields(form),
    version: form.version,
  };
}

/**
 * 兼容现有创建调用点；CustomersPage 的普通更新路径应显式接入 toCustomerUpdatePayload。
 */
export const toCustomerPayload = toCustomerCreatePayload;
