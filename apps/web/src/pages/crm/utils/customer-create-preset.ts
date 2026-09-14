import type { Dispatch, SetStateAction } from 'react';

import type { FilterValue } from '@/hooks/use-manual-filter';

const CUSTOMER_FILTER_KEYS = new Set([
  'customerId',
  'customerIds',
  'filters[customerId]',
  'filters[customerId][]',
  'filters.customerId',
]);

function isCustomerFilterKey(key: string) {
  return CUSTOMER_FILTER_KEYS.has(key);
}

function addCustomerId(ids: Set<string>, value: string) {
  const normalized = value.trim();
  if (normalized) {
    ids.add(normalized);
  }
}

export function getSingleCustomerIdFromFilters(filters: Record<string, FilterValue>) {
  const ids = new Set<string>();

  for (const [key, value] of Object.entries(filters)) {
    if (!isCustomerFilterKey(key)) continue;

    if (Array.isArray(value)) {
      value.forEach((item) => addCustomerId(ids, item));
    } else {
      addCustomerId(ids, value);
    }
  }

  if (ids.size !== 1) return null;
  return Array.from(ids)[0];
}

export function openCreateWithCustomerPreset<TFormData extends { customerId?: string | null }>(
  filters: Record<string, FilterValue>,
  openCreateDialog: () => void,
  setFormData: Dispatch<SetStateAction<TFormData>>
) {
  const customerId = getSingleCustomerIdFromFilters(filters);
  openCreateDialog();

  if (!customerId) return;

  setFormData((prev) => ({
    ...prev,
    customerId,
  }));
}
