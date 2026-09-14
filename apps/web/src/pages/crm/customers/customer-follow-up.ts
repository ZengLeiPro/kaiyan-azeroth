import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';

import { extractDatePart, formatDateToLocalDateString } from '@/lib/date-utils';

/** 回访按自然日判断：当天尚未结束不算逾期，保留回访日后已有跟进的排除语义。 */
export function isCustomerFollowUpOverdue(
  customer: Pick<ICustomerResponse, 'nextFollowUpAt' | 'lastKeepRecordTime'>,
  now = new Date()
): boolean {
  const dueDate = extractDatePart(customer.nextFollowUpAt);
  if (!dueDate || dueDate >= formatDateToLocalDateString(now)) return false;
  if (!customer.lastKeepRecordTime) return true;
  const lastKeepDate = formatDateToLocalDateString(new Date(customer.lastKeepRecordTime));
  return Boolean(lastKeepDate && lastKeepDate <= dueDate);
}
