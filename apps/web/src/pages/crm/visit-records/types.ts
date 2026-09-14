import { createVisitRecordSchema } from '@ky-azeroth/shared/schemas/visit-record';
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import type {
  ICreateVisitRecord,
  IVisitRecordResponse,
} from '@ky-azeroth/shared/types/visit-record';
import { z } from 'zod';

import { isoToLocalInput, localInputToIso } from '@/lib/date-utils';

export type { IAttachment };

export interface VisitRecordProfile extends IVisitRecordResponse {
  customerName: string;
  contactName: string;
}

/**
 * 表单中间态：必填字段允许暂时为空（null），提交时由 createVisitRecordSchema 强制校验。
 */
export interface VisitRecordFormData extends Omit<
  ICreateVisitRecord,
  | 'contactId'
  | 'visitType'
  | 'content'
  | 'signInTime'
  | 'signAddress'
  | 'attachments'
  | 'chargerId'
  | 'signLocation'
> {
  contactId: string | null;
  visitType: string | null;
  content: string | null;
  signInTime: string | null;
  signAddress: string | null;
  /** GPS 原始坐标 "lng,lat"，签到时自动写入；表单中间态允许 undefined */
  signLocation?: string | null;
  attachments: IAttachment[] | null;
  chargerId: string | null;
  version?: number;
}

const localDateTimeInputSchema = z
  .string({ required_error: '请选择签到时间' })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, '请选择有效拜访时间');

const localDateTimeInputSchemaOptional = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, '请选择有效拜访时间')
  .optional()
  .nullable();

export const visitRecordFormSchema = createVisitRecordSchema.extend({
  signInTime: localDateTimeInputSchema,
  signOutTime: localDateTimeInputSchemaOptional,
});

/**
 * API 响应 -> 前端展示对象
 */
export function toVisitRecordProfile(data: IVisitRecordResponse): VisitRecordProfile {
  return {
    ...data,
    customerName: data.customer?.customerName ?? '',
    contactName: data.contact?.contactName ?? '',
  };
}

/**
 * 响应/展示 -> 表单数据
 */
export function toVisitRecordFormData(data: VisitRecordProfile): VisitRecordFormData {
  return {
    customerId: data.customerId,
    contactId: data.contactId ?? null,
    visitType: data.visitType ?? null,
    content: data.content ?? null,
    signInTime: data.signInTime ? isoToLocalInput(data.signInTime) : null,
    signOutTime: data.signOutTime ? isoToLocalInput(data.signOutTime) : null,
    signAddress: data.signAddress ?? null,
    signLocation: data.signLocation ?? null,
    duration: data.duration ?? null,
    visitStatus: data.visitStatus ?? null,
    attachments: data.attachments ?? null,
    chargerId: data.chargerId ?? null,
    version: data.version,
  };
}

/**
 * 表单数据 -> API 提交 payload
 */
export function toVisitRecordPayload(form: VisitRecordFormData) {
  return {
    customerId: form.customerId,
    contactId: form.contactId || null,
    visitType: form.visitType || null,
    content: form.content || null,
    signInTime: localInputToIso(form.signInTime),
    signOutTime: localInputToIso(form.signOutTime),
    signAddress: form.signAddress || null,
    signLocation: form.signLocation || null,
    duration: form.duration ?? null,
    visitStatus: form.visitStatus || null,
    attachments: form.attachments || null,
    chargerId: form.chargerId || null,
    version: form.version,
  };
}
