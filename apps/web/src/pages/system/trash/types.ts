import type { ICrmProductResponse } from '@ky-azeroth/shared/types/crm-product';
import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';

/**
 * 已删除产品 Profile（前端展示）
 * 复用 CrmProduct 的 Response 类型，deletedAt 确保非空
 */
export interface DeletedProductProfile extends ICrmProductResponse {
  /** 删除时间（在回收站视图中必定有值） */
  deletedAt: string;
}

/**
 * 已删除客户 Profile（前端展示）
 * 复用 Customer 的 Response 类型，deletedAt 确保非空
 */
export interface DeletedCustomerProfile extends ICustomerResponse {
  /** 删除时间（在回收站视图中必定有值） */
  deletedAt: string;
}

/**
 * 回收站统一项类型
 */
export interface TrashItem {
  id: string;
  code: string;
  name: string;
  moduleType: '产品' | '客户';
  deletedAt: string;
  /** 客户回收站响应中的真实 CAS 版本；产品旧接口暂不要求。 */
  version?: number;
  /** 原始数据（用于恢复时的确认） */
  restoreEndpoint: string;
  permanentDeleteEndpoint: string;
}

/**
 * 回收站表单数据（只读页面，无表单）
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DeletedProductFormData {}

/**
 * API 响应 -> Profile 转换
 */
export function toDeletedProductProfile(data: ICrmProductResponse): DeletedProductProfile {
  return {
    ...data,
    standardPrice: data.standardPrice != null ? Number(data.standardPrice) : null, // @decimal-ignore: Decimal 读取转换
    deletedAt: data.deletedAt || '', // 收紧为非空（回收站视图必定有值）
  };
}

/**
 * API 响应 -> 已删除客户 Profile 转换
 */
export function toDeletedCustomerProfile(data: ICustomerResponse): DeletedCustomerProfile {
  return {
    ...data,
    accountsReceivable: data.accountsReceivable != null ? Number(data.accountsReceivable) : null, // @decimal-ignore: Decimal 读取转换
    deletedAt: data.deletedAt || '', // 收紧为非空（回收站视图必定有值）
  };
}

/**
 * 将产品转为统一回收站项
 */
export function productToTrashItem(data: DeletedProductProfile): TrashItem {
  return {
    id: data.id,
    code: data.productNumber || '-',
    name: data.productName,
    moduleType: '产品',
    deletedAt: data.deletedAt,
    restoreEndpoint: `/crm-products/${data.id}/restore`,
    permanentDeleteEndpoint: `/crm-products/${data.id}/permanent`,
  };
}

/**
 * 将客户转为统一回收站项
 */
export function customerToTrashItem(data: DeletedCustomerProfile): TrashItem {
  return {
    id: data.id,
    code: data.serialNumber || '-',
    name: data.customerName,
    moduleType: '客户',
    deletedAt: data.deletedAt,
    version: data.version,
    restoreEndpoint: `/customers/${data.id}/restore`,
    permanentDeleteEndpoint: `/customers/${data.id}/permanent`,
  };
}

// @no-formdata-needed: 只读展示页面
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toDeletedProductFormData(_profile: DeletedProductProfile): DeletedProductFormData {
  return {};
}

// @no-payload: 回收站只读页面，仅支持查看和恢复操作
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toDeletedProductPayload(_form: DeletedProductFormData): Record<string, unknown> {
  return {};
}
