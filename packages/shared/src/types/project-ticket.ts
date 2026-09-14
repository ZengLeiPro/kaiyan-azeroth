import type { IAttachment } from './common';

/**
 * 项目工单实体
 */
export interface IProjectTicket {
  id: string;
  ticketNo: string;
  projectId: string;
  title: string;
  description: string;
  ticketType: string;
  priority: string;
  status: string;
  dispatcherId: string;
  assigneeId: string;
  dueDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  closedAt?: string | null;
  cancelledAt?: string | null;
  completionNote?: string | null;
  closeNote?: string | null;
  cancelReason?: string | null;
  attachments?: IAttachment[] | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  version?: number;
}

/**
 * 关联项目简要信息
 */
export interface IProjectTicketProjectInfo {
  id: string;
  name: string;
  customerName?: string | null;
}

/**
 * 关联员工简要信息（派单人 / 接单人）
 */
export interface IProjectTicketEmployeeInfo {
  id: string;
  name: string;
}

/**
 * 项目工单 API 响应类型
 */
export interface IProjectTicketResponse extends Omit<IProjectTicket, 'version'> {
  version: number;
  project?: IProjectTicketProjectInfo;
  dispatcher?: IProjectTicketEmployeeInfo;
  assignee?: IProjectTicketEmployeeInfo;
  /** 派生字段：dueDate < now && status in [PENDING, IN_PROGRESS] */
  isOverdue?: boolean;
}

/**
 * 创建项目工单契约
 */
export interface ICreateProjectTicket {
  projectId: string;
  title: string;
  description: string;
  ticketType: string;
  priority: string;
  assigneeId: string;
  dueDate?: string | null;
  attachments?: IAttachment[] | null;
}

/**
 * 更新项目工单契约（projectId 不可改）
 */
export type IUpdateProjectTicket = Partial<Omit<ICreateProjectTicket, 'projectId'>> & {
  version: number;
};

/**
 * 状态流转契约
 */
export interface ITransitionProjectTicket {
  toStatus: string;
  completionNote?: string | null;
  closeNote?: string | null;
  cancelReason?: string | null;
  version: number;
}

/**
 * 改派契约
 */
export interface IReassignProjectTicket {
  assigneeId: string;
  version: number;
}

/**
 * 项目工单统计聚合
 */
export interface IProjectTicketStats {
  pending: number;
  inProgress: number;
  completed: number;
  closed: number;
  cancelled: number;
  overdue: number;
  myTodoCount: number;
}
