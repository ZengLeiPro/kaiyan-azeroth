import type {
  ApprovalActionValue,
  ApprovalEventTypeValue,
  ApprovalInstanceStatusValue,
  ApprovalResultValue,
  ApprovalTaskStatusValue,
  ApproverTypeValue,
  MultiApprovalTypeValue,
} from '../constants/approval';

// ============ 审批流程定义 ============

/** 审批流程状态 */
export type ApprovalFlowStatus = 'active' | 'inactive' | 'deleted';

/** 审批流程定义 */
export interface IApprovalFlow {
  id: string;
  groupId: string; // 版本组ID，同一事件类型的所有版本共享同一groupId
  code: string;
  name: string;
  eventType: ApprovalEventTypeValue;
  description?: string | null;
  version: number; // 版本号 V1, V2, V3...
  status: ApprovalFlowStatus;
  copyToIds: string[];
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  createdByName?: string | null; // 创建人名称（列表显示用）
}

/** 审批流程响应 */
export interface IApprovalFlowResponse extends IApprovalFlow {
  nodes?: IApprovalFlowNode[];
}

/** 创建审批流程请求 */
export interface ICreateApprovalFlow {
  name: string;
  eventType: ApprovalEventTypeValue;
  description?: string;
  copyToIds?: string[];
  nodes: ICreateApprovalFlowNode[];
}

/** 更新审批流程请求（会创建新版本） */
export interface IUpdateApprovalFlow {
  name?: string;
  description?: string;
  copyToIds?: string[];
  nodes?: ICreateApprovalFlowNode[];
}

// ============ 审批流程节点 ============

/** 审批流程节点 */
export interface IApprovalFlowNode {
  id: string;
  flowId: string;
  nodeOrder: number;
  nodeName: string;
  approverType: ApproverTypeValue;
  approverUserIds: string[];
  approverRoleId?: string | null;
  managerLevel: number;
  multiType: MultiApprovalTypeValue;
  timeoutHours?: number | null;
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version: number;
}

/** 创建审批流程节点请求 */
export interface ICreateApprovalFlowNode {
  nodeOrder: number;
  nodeName?: string; // 可选，后端自动生成默认名称
  approverType: ApproverTypeValue;
  approverUserIds?: string[];
  approverRoleId?: string;
  managerLevel?: number;
  multiType?: MultiApprovalTypeValue;
  timeoutHours?: number;
}

// ============ 审批实例 ============

/** 审批实例 */
export interface IApprovalInstance {
  id: string;
  code: string;
  flowId: string;
  flowVersion: number;
  eventType: ApprovalEventTypeValue;
  formId: string;
  formCode: string;
  title: string;
  status: ApprovalInstanceStatusValue;
  currentNode: number;
  totalNodes: number;
  initiatorId: string;
  initiatorName: string;
  copyToIds: string[];
  completedAt?: string | null;
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version: number;
}

/** 审批实例响应（含关联数据） */
export interface IApprovalInstanceResponse extends IApprovalInstance {
  flow?: { id: string; name: string; code: string };
  tasks?: IApprovalTaskResponse[];
  records?: IApprovalRecordResponse[];
}

/** 审批变更申请 */
export interface IApprovalChangeRequest {
  id: string;
  eventType: ApprovalEventTypeValue;
  targetType: string;
  targetId: string;
  targetCode?: string | null;
  title: string;
  baseVersion: number;
  patch: unknown;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  status: ApprovalInstanceStatusValue;
  approvalInstanceId?: string | null;
  appliedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  version: number;
  creatorEmployeeId?: string | null;
  updaterEmployeeId?: string | null;
}

/** 审批变更申请响应 */
export interface IApprovalChangeRequestResponse extends IApprovalChangeRequest {
  approvalInstance?: IApprovalInstanceResponse | null;
}

/** 审批外部通知发件箱（内部可靠投递状态） */
export interface IApprovalNotificationOutbox {
  id: string;
  dedupKey: string;
  eventType: string;
  recipientEmployeeId: string;
  payload: unknown;
  status: string;
  attemptCount: number;
  nextAttemptAt: string;
  lastError?: string | null;
  sentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 提交审批请求 */
export interface ISubmitApprovalRequest {
  eventType: ApprovalEventTypeValue;
  formId: string;
  formCode: string;
  title: string;
}

// ============ 审批任务 ============

/** 审批任务 */
export interface IApprovalTask {
  id: string;
  instanceId: string;
  nodeOrder: number;
  nodeName: string;
  approverId: string;
  approverName: string;
  approverType: ApproverTypeValue;
  sequence: number;
  status: ApprovalTaskStatusValue;
  comment?: string | null;
  actionTime?: string | null;
  createdAt: string;
  createdBy?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version: number;
}

/** 审批任务响应（含实例信息） */
export interface IApprovalTaskResponse extends IApprovalTask {
  instance?: IApprovalInstanceResponse;
}

// ============ 审批记录 ============

/** 审批记录 */
export interface IApprovalRecord {
  id: string;
  instanceId: string;
  nodeOrder: number;
  nodeName?: string | null;
  operatorId: string;
  operatorName: string;
  action: ApprovalActionValue;
  result?: ApprovalResultValue | null;
  comment?: string | null;
  createdAt?: string;
}

/** 审批记录响应 */

export interface IApprovalRecordResponse extends IApprovalRecord {}

// ============ 审批操作请求 ============

/** 审批任务操作请求 */
export interface IApprovalTaskActionRequest {
  action: 'approve' | 'reject';
  comment?: string;
}

/** 撤回审批请求 */
export interface IWithdrawApprovalRequest {
  comment?: string;
}

// ============ 查询参数 ============

/** 审批列表查询参数 */
export interface IApprovalQueryParams {
  page?: number;
  pageSize?: number;
  status?: ApprovalInstanceStatusValue;
  eventType?: ApprovalEventTypeValue;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}
