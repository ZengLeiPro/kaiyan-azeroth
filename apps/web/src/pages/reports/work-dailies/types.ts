import { createCrmWorkDailySchema } from '@ky-azeroth/shared/schemas/crm-work-daily';
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import type {
  ICreateCrmWorkDaily,
  ICrmWorkDailyResponse,
} from '@ky-azeroth/shared/types/crm-work-daily';

import { extractDatePart } from '@/lib/date-utils';

export type { IAttachment };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CrmWorkDailyProfile extends ICrmWorkDailyResponse {}

export interface CrmWorkDailyFormData extends ICreateCrmWorkDaily {
  version?: number;
}

export const crmWorkDailyFormSchema = createCrmWorkDailySchema;

/**
 * API 响应 -> 前端展示对象
 */
export function toCrmWorkDailyProfile(data: ICrmWorkDailyResponse): CrmWorkDailyProfile {
  return {
    ...data,
  };
}

/**
 * 响应/展示 -> 表单数据
 */
export function toCrmWorkDailyFormData(data: CrmWorkDailyProfile): CrmWorkDailyFormData {
  return {
    reportDate: extractDatePart(data.reportDate) || null,
    reportType: data.reportType ?? null,
    submitStatus: data.submitStatus ?? null,
    senderId: data.senderId ?? null,
    keyCustomerSummary: data.keyCustomerSummary ?? null,
    tomorrowVisitPlan: data.tomorrowVisitPlan ?? null,
    otherPlanArrangements: data.otherPlanArrangements ?? null,
    coordinationItems: data.coordinationItems ?? null,
    callsMadeCount: data.callsMadeCount ?? null,
    callsConnectedCount: data.callsConnectedCount ?? null,
    callsOver30sCount: data.callsOver30sCount ?? null,
    totalCallMinutes: data.totalCallMinutes ?? null,
    visitCustomerCount: data.visitCustomerCount ?? null,
    newCustomerCount: data.newCustomerCount ?? null,
    newContactMethodCount: data.newContactMethodCount ?? null,
    attachments: data.attachments ?? null,
    remark: data.remark ?? null,
    version: data.version,
  };
}

/**
 * 表单数据 -> API 提交 payload
 */
export function toCrmWorkDailyPayload(form: CrmWorkDailyFormData) {
  return {
    reportDate: form.reportDate || null,
    reportType: form.reportType || null,
    submitStatus: form.submitStatus || null,
    senderId: form.senderId || null,
    keyCustomerSummary: form.keyCustomerSummary || null,
    tomorrowVisitPlan: form.tomorrowVisitPlan || null,
    otherPlanArrangements: form.otherPlanArrangements || null,
    coordinationItems: form.coordinationItems || null,
    callsMadeCount: form.callsMadeCount ?? null,
    callsConnectedCount: form.callsConnectedCount ?? null,
    callsOver30sCount: form.callsOver30sCount ?? null,
    totalCallMinutes: form.totalCallMinutes ?? null,
    visitCustomerCount: form.visitCustomerCount ?? null,
    newCustomerCount: form.newCustomerCount ?? null,
    newContactMethodCount: form.newContactMethodCount ?? null,
    attachments: form.attachments || null,
    remark: form.remark || null,
    version: form.version,
  };
}
