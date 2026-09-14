import type {
  IApprovalInstanceResponse,
  IApprovalRecordResponse,
  IApprovalTaskResponse,
} from '@ky-azeroth/shared/types';

// ============ Profile 类型（强绑定） ============

/**
 * 审批实例前端展示类型
 * 使用强绑定 extends 确保 shared 类型变更时编译报错
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApprovalInstanceProfile extends IApprovalInstanceResponse {}

/**
 * 审批任务前端展示类型
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApprovalTaskProfile extends IApprovalTaskResponse {}

/**
 * 审批记录前端展示类型
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApprovalRecordProfile extends IApprovalRecordResponse {}

// ============ 转换函数 ============

export function toApprovalInstanceProfile(
  data: IApprovalInstanceResponse
): ApprovalInstanceProfile {
  return data;
}

export function toApprovalTaskProfile(data: IApprovalTaskResponse): ApprovalTaskProfile {
  return data;
}

export function toApprovalRecordProfile(data: IApprovalRecordResponse): ApprovalRecordProfile {
  return data;
}

// ============ FormData 转换（只读页面，保持转换链完整性） ============

export function toApprovalInstanceFormData(
  entity: ApprovalInstanceProfile
): Partial<ApprovalInstanceProfile> {
  return { ...entity };
}

export function toApprovalTaskFormData(entity: ApprovalTaskProfile): Partial<ApprovalTaskProfile> {
  return { ...entity };
}

export function toApprovalRecordFormData(
  entity: ApprovalRecordProfile
): Partial<ApprovalRecordProfile> {
  return { ...entity };
}

// ============ Payload 转换（只读页面，不支持创建/编辑） ============

/**
 * @no-payload: 审批页面为只读展示页面，用户只能查看和处理审批，不能创建审批实例
 * 审批实例由业务模块（如采购、资产处置）触发创建，审批页面只负责审批操作
 */

// ============ Tab 配置 ============

export type ApprovalTabKey = 'pending' | 'completed' | 'copyTo' | 'initiated' | 'all';

export interface ApprovalTabConfig {
  key: ApprovalTabKey;
  label: string;
  showBadge?: boolean;
  allScopeOnly?: boolean;
}

export const APPROVAL_TABS: ApprovalTabConfig[] = [
  { key: 'all', label: '全部审批', allScopeOnly: true },
  { key: 'pending', label: '待审批', showBadge: true },
  { key: 'completed', label: '已审批' },
  { key: 'copyTo', label: '抄送我' },
  { key: 'initiated', label: '我发起' },
];
