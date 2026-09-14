import { createInvoiceSchema } from '@ky-azeroth/shared/schemas/invoice';
import type { ICreateInvoice, IInvoiceResponse } from '@ky-azeroth/shared/types/invoice';
import { formatDateString, toAPIDateString } from '@ky-azeroth/shared/utils';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InvoiceProfile extends IInvoiceResponse {}

/**
 * 表单中间态允许 invoiceType/invoiceDate 暂时为空，
 * 提交时由 createInvoiceSchema 强制校验。
 */
export interface InvoiceFormData extends Omit<ICreateInvoice, 'invoiceType' | 'invoiceDate'> {
  invoiceType: string | null;
  invoiceDate: string | null;
  version?: number;
}

export const invoiceFormSchema = createInvoiceSchema;

const INVOICE_SUBJECT_SEPARATOR = '、';

export function parseInvoiceSubjects(subject: string | null | undefined): string[] {
  if (!subject) return [];

  return [
    ...new Set(
      subject
        .split(/[、,，]/)
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

export function serializeInvoiceSubjects(subjects: string[]): string {
  return [...new Set(subjects.map((value) => value.trim()).filter(Boolean))].join(
    INVOICE_SUBJECT_SEPARATOR
  );
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const formatted = formatDateString(value);
  return formatted || null;
}

/**
 * API 响应 -> 前端展示对象
 */
export function toInvoiceProfile(data: IInvoiceResponse): InvoiceProfile {
  return {
    ...data,
    invoiceDate: normalizeDateOnly(data.invoiceDate),
  };
}

/**
 * 响应/展示 -> 表单数据
 */
export function toInvoiceFormData(data: InvoiceProfile): InvoiceFormData {
  return {
    saleOrderId: data.saleOrderId,
    customerId: data.customerId,
    subject: data.subject ?? '',
    invoiceAmount: Number(data.invoiceAmount),
    invoiceType: data.invoiceType ?? null,
    invoiceDate: normalizeDateOnly(data.invoiceDate),
    invoiceNumber: data.invoiceNumber ?? null,
    title: data.title ?? null,
    taxIdentifyNum: data.taxIdentifyNum ?? null,
    invoiceStatus: data.invoiceStatus ?? null,
    itemType: data.itemType ?? null,
    bankName: data.bankName ?? null,
    bankAccount: data.bankAccount ?? null,
    registeredAddress: data.registeredAddress ?? null,
    registeredPhone: data.registeredPhone ?? null,
    remark: data.remark ?? null,
    version: data.version,
  };
}

/**
 * 表单数据 -> API 提交 payload
 */
export function toInvoicePayload(form: InvoiceFormData) {
  return {
    saleOrderId: form.saleOrderId,
    customerId: form.customerId || null,
    subject: form.subject,
    invoiceAmount: String(form.invoiceAmount),
    invoiceType: form.invoiceType || null,
    invoiceDate: toAPIDateString(form.invoiceDate),
    invoiceNumber: form.invoiceNumber || null,
    title: form.title || null,
    taxIdentifyNum: form.taxIdentifyNum || null,
    invoiceStatus: form.invoiceStatus || null,
    itemType: form.itemType || null,
    bankName: form.bankName?.trim() || null,
    bankAccount: form.bankAccount?.trim() || null,
    registeredAddress: form.registeredAddress?.trim() || null,
    registeredPhone: form.registeredPhone?.trim() || null,
    remark: form.remark || null,
    version: form.version,
  };
}
