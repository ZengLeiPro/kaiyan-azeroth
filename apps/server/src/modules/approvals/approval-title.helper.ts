import { APPROVAL_EVENT_TYPE, type ApprovalEventTypeValue } from '@ky-azeroth/shared/constants';

const TITLE_MAX_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function getApprovalFormCode(record: Record<string, unknown>): string {
  const serialNumber = getString(record, 'serialNumber');
  if (serialNumber) return serialNumber;

  return getString(record, 'id').slice(0, 50);
}

function getString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}

function getRelatedString(
  record: Record<string, unknown>,
  relationKey: string,
  fieldKey: string
): string {
  const relation = record[relationKey];
  return isRecord(relation) ? getString(relation, fieldKey) : '';
}

function getCustomerName(record: Record<string, unknown>): string {
  return (
    getRelatedString(record, 'customer', 'shortName') ||
    getRelatedString(record, 'customer', 'customerName')
  );
}

function getContactName(record: Record<string, unknown>): string {
  return getRelatedString(record, 'contact', 'contactName');
}

function getSaleOrderCode(record: Record<string, unknown>): string {
  const code = getRelatedString(record, 'saleOrder', 'serialNumber');
  return code ? `订单${code}` : '';
}

function formatMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';

  return `￥${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric)}`;
}

function formatDate(value: unknown): string {
  if (!(value instanceof Date) && typeof value !== 'string') return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function joinTitleParts(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('｜')
    .slice(0, TITLE_MAX_LENGTH);
}

export function buildApprovalTitle(
  eventType: ApprovalEventTypeValue,
  record: Record<string, unknown>
): string {
  const formCode = getApprovalFormCode(record);

  switch (eventType) {
    case APPROVAL_EVENT_TYPE.INVOICE_APPROVE:
      return joinTitleParts(
        '开票申请',
        getString(record, 'title') || getCustomerName(record),
        formatMoney(record.invoiceAmount),
        getSaleOrderCode(record),
        formCode
      );
    case APPROVAL_EVENT_TYPE.PAYMENT_APPROVE:
      return joinTitleParts(
        '回款申请',
        getCustomerName(record),
        formatMoney(record.paymentAmount),
        getSaleOrderCode(record),
        formCode
      );
    case APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE:
      return joinTitleParts(
        '退款申请',
        getCustomerName(record),
        formatMoney(record.paymentAmount),
        getString(record, 'refundType'),
        getSaleOrderCode(record),
        formCode
      );
    case APPROVAL_EVENT_TYPE.VISIT_APPROVE:
      return joinTitleParts(
        '拜访申请',
        getCustomerName(record),
        getContactName(record),
        getString(record, 'visitType'),
        formatDate(record.signInTime),
        formCode
      );
    case APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE:
      return joinTitleParts(
        '合同订单审批',
        getString(record, 'orderTitle') || getCustomerName(record),
        formatMoney(record.orderAmount),
        formCode
      );
    default:
      return joinTitleParts('审批申请', formCode);
  }
}
