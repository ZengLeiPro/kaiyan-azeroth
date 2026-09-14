import type { IAttachment } from './common';

/**
 * CRM 日报实体
 */
export interface ICrmWorkDaily {
  id: string;
  reportDate: string | null;
  reportType: string | null;
  submitStatus: string | null;
  senderId: string | null;
  senderName: string | null;
  keyCustomerSummary: string | null;
  tomorrowVisitPlan: string | null;
  otherPlanArrangements: string | null;
  coordinationItems: string | null;
  callsMadeCount: number | null;
  callsConnectedCount: number | null;
  callsOver30sCount: number | null;
  totalCallMinutes: number | null;
  visitCustomerCount: number | null;
  newCustomerCount: number | null;
  newContactMethodCount: number | null;
  attachments: IAttachment[] | null;
  remark: string | null;
  flowStatus: string | null;
  status: string;
  // 审计
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}

/**
 * CRM 日报 API 响应类型
 */

export interface ICrmWorkDailyResponse extends ICrmWorkDaily {}

/**
 * 创建 CRM 日报接口契约
 */
export interface ICreateCrmWorkDaily {
  reportDate?: string | null;
  reportType?: string | null;
  submitStatus?: string | null;
  senderId?: string | null;
  keyCustomerSummary?: string | null;
  tomorrowVisitPlan?: string | null;
  otherPlanArrangements?: string | null;
  coordinationItems?: string | null;
  callsMadeCount?: number | null;
  callsConnectedCount?: number | null;
  callsOver30sCount?: number | null;
  totalCallMinutes?: number | null;
  visitCustomerCount?: number | null;
  newCustomerCount?: number | null;
  newContactMethodCount?: number | null;
  attachments?: IAttachment[] | null;
  remark?: string | null;
}

/**
 * 更新 CRM 日报接口契约
 */
export type IUpdateCrmWorkDaily = Partial<ICreateCrmWorkDaily>;
