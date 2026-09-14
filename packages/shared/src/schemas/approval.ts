import { z } from 'zod';

import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_STATUS,
  APPROVER_TYPE,
  MULTI_APPROVAL_TYPE,
} from '../constants/approval';
import { withColumn } from './column-meta';
import { COL_DATETIME, COL_PERCENT, COL_STATUS, COL_STATUS_SM } from './column-widths';
import { paginationSchema, stringOrStringArray } from './common';

// ============ 审批流程 Schema ============

export const createApprovalFlowNodeSchema = z.object({
  nodeOrder: z.number().int().min(1),
  nodeName: z.string().max(100).optional().default(''), // 可选，后端自动生成默认名称
  approverType: z.enum([APPROVER_TYPE.MEMBER, APPROVER_TYPE.MANAGER, APPROVER_TYPE.ROLE]),
  approverUserIds: z.array(z.string()).optional().default([]),
  approverRoleId: z.string().optional(),
  managerLevel: z.number().int().min(1).max(10).optional().default(1),
  multiType: z
    .enum([MULTI_APPROVAL_TYPE.AND, MULTI_APPROVAL_TYPE.OR, MULTI_APPROVAL_TYPE.SEQUENCE])
    .optional()
    .default(MULTI_APPROVAL_TYPE.OR),
  timeoutHours: z.number().int().min(1).optional(),
});

export const createApprovalFlowSchema = z.object({
  name: z.string().min(1).max(100),
  eventType: z.enum([
    APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
    APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
    APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
    APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE,
    APPROVAL_EVENT_TYPE.VISIT_APPROVE,
    APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
    APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
    APPROVAL_EVENT_TYPE.INVOICE_CHANGE,
    APPROVAL_EVENT_TYPE.PAYMENT_CHANGE,
    APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE,
    APPROVAL_EVENT_TYPE.VISIT_CHANGE,
    APPROVAL_EVENT_TYPE.PROJECT_LAUNCH,
    APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE,
  ]),
  description: z.string().max(500).optional(),
  copyToIds: z.array(z.string()).optional().default([]),
  nodes: z.array(createApprovalFlowNodeSchema).min(1, '至少需要一个审批节点'),
});

/** 更新审批流程（会创建新版本，不是覆盖） */
export const updateApprovalFlowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  copyToIds: z.array(z.string()).optional(),
  nodes: z.array(createApprovalFlowNodeSchema).min(1, '至少需要一个审批节点').optional(),
});

// ============ 审批操作 Schema ============

/**
 * 审批操作附加副作用（仅在特定业务事件通过时生效）
 *
 * - chargerId：CUSTOMER_TAG_CHANGE（MQL/SQL 变更）终审通过时指定承接销售，
 *   客户负责人同步更新为该员工。
 * - addCollaboratorIds：兼容旧版 CUSTOMER_TAG_CHANGE 操作，审批人可一并追加
 *   指定员工为客户协作人。新的终审界面会自动把审批发起的电销加入协作人，
 *   不再要求审批人手动选择电销。
 * - 驳回时这些字段均被忽略，非 CUSTOMER_TAG_CHANGE 事件亦忽略。
 * - schema 层不校验业务耦合，业务层在通过分支决定是否落地。
 */
export const approvalActionSideEffectsSchema = z.object({
  chargerId: z.string().trim().min(1).optional(),
  addCollaboratorIds: z.array(z.string()).max(20).optional(),
});

export const approvalActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional(),
  sideEffects: approvalActionSideEffectsSchema.optional(),
});

/**
 * 批量审批 Schema：业务列表（订单/回款/开票）批量调用，循环调 ApprovalsService.doApproval。
 * 单次最多 50 条防误操作 + 避免长事务（每条 ~300ms 含 CAS+行锁+节点推进+业务回写）。
 * 失败原因聚合到 skipped 不抛错——前端按 skipped 长度展示 "X 条成功，Y 条跳过"。
 */
export const batchApproveSchema = z.object({
  instanceIds: z
    .array(z.string().uuid('无效的审批实例 ID 格式'))
    .min(1, '至少选择一项')
    .max(50, '单次最多审批 50 条'),
  action: z.enum(['approve', 'reject']),
  comment: z.string().max(500).optional(),
});

export const withdrawApprovalSchema = z.object({
  comment: z.string().max(500).optional(),
});

/** 已审批业务单据作废申请：审批通过后才执行软删除。 */
export const voidApprovalRequestSchema = z.object({
  reason: z.string().trim().min(1, '请填写作废原因').max(500, '作废原因不能超过 500 个字符'),
  version: z.number().int().min(1, '无效的数据版本'),
});

export type VoidApprovalRequestInput = z.infer<typeof voidApprovalRequestSchema>;

// ============ 查询 Schema ============

export const queryApprovalSchema = paginationSchema.extend({
  status: z
    .enum([
      APPROVAL_INSTANCE_STATUS.PENDING,
      APPROVAL_INSTANCE_STATUS.APPROVED,
      APPROVAL_INSTANCE_STATUS.REJECTED,
      APPROVAL_INSTANCE_STATUS.WITHDRAWN,
    ])
    .optional(),
  eventType: stringOrStringArray,
  keyword: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const queryApprovalFlowSchema = paginationSchema.extend({
  eventType: stringOrStringArray,
  status: z.enum(['active', 'inactive', 'deleted']).optional(),
});

/** 查询版本历史 - @no-pagination: 按 groupId 查询所有版本，无需分页 */
export const queryApprovalFlowHistorySchema = z.object({
  groupId: z.string().min(1),
});

// ============ Response Schemas ============

/**
 * 审批流程节点响应 Schema
 */
export const approvalFlowNodeResponseSchema = z.object({
  id: z.string().uuid(),
  flowId: z.string().uuid(),
  nodeOrder: z.number().int(),
  nodeName: z.string(),
  approverType: z.string(),
  approverUserIds: z.array(z.string()),
  approverRoleId: z.string().optional().nullable(),
  managerLevel: z.number().int(),
  multiType: z.string(),
  timeoutHours: z.number().int().optional().nullable(),
  createdAt: z.string(),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int(),
});

export type ApprovalFlowNodeResponseOutput = z.infer<typeof approvalFlowNodeResponseSchema>;

/**
 * 审批流程响应 Schema（含节点）
 *
 * 列 meta 由 withColumn 附在字段上，供前端 deriveColumnsFromSchema 消费。
 * `nodes` 是数组，不挂 meta；页面 overrides 自定义"节点数"渲染。
 */
export const approvalFlowResponseSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string(),
  code: withColumn(z.string(), {
    label: '流程编码',
    width: 120,
    type: 'custom', // font-mono muted
  }),
  name: withColumn(z.string(), {
    label: '流程名称',
    minWidth: 180,
    sortable: true,
    type: 'text',
    required: true,
  }),
  eventType: withColumn(z.string(), {
    label: '事件类型',
    width: COL_STATUS,
    type: 'custom', // Badge variant=info
  }),
  description: withColumn(z.string().optional().nullable(), {
    label: '描述',
    minWidth: 180,
    type: 'custom', // 30 字截断
  }),
  version: withColumn(z.number().int(), {
    label: '版本',
    width: COL_STATUS_SM,
    type: 'custom', // Badge font-mono v1.0
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    type: 'custom', // Badge 激活/草稿
  }),
  copyToIds: withColumn(z.array(z.string()), {
    label: '抄送人数',
    width: COL_STATUS_SM,
    type: 'custom', // length
  }),
  createdAt: withColumn(z.string(), {
    label: '更新时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  createdByName: z.string().optional().nullable(),
  nodes: z.array(approvalFlowNodeResponseSchema).optional(),
});

export type ApprovalFlowResponseOutput = z.infer<typeof approvalFlowResponseSchema>;

/**
 * 审批记录响应 Schema
 */
export const approvalRecordResponseSchema = z.object({
  id: z.string().uuid(),
  instanceId: z.string().uuid(),
  nodeOrder: z.number().int(),
  nodeName: z.string().optional().nullable(),
  operatorId: z.string(),
  operatorName: z.string(),
  action: z.string(),
  result: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),
  createdAt: z.string().optional(),
});

export type ApprovalRecordResponseOutput = z.infer<typeof approvalRecordResponseSchema>;

/**
 * 审批任务响应 Schema
 *
 * 列 meta 附在 task 自身的字段上（`nodeName`/`status`/`createdAt`/`actionTime`），
 * 供 ApprovalsPage 的 pending/completed Tab 派生列定义。
 * task 行展示的 `title`/`eventType`/`initiatorName` 来自 nested `instance.*`，
 * 不在本 schema 顶层，由页面侧作为虚拟列处理。
 */
export const approvalTaskResponseSchema = z.object({
  id: z.string().uuid(),
  instanceId: z.string().uuid(),
  nodeOrder: z.number().int(),
  nodeName: withColumn(z.string(), {
    label: '当前节点',
    width: 120,
    type: 'text',
  }),
  approverId: z.string(),
  approverName: z.string(),
  approverType: z.string(),
  sequence: z.number().int(),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    type: 'custom', // Badge 动态 variant
  }),
  comment: z.string().optional().nullable(),
  actionTime: withColumn(z.string().optional().nullable(), {
    label: '处理时间',
    width: COL_DATETIME,
    type: 'datetime', // yyyy-MM-dd HH:mm
  }),
  dingtalkTodoTaskId: z.string().optional().nullable(),
  dingtalkTodoSourceId: z.string().optional().nullable(),
  dingtalkTodoCreatorUnionId: z.string().optional().nullable(),
  dingtalkTodoCreatedAt: z.string().optional().nullable(),
  dingtalkTodoDoneAt: z.string().optional().nullable(),
  createdAt: withColumn(z.string(), {
    label: '创建时间',
    width: COL_DATETIME,
    type: 'datetime', // yyyy-MM-dd HH:mm
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int(),
});

export type ApprovalTaskResponseOutput = z.infer<typeof approvalTaskResponseSchema>;

/** 流程简要信息（嵌套在 instance 中） */
const flowBriefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
});

/**
 * 审批实例响应 Schema（含关联数据）
 *
 * 列 meta 附在字段上，供 instance 列表（抄送/我发起/全部）派生。
 * `progress` 列由 `currentNode`/`totalNodes` 拼接，页面 overrides 自定义；
 * 这里仅给 `currentNode` 挂 meta 作为占位。
 */
export const approvalInstanceResponseSchema = z.object({
  id: z.string().uuid(),
  code: withColumn(z.string(), {
    label: '审批编号',
    width: 120,
    type: 'custom', // font-mono muted
  }),
  flowId: z.string().uuid(),
  flowVersion: z.number().int(),
  eventType: withColumn(z.string(), {
    label: '类型',
    width: 120,
    type: 'custom', // Badge variant=outline
  }),
  formId: z.string(),
  formCode: z.string(),
  /** 提交时业务目标版本；legacy NULL 审批终态操作 fail-closed。 */
  targetVersion: z.number().int().positive().optional().nullable(),
  title: withColumn(z.string(), {
    label: '审批标题',
    minWidth: 180,
    type: 'custom', // 加粗
    required: true,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    type: 'custom', // Badge 动态 variant
  }),
  currentNode: withColumn(z.number().int(), {
    label: '进度',
    width: COL_PERCENT,
    type: 'custom', // currentNode/totalNodes
  }),
  totalNodes: z.number().int(),
  initiatorId: z.string(),
  initiatorName: withColumn(z.string(), {
    label: '发起人',
    width: 100,
    type: 'text',
  }),
  copyToIds: withColumn(z.array(z.string()), {
    label: '抄送人数',
    width: COL_STATUS_SM,
    type: 'custom', // length
  }),
  completedAt: withColumn(z.string().optional().nullable(), {
    label: '完成时间',
    width: COL_DATETIME,
    type: 'datetime', // yyyy-MM-dd HH:mm
  }),
  createdAt: withColumn(z.string(), {
    label: '提交时间',
    width: COL_DATETIME,
    type: 'datetime', // yyyy-MM-dd HH:mm
  }),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().int(),
  flow: flowBriefSchema.optional(),
  tasks: z.array(approvalTaskResponseSchema).optional(),
  records: z.array(approvalRecordResponseSchema).optional(),
});

export type ApprovalInstanceResponseOutput = z.infer<typeof approvalInstanceResponseSchema>;

// 审批模块状态响应（GET /approval-flows/module-status）
export const approvalModuleStatusItemSchema = z.object({
  eventType: z.string(),
  label: z.string(),
  category: z.string(),
  categoryLabel: z.string(),
  sortOrder: z.number(),
  enabled: z.boolean(),
  hasFlows: z.boolean(),
  activeFlow: z
    .object({
      id: z.string(),
      name: z.string(),
      version: z.number(),
    })
    .nullable(),
});

export const approvalModuleStatusListSchema = z.array(approvalModuleStatusItemSchema);

export type ApprovalModuleStatusItemOutput = z.infer<typeof approvalModuleStatusItemSchema>;
export type ApprovalModuleStatusListOutput = z.infer<typeof approvalModuleStatusListSchema>;
export type BatchApproveInput = z.infer<typeof batchApproveSchema>;
export type ApprovalActionInput = z.infer<typeof approvalActionSchema>;
export type ApprovalActionSideEffectsInput = z.infer<typeof approvalActionSideEffectsSchema>;
export type WithdrawApprovalInput = z.infer<typeof withdrawApprovalSchema>;
