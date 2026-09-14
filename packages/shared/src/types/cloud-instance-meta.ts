import type {
  CloudOwnerCategoryValue,
  CloudProductCodeValue,
  CloudRenewalIntentValue,
  CloudVendorValue,
} from '../constants/cloud-cost';

/**
 * 云实例元数据（手动维护：别名、用途、业务归属、续费意愿）
 *
 * 用于把阿里云裸实例 ID 映射为人类可读的语义。
 * 按 (vendor, productCode, instanceId) 唯一。
 */
export interface ICloudInstanceMeta {
  id: string;
  vendor: CloudVendorValue;
  productCode: CloudProductCodeValue | string;
  /** 阿里云实例 ID（如 i-wz959zfflu6v05p005k8 / fc_cu_dp_cn-xxx） */
  instanceId: string;
  /** 短别名（用于表格展示，必填，鼓励简短） */
  alias?: string | null;
  /** 详细用途说明（多行） */
  purpose?: string | null;
  /** 业务归属类别 */
  ownerCategory?: CloudOwnerCategoryValue | null;
  /** 归属名称（客户名 / 内部模块名） */
  ownerName?: string | null;
  /** 续费意愿 */
  renewalIntent?: CloudRenewalIntentValue | null;
  /** 备注 */
  notes?: string | null;
  /** 是否已归档（不再出现在主表） */
  archived: boolean;

  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

export interface ICloudInstanceMetaResponse extends ICloudInstanceMeta {}

/**
 * 创建实例元数据契约
 */
export interface ICreateCloudInstanceMeta {
  vendor: CloudVendorValue;
  productCode: string;
  instanceId: string;
  alias?: string | null;
  purpose?: string | null;
  ownerCategory?: CloudOwnerCategoryValue | null;
  ownerName?: string | null;
  renewalIntent?: CloudRenewalIntentValue | null;
  notes?: string | null;
  archived?: boolean;
}

/**
 * 更新实例元数据契约
 */
export type IUpdateCloudInstanceMeta = Partial<ICreateCloudInstanceMeta>;
