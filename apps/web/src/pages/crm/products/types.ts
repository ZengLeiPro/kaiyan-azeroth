import { createCrmProductSchema } from '@ky-azeroth/shared/schemas/crm-product';
import type { ICreateCrmProduct, ICrmProductResponse } from '@ky-azeroth/shared/types/crm-product';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CrmProductProfile extends ICrmProductResponse {}

export interface CrmProductFormData extends ICreateCrmProduct {
  version?: number;
}

export const crmProductFormSchema = createCrmProductSchema;

export function toCrmProductProfile(data: ICrmProductResponse): CrmProductProfile {
  return { ...data };
}

export function toCrmProductFormData(entity: CrmProductProfile): CrmProductFormData {
  return {
    productName: entity.productName,
    productNumber: entity.productNumber ?? null,
    productTypes: entity.productTypes ?? null,
    productUnit: entity.productUnit ?? null,
    standardPrice: entity.standardPrice != null ? Number(entity.standardPrice) : null,
    productStatus: entity.productStatus ?? null,
    remark: entity.remark ?? null,
    version: entity.version,
  };
}

/**
 * 表单数据 -> API 提交 payload
 * Decimal 字段使用 String() 提交以避免 JS 浮点精度丢失
 */
export function toCrmProductPayload(form: CrmProductFormData) {
  return {
    productName: form.productName.trim(),
    productNumber: form.productNumber?.trim() || null,
    productTypes: form.productTypes || null,
    productUnit: form.productUnit?.trim() || null,
    standardPrice: form.standardPrice != null ? String(form.standardPrice) : null,
    productStatus: form.productStatus || null,
    remark: form.remark?.trim() || null,
    version: form.version,
  };
}

export function toCrmProductUpdatePayload(form: Partial<CrmProductFormData>) {
  return {
    ...(form.productName !== undefined && { productName: form.productName.trim() }),
    ...(form.productNumber !== undefined && { productNumber: form.productNumber?.trim() || null }),
    ...(form.productTypes !== undefined && { productTypes: form.productTypes || null }),
    ...(form.productUnit !== undefined && { productUnit: form.productUnit?.trim() || null }),
    ...(form.standardPrice !== undefined && {
      standardPrice: form.standardPrice != null ? String(form.standardPrice) : null,
    }),
    ...(form.productStatus !== undefined && { productStatus: form.productStatus || null }),
    ...(form.remark !== undefined && { remark: form.remark?.trim() || null }),
    ...(form.version !== undefined && { version: form.version }),
  };
}
