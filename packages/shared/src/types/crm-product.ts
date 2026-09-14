import type { DecimalNumber } from './common';

/**
 * CRM 产品实体
 */
export interface ICrmProduct {
  id: string;
  productName: string;
  productNumber: string | null;
  productTypes: string | null;
  productUnit: string | null;
  /** @precision Decimal */
  standardPrice: DecimalNumber | null;
  productStatus: string | null;
  remark: string | null;
  flowStatus: string | null;
  status: string;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * CRM 产品 API 响应类型
 */

export interface ICrmProductResponse extends ICrmProduct {}

/**
 * 创建 CRM 产品接口契约
 */
export interface ICreateCrmProduct {
  productName: string;
  productNumber?: string | null;
  productTypes?: string | null;
  productUnit?: string | null;
  /** @precision Decimal */
  standardPrice?: DecimalNumber | null;
  productStatus?: string | null;
  remark?: string | null;
}

/**
 * 更新 CRM 产品接口契约
 */
export type IUpdateCrmProduct = Partial<ICreateCrmProduct>;
