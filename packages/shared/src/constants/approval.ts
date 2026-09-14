/**
 * 审批流程常量 - 前后端共享
 */

// 审批实例状态
export const APPROVAL_INSTANCE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;
export type ApprovalInstanceStatusValue =
  (typeof APPROVAL_INSTANCE_STATUS)[keyof typeof APPROVAL_INSTANCE_STATUS];

// 审批任务状态
export const APPROVAL_TASK_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SKIPPED: 'skipped',
} as const;
export type ApprovalTaskStatusValue =
  (typeof APPROVAL_TASK_STATUS)[keyof typeof APPROVAL_TASK_STATUS];

// 审批人类型
export const APPROVER_TYPE = {
  MEMBER: 'member',
  MANAGER: 'manager',
  ROLE: 'role',
} as const;
export type ApproverTypeValue = (typeof APPROVER_TYPE)[keyof typeof APPROVER_TYPE];

// 多人审批方式
export const MULTI_APPROVAL_TYPE = {
  AND: 'and',
  OR: 'or',
  SEQUENCE: 'sequence',
} as const;
export type MultiApprovalTypeValue = (typeof MULTI_APPROVAL_TYPE)[keyof typeof MULTI_APPROVAL_TYPE];

// 审批事件类型
export const APPROVAL_EVENT_TYPE = {
  SALE_ORDER_ACTIVATE: 'sale_order_activate',
  INVOICE_APPROVE: 'invoice_approve',
  PAYMENT_APPROVE: 'payment_approve',
  PAYMENT_REFUND_APPROVE: 'payment_refund_approve',
  VISIT_APPROVE: 'visit_approve',
  SALE_ORDER_CHANGE: 'sale_order_change',
  SALE_ORDER_VOID: 'sale_order_void',
  INVOICE_CHANGE: 'invoice_change',
  PAYMENT_CHANGE: 'payment_change',
  PAYMENT_REFUND_CHANGE: 'payment_refund_change',
  VISIT_CHANGE: 'visit_change',
  PROJECT_LAUNCH: 'project_launch',
  // 客户线索阶段（MQL/SQL）变更审批：电销发起，ADMIN/审批人通过后生效
  CUSTOMER_TAG_CHANGE: 'customer_tag_change',
} as const;
export type ApprovalEventTypeValue = (typeof APPROVAL_EVENT_TYPE)[keyof typeof APPROVAL_EVENT_TYPE];

// 审批操作类型
//
// AUTO_PASS 由审批引擎写入：当某节点解析出来的审批人包含发起人本人时，
// 引擎按规则自动通过本人那一份并写一条 ApprovalRecord(action='auto_pass')。
// 与 APPROVE 区分以便审计/统计能识别"非人工通过"的节点。
export const APPROVAL_ACTION = {
  SUBMIT: 'submit',
  APPROVE: 'approve',
  REJECT: 'reject',
  WITHDRAW: 'withdraw',
  REMIND: 'remind',
  AUTO_PASS: 'auto_pass',
} as const;
export type ApprovalActionValue = (typeof APPROVAL_ACTION)[keyof typeof APPROVAL_ACTION];

// 审批结果
export const APPROVAL_RESULT = {
  PASSED: 'passed',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
} as const;
export type ApprovalResultValue = (typeof APPROVAL_RESULT)[keyof typeof APPROVAL_RESULT];
