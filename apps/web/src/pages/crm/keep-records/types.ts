import { keepRecordBaseSchema, validateIntentFields } from '@ky-azeroth/shared/schemas/keep-record';
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';
import type { ICreateKeepRecord, IKeepRecordResponse } from '@ky-azeroth/shared/types/keep-record';
import { z } from 'zod';

import { extractDatePart, isoToLocalInput, localInputToIso } from '@/lib/date-utils';

export type { IAttachment };

export interface KeepRecordProfile extends IKeepRecordResponse {
  customerName: string;
  contactName: string;
}

export interface KeepRecordFormData extends ICreateKeepRecord {
  version?: number;
}

const localDateTimeInputSchema = z
  .string()
  .min(1, '请选择跟进时间')
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, '请选择有效跟进时间');

export const keepRecordFormSchema = keepRecordBaseSchema
  .extend({ keepRecordTime: localDateTimeInputSchema })
  .superRefine(validateIntentFields);

/** 兼容旧响应中的 ISO 日期时间，客户预填与跟进编辑使用同一日期契约。 */
export function toKeepRecordIntentFormData(
  data: Pick<ICustomerResponse, 'intentTemperature' | 'intentReasons' | 'nextFollowUpAt'>
) {
  return {
    intentTemperature: data.intentTemperature ?? null,
    intentReasons: data.intentReasons ?? null,
    nextFollowUpAt: extractDatePart(data.nextFollowUpAt) || null,
  };
}

/**
 * API 响应 -> 前端展示对象
 */
export function toKeepRecordProfile(data: IKeepRecordResponse): KeepRecordProfile {
  return {
    ...data,
    customerName: data.customer?.customerName ?? '',
    contactName: data.contact?.contactName ?? '',
  };
}

/**
 * 响应/展示 -> 表单数据
 */
export function toKeepRecordFormData(data: KeepRecordProfile): KeepRecordFormData {
  return {
    customerId: data.customerId,
    contactId: data.contactId ?? null,
    keepRecordType: data.keepRecordType ?? '',
    keepRecordTime: data.keepRecordTime ? isoToLocalInput(data.keepRecordTime) : '',
    keepRecordContent: data.keepRecordContent ?? '',
    keepRecordStatus: data.keepRecordStatus ?? '',
    ...toKeepRecordIntentFormData(data),
    attachments: data.attachments ?? null,
    chargerId: data.chargerId ?? '',
    version: data.version,
  };
}

/**
 * 表单数据 -> API 提交 payload
 */
export function toKeepRecordPayload(form: KeepRecordFormData) {
  return {
    customerId: form.customerId,
    contactId: form.contactId || null,
    keepRecordType: form.keepRecordType,
    keepRecordTime: localInputToIso(form.keepRecordTime) ?? '',
    keepRecordContent: form.keepRecordContent,
    keepRecordStatus: form.keepRecordStatus,
    intentTemperature: form.intentTemperature ?? null,
    intentReasons: form.intentReasons ?? null,
    nextFollowUpAt: extractDatePart(form.nextFollowUpAt) || null,
    attachments: form.attachments || null,
    chargerId: form.chargerId,
    version: form.version,
  };
}
