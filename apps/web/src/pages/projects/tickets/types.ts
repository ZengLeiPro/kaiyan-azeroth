import { createProjectTicketSchema } from '@ky-azeroth/shared/schemas/project-ticket';
import type {
  ICreateProjectTicket,
  IProjectTicketResponse,
} from '@ky-azeroth/shared/types/project-ticket';

import { extractDatePart } from '@/lib/date-utils';

/**
 * 项目工单前端展示类型（强绑定 IProjectTicketResponse）
 */
export interface ProjectTicketProfile extends IProjectTicketResponse {
  /** 关联客户名称（前端扩展字段） */
  customerName?: string;
}

/**
 * 项目工单表单数据类型
 */
export interface ProjectTicketFormData extends ICreateProjectTicket {
  version?: number;
}

/**
 * 项目工单表单校验 Schema（直接使用 shared）
 */
export const projectTicketFormSchema = createProjectTicketSchema;

/**
 * 新建工单时的初始表单数据
 */
export const initialProjectTicketFormData: ProjectTicketFormData = {
  projectId: '',
  title: '',
  description: '',
  ticketType: 'REQUIREMENT',
  priority: 'MEDIUM',
  assigneeId: '',
  dueDate: null,
  attachments: null,
};

/**
 * API 响应 -> 前端展示
 */
export function toProjectTicketProfile(data: IProjectTicketResponse): ProjectTicketProfile {
  return {
    ...data,
    dueDate: extractDatePart(data.dueDate),
    customerName: data.project?.customerName ?? undefined,
  };
}

/**
 * 展示/响应 -> 表单数据
 */
export function toProjectTicketFormData(entity: ProjectTicketProfile): ProjectTicketFormData {
  return {
    projectId: entity.projectId,
    title: entity.title,
    description: entity.description,
    ticketType: entity.ticketType,
    priority: entity.priority,
    assigneeId: entity.assigneeId,
    dueDate: entity.dueDate ?? null,
    attachments: entity.attachments ?? null,
    version: entity.version,
  };
}

/**
 * 表单 -> API payload
 */
export function toProjectTicketPayload(form: ProjectTicketFormData) {
  return {
    projectId: form.projectId,
    title: form.title.trim(),
    description: form.description.trim(),
    ticketType: form.ticketType,
    priority: form.priority,
    assigneeId: form.assigneeId,
    dueDate: form.dueDate || null,
    attachments: form.attachments && form.attachments.length > 0 ? form.attachments : null,
    version: form.version,
  };
}
