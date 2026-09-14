import {
  APPROVAL_EVENT_TYPE,
  APPROVER_TYPE,
  MULTI_APPROVAL_TYPE,
} from '@ky-azeroth/shared/constants';
import { createApprovalFlowNodeSchema, createApprovalFlowSchema } from '@ky-azeroth/shared/schemas';
import type {
  IApprovalFlowNode,
  IApprovalFlowResponse,
  ICreateApprovalFlow,
  ICreateApprovalFlowNode,
  IUpdateApprovalFlow,
} from '@ky-azeroth/shared/types';
import { z } from 'zod';

// ============ Profile Types (Strongly Bound) ============

/**
 * Approval Flow Profile - Frontend display type
 * Using strong binding extends to ensure compile errors when shared types change
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApprovalFlowProfile extends IApprovalFlowResponse {}

/**
 * Approval Flow Node Profile - Frontend display type
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ApprovalFlowNodeProfile extends IApprovalFlowNode {}

// ============ Form Data Types ============

/** Node type: approval or cc (copy to) */
export type FlowNodeType = 'approval' | 'cc';

/**
 * Node form data for creating/editing
 */
export interface ApprovalFlowNodeFormData {
  nodeType: FlowNodeType;
  nodeOrder: number;
  nodeName?: string; // 可选，后端自动生成默认名称
  approverType: (typeof APPROVER_TYPE)[keyof typeof APPROVER_TYPE];
  approverUserIds: string[];
  approverRoleId?: string;
  managerLevel: number;
  multiType: (typeof MULTI_APPROVAL_TYPE)[keyof typeof MULTI_APPROVAL_TYPE];
  timeoutHours?: number;
  // For cc nodes
  ccUserIds?: string[];
}

/**
 * Form data for creating/editing approval flow
 * Note: 未使用 extends ICreateApprovalFlow，原因：
 * 1. 表单节点含 UI-only 字段（nodeType、ccUserIds）与 API 结构差异大
 * 2. code 由后端自动生成，不在表单中
 * 3. toApprovalFlowPayload 负责将 FormData 转换为 ICreateApprovalFlow
 */
export interface ApprovalFlowFormData {
  name: string;
  eventType: (typeof APPROVAL_EVENT_TYPE)[keyof typeof APPROVAL_EVENT_TYPE];
  description: string;
  copyToIds: string[];
  nodes: ApprovalFlowNodeFormData[];
}

// ============ Zod Schemas ============

/**
 * Node form validation schema for frontend
 * Extends shared createApprovalFlowNodeSchema with UI-only fields
 */
export const approvalFlowNodeFormSchema = createApprovalFlowNodeSchema.extend({
  // UI-only: 区分审批节点和抄送节点
  nodeType: z.enum(['approval', 'cc']),
  // 收紧：前端表单中 approverUserIds 必填（非可选）
  approverUserIds: z.array(z.string()),
  // 收紧：前端表单中 managerLevel 必填（非可选）
  managerLevel: z.number().int().min(1).max(10),
  // 收紧：前端表单中 multiType 必填（非可选）
  multiType: z.enum([
    MULTI_APPROVAL_TYPE.AND,
    MULTI_APPROVAL_TYPE.OR,
    MULTI_APPROVAL_TYPE.SEQUENCE,
  ]),
  // UI-only: 抄送节点的用户列表
  ccUserIds: z.array(z.string()).optional(),
});

/**
 * Approval flow form validation schema for frontend
 * Extends shared createApprovalFlowSchema with stricter validation
 */
export const approvalFlowFormSchema = createApprovalFlowSchema.extend({
  // 收紧：添加 trim 和自定义错误消息
  name: z.string().trim().min(1, '请输入流程名称').max(100),
  // 收紧：description 在表单中必填
  description: z.string().max(500),
  // 收紧：copyToIds 在表单中必填（非可选）
  copyToIds: z.array(z.string()),
  // 使用前端 node schema（含 UI-only 字段）
  nodes: z.array(approvalFlowNodeFormSchema).min(1, '至少需要一个审批节点'),
});

// ============ Transform Functions ============

/**
 * Transform API response to frontend profile
 */
export function toApprovalFlowProfile(data: IApprovalFlowResponse): ApprovalFlowProfile {
  return {
    ...data,
    nodes: data.nodes || [],
  };
}

/**
 * Transform profile to form data
 */
export function toApprovalFlowFormData(profile: ApprovalFlowProfile): ApprovalFlowFormData {
  return {
    name: profile.name,
    eventType: profile.eventType,
    description: profile.description || '',
    copyToIds: profile.copyToIds || [],
    nodes: (profile.nodes || []).map((node) => ({
      nodeType: 'approval' as FlowNodeType, // Default to approval for existing nodes
      nodeOrder: node.nodeOrder,
      nodeName: node.nodeName || '', // 确保不为 undefined
      approverType: node.approverType,
      approverUserIds: node.approverUserIds || [],
      approverRoleId: node.approverRoleId || undefined,
      managerLevel: node.managerLevel,
      multiType: node.multiType,
      timeoutHours: node.timeoutHours || undefined,
    })),
  };
}

/**
 * Transform form data to API payload for creation
 */
export function toApprovalFlowPayload(form: ApprovalFlowFormData): ICreateApprovalFlow {
  return {
    name: form.name.trim(),
    eventType: form.eventType,
    description: form.description?.trim() || undefined,
    copyToIds: form.copyToIds,
    nodes: form.nodes.map((node, index) => toApprovalFlowNodePayload(node, index + 1)),
  };
}

/**
 * Transform form data to API payload for update (creates new version)
 */
export function toApprovalFlowUpdatePayload(form: ApprovalFlowFormData): IUpdateApprovalFlow {
  return {
    name: form.name.trim(),
    description: form.description?.trim() || undefined,
    copyToIds: form.copyToIds,
    nodes: form.nodes.map((node, index) => toApprovalFlowNodePayload(node, index + 1)),
  };
}

/**
 * Transform node form data to API payload
 */
function toApprovalFlowNodePayload(
  node: ApprovalFlowNodeFormData,
  order: number
): ICreateApprovalFlowNode {
  const payload: ICreateApprovalFlowNode = {
    nodeOrder: order,
    nodeName: node.nodeName?.trim() || '',
    approverType: node.approverType,
    multiType: node.multiType,
  };

  // Add fields based on approver type
  switch (node.approverType) {
    case APPROVER_TYPE.MEMBER:
      payload.approverUserIds = node.approverUserIds;
      break;
    case APPROVER_TYPE.ROLE:
      payload.approverRoleId = node.approverRoleId;
      break;
    case APPROVER_TYPE.MANAGER:
      payload.managerLevel = node.managerLevel;
      break;
  }

  if (node.timeoutHours) {
    payload.timeoutHours = node.timeoutHours;
  }

  return payload;
}

// ============ Helper Functions ============

/**
 * Create an empty node form data
 */
export function createEmptyNodeFormData(
  order: number,
  nodeType: FlowNodeType = 'approval'
): ApprovalFlowNodeFormData {
  return {
    nodeType,
    nodeOrder: order,
    nodeName: nodeType === 'approval' ? '' : '抄送',
    approverType: APPROVER_TYPE.MEMBER,
    approverUserIds: [],
    approverRoleId: undefined,
    managerLevel: 1,
    multiType: MULTI_APPROVAL_TYPE.OR,
    timeoutHours: undefined,
    ccUserIds: nodeType === 'cc' ? [] : undefined,
  };
}

/**
 * Create empty form data for new approval flow
 */
export function createEmptyApprovalFlowFormData(): ApprovalFlowFormData {
  return {
    name: '',
    eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
    description: '',
    copyToIds: [],
    nodes: [],
  };
}

/**
 * Format version display (e.g., V1, V2)
 */
export function formatVersion(version: number): string {
  return `V${version}`;
}
