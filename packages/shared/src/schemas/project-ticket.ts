import { z } from 'zod';

import {
  PROJECT_TICKET_PRIORITY_VALUES,
  PROJECT_TICKET_STATUS_VALUES,
  PROJECT_TICKET_TYPE_VALUES,
  PROJECT_TICKET_VIEW,
  PROJECT_TICKET_VIEW_VALUES,
} from '../constants/project-ticket-constants';
import { withColumn } from './column-meta';
import { COL_DATE, COL_DATETIME, COL_SERIAL, COL_STATUS } from './column-widths';
import {
  attachmentSchema,
  paginationSchema,
  stringOrStringArray,
  stringOrStringArrayOfUuid,
} from './common';

/**
 * 宽容但严格的日期字符串校验：
 * - 拒绝空串与无效值（isNaN）
 * - 接受 YYYY-MM-DD 与 ISO 8601 datetime 两种前端常见格式
 */
const dateStringSchema = z
  .string()
  .refine((v) => v.length > 0 && !Number.isNaN(new Date(v).getTime()), {
    message: '日期格式不正确',
  });

/**
 * 创建项目工单 Schema
 */
export const createProjectTicketSchema = z.object({
  projectId: z.string().uuid('项目ID格式不正确'),
  title: z.string().min(1, '请填写标题').max(200, '标题最多200个字符'),
  description: z.string().min(1, '请填写描述').max(10000, '描述最多10000个字符'),
  ticketType: z.enum(PROJECT_TICKET_TYPE_VALUES, { message: '无效的工单类型' }),
  priority: z.enum(PROJECT_TICKET_PRIORITY_VALUES, { message: '无效的优先级' }),
  assigneeId: z.string().uuid('接单人ID格式不正确'),
  dueDate: dateStringSchema.optional().nullable(),
  attachments: z.array(attachmentSchema).optional().nullable(),
});

/**
 * 更新项目工单 Schema（projectId 不可改；带 version 乐观锁）
 */
export const updateProjectTicketSchema = createProjectTicketSchema
  .omit({ projectId: true })
  .partial()
  .extend({
    version: z.number().int().min(1),
  });

/**
 * 状态流转 Schema
 */
export const transitionProjectTicketSchema = z.object({
  toStatus: z.enum(PROJECT_TICKET_STATUS_VALUES, { message: '无效的目标状态' }),
  completionNote: z.string().optional().nullable(),
  closeNote: z.string().optional().nullable(),
  cancelReason: z.string().optional().nullable(),
  version: z.number().int().min(1),
});

/**
 * 改派 Schema
 */
export const reassignProjectTicketSchema = z.object({
  assigneeId: z.string().uuid('接单人ID格式不正确'),
  version: z.number().int().min(1),
});

/**
 * 查询项目工单 Schema
 */
export const queryProjectTicketSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  view: z.enum(PROJECT_TICKET_VIEW_VALUES).default(PROJECT_TICKET_VIEW.ALL),
  projectId: stringOrStringArrayOfUuid,
  assigneeId: z.string().optional(),
  dispatcherId: z.string().optional(),
  status: stringOrStringArray,
  ticketType: stringOrStringArray,
  priority: stringOrStringArray,
  dueDateFrom: dateStringSchema.optional(),
  dueDateTo: dateStringSchema.optional(),
  isOverdue: z.coerce.boolean().optional(),
});

/**
 * 项目工单关联项目简要 Schema
 */
export const projectTicketProjectInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  customerName: z.string().optional().nullable(),
});

/**
 * 项目工单关联员工简要 Schema
 */
export const projectTicketEmployeeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * 项目工单响应 Schema
 *
 * 字段上通过 `withColumn(...)` 附加列 UI 元数据，供前端 `deriveColumnsFromSchema`
 * 派生表格列。自定义 Badge / 穿透 / 复合渲染（title+project 组合、dueDate 逾期高亮）
 * 在 ProjectTicketsPage 以 overrides 保留。
 *
 * 注：`customerName` 是前端 `transformData` 从 `project.customerName` 展平的视图字段，
 * 作为可选字段登记以获得列 meta；后端返回时可能没有这个字段。
 */
export const projectTicketResponseSchema = z.object({
  id: z.string(),
  ticketNo: withColumn(z.string(), {
    label: '编号',
    width: COL_SERIAL,
    type: 'serialNumber',
    required: true,
    order: 10,
  }),
  projectId: z.string(),
  title: withColumn(z.string(), {
    label: '标题',
    minWidth: 260,
    sortable: true,
    type: 'custom',
    required: true,
    order: 20,
  }),
  customerName: withColumn(z.string().optional().nullable(), {
    label: '客户',
    type: 'custom',
    order: 25,
  }),
  description: z.string(),
  ticketType: withColumn(z.string(), {
    label: '类型',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'ticketType',
    order: 30,
  }),
  priority: withColumn(z.string(), {
    label: '优先级',
    width: COL_STATUS,
    type: 'statusBadge',
    statusMapKey: 'ticketPriority',
    order: 40,
  }),
  status: withColumn(z.string(), {
    label: '状态',
    width: COL_STATUS,
    sortable: true,
    type: 'statusBadge',
    statusMapKey: 'ticketStatus',
    order: 50,
  }),
  dispatcherId: z.string(),
  assigneeId: z.string(),
  dueDate: withColumn(z.string().optional().nullable(), {
    label: '截止时间',
    width: COL_DATE,
    sortable: true,
    type: 'custom',
    order: 80,
  }),
  startedAt: z.string().optional().nullable(),
  completedAt: z.string().optional().nullable(),
  closedAt: z.string().optional().nullable(),
  cancelledAt: z.string().optional().nullable(),
  completionNote: z.string().optional().nullable(),
  closeNote: z.string().optional().nullable(),
  cancelReason: z.string().optional().nullable(),
  attachments: z.array(attachmentSchema).optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: withColumn(z.string().optional(), {
    label: '更新时间',
    width: COL_DATETIME,
    sortable: true,
    type: 'datetime',
    order: 90,
  }),
  deletedAt: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  updatedBy: z.string().optional().nullable(),
  version: z.number().int().min(1),
  project: projectTicketProjectInfoSchema.optional(),
  dispatcher: withColumn(projectTicketEmployeeInfoSchema.optional(), {
    label: '派单人',
    width: 120,
    type: 'custom',
    order: 70,
  }),
  assignee: withColumn(projectTicketEmployeeInfoSchema.optional(), {
    label: '接单人',
    width: 120,
    type: 'custom',
    order: 60,
  }),
  isOverdue: z.boolean().optional(),
});

/**
 * 项目工单统计响应 Schema
 */
export const projectTicketStatsResponseSchema = z.object({
  pending: z.number(),
  inProgress: z.number(),
  completed: z.number(),
  closed: z.number(),
  cancelled: z.number(),
  overdue: z.number(),
  myTodoCount: z.number(),
});

export type CreateProjectTicketInput = z.infer<typeof createProjectTicketSchema>;
export type UpdateProjectTicketInput = z.infer<typeof updateProjectTicketSchema>;
export type TransitionProjectTicketInput = z.infer<typeof transitionProjectTicketSchema>;
export type ReassignProjectTicketInput = z.infer<typeof reassignProjectTicketSchema>;
export type QueryProjectTicketInput = z.infer<typeof queryProjectTicketSchema>;
export type ProjectTicketProjectInfoOutput = z.infer<typeof projectTicketProjectInfoSchema>;
export type ProjectTicketEmployeeInfoOutput = z.infer<typeof projectTicketEmployeeInfoSchema>;
export type ProjectTicketResponseOutput = z.infer<typeof projectTicketResponseSchema>;
export type ProjectTicketStatsResponseOutput = z.infer<typeof projectTicketStatsResponseSchema>;
