import { format } from 'date-fns';

export function buildSaleOrderBulkEditPayload(
  orderIds: string[],
  versions: Record<string, number>,
  patch: Record<string, string>
) {
  return { ids: orderIds, versions, patch };
}

export function buildSaleOrderBulkTransferPayload(
  orderIds: string[],
  versions: Record<string, number>,
  chargerId: string
) {
  return { ids: orderIds, versions, chargerId };
}

export function toSaleOrderBulkDateOnly(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
