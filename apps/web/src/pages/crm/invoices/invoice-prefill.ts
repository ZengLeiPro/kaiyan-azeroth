import type { InvoiceFormData } from './types';

export const INVOICE_PREFILL_FIELDS = [
  'invoiceType',
  'title',
  'taxIdentifyNum',
  'itemType',
  'bankName',
  'bankAccount',
  'registeredAddress',
  'registeredPhone',
] as const;

export type InvoicePrefillField = (typeof INVOICE_PREFILL_FIELDS)[number];
export type InvoicePrefillValues = Pick<InvoiceFormData, InvoicePrefillField>;

type InvoicePrefillSource = Partial<Record<InvoicePrefillField, string | null | undefined>>;

function isBlankPrefillValue(value: string | null | undefined) {
  return value == null || value.trim() === '';
}

function isSamePrefillValue(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '') === (b ?? '');
}

export function extractInvoicePrefillValues(source: InvoicePrefillSource): InvoicePrefillValues {
  return INVOICE_PREFILL_FIELDS.reduce((acc, field) => {
    acc[field] = source[field] ?? null;
    return acc;
  }, {} as InvoicePrefillValues);
}

export function hasInvoicePrefillValues(source: InvoicePrefillSource) {
  return INVOICE_PREFILL_FIELDS.some((field) => !isBlankPrefillValue(source[field]));
}

export function buildInvoicePrefillUpdates(
  current: InvoiceFormData,
  template: InvoicePrefillValues,
  previousTemplate?: InvoicePrefillValues | null
): Partial<InvoicePrefillValues> {
  return INVOICE_PREFILL_FIELDS.reduce((updates, field) => {
    const nextValue = template[field];
    if (isBlankPrefillValue(nextValue)) return updates;

    const currentValue = current[field];
    const canOverwrite =
      isBlankPrefillValue(currentValue) ||
      Boolean(previousTemplate && isSamePrefillValue(currentValue, previousTemplate[field]));

    if (canOverwrite && !isSamePrefillValue(currentValue, nextValue)) {
      updates[field] = nextValue;
    }

    return updates;
  }, {} as Partial<InvoicePrefillValues>);
}

export function buildInvoicePrefillClears(
  current: InvoiceFormData,
  previousTemplate: InvoicePrefillValues
): Partial<InvoicePrefillValues> {
  return INVOICE_PREFILL_FIELDS.reduce((updates, field) => {
    if (
      !isBlankPrefillValue(previousTemplate[field]) &&
      isSamePrefillValue(current[field], previousTemplate[field])
    ) {
      updates[field] = null;
    }
    return updates;
  }, {} as Partial<InvoicePrefillValues>);
}
