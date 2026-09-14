import type {
  CloudAlertCategoryValue,
  CloudAlertLevelValue,
  CloudAlertStatusValue,
  CloudVendorValue,
} from '../constants/cloud-cost';

/**
 * 云成本预警事件（由定时任务在写入快照后比对生成）
 */
export interface ICloudAlert {
  id: string;
  triggeredAt: string;
  vendor: CloudVendorValue;
  level: CloudAlertLevelValue;
  category: CloudAlertCategoryValue;
  title: string;
  message: string;
  /** 触发数据快照（具体字段视 category 而定） */
  payload?: Record<string, unknown> | null;
  /** 关联资源（实例 ID / 资源包 ID / 产品代码） */
  relatedResource?: string | null;
  /** 状态：active / resolved / dismissed */
  status: CloudAlertStatusValue;
  resolvedAt?: string | null;
  /** 处理人 employee.id */
  resolvedBy?: string | null;
  /** 处理备注 */
  resolutionNote?: string | null;

  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

export interface ICloudAlertResponse extends ICloudAlert {}

/**
 * 处理（resolve/dismiss）预警的契约
 */
export interface IResolveCloudAlert {
  status: 'resolved' | 'dismissed';
  resolutionNote?: string | null;
}

/**
 * 更新预警状态（仅 status / resolutionNote 可改）
 */
export type IUpdateCloudAlert = IResolveCloudAlert;
