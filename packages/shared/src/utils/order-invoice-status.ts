import { ORDER_INVOICE_STATUS, type OrderInvoiceStatusValue } from '../constants/status-values';

/**
 * 由"已开票金额 + 订单金额"推导订单维度的开票状态。
 *
 * 口径：
 *   invoicedAmount <= 0                          → NOT_INVOICED
 *   orderAmount 为 null/0 且 invoicedAmount > 0  → FULLY_INVOICED（无金额对照）
 *   invoicedAmount >= orderAmount                → FULLY_INVOICED
 *   0 < invoicedAmount < orderAmount             → PARTIAL
 *
 * 注意：与 INVOICE_STATUS（发票自身的"正常/作废"）是不同维度，前者描述发票本身，
 * 后者描述订单整体的开票进度。
 */
export function deriveOrderInvoiceStatus(
  invoicedAmount: number,
  orderAmount: number | null | undefined
): OrderInvoiceStatusValue {
  if (!Number.isFinite(invoicedAmount) || invoicedAmount <= 0) {
    return ORDER_INVOICE_STATUS.NOT_INVOICED;
  }
  if (orderAmount == null || !Number.isFinite(orderAmount) || orderAmount <= 0) {
    return ORDER_INVOICE_STATUS.FULLY_INVOICED;
  }
  if (invoicedAmount >= orderAmount) {
    return ORDER_INVOICE_STATUS.FULLY_INVOICED;
  }
  return ORDER_INVOICE_STATUS.PARTIAL;
}
