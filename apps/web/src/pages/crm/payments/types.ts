import {
  PAYMENT_DIRECTION,
  PAYMENT_MODE,
  PAYMENT_MODE_VALUES_SALES,
} from '@ky-azeroth/shared/constants';
import {
  createPaymentRefundSchema,
  isPaymentItemAmountTotalValid,
  paymentInputFieldsSchema,
} from '@ky-azeroth/shared/schemas/payment';
import type {
  ICreatePayment,
  ICreatePaymentRefund,
  IPaymentItem,
  IPaymentResponse,
} from '@ky-azeroth/shared/types/payment';
import type { IOrderProductInfo, SaleOrderForSelection } from '@ky-azeroth/shared/types/sale-order';
import { formatDateString, toAPIDateString } from '@ky-azeroth/shared/utils';
import { z } from 'zod';

export interface PaymentProfile extends IPaymentResponse {
  items: IPaymentItem[];
}

export { getPaymentDisplayMeta } from '@/lib/payment-display';

/**
 * 前端表单中的 PaymentItem 行（v2.2 PR-B）
 *
 * 比 shared ICreatePaymentItemInput 多一个 tempId：用于 React key 稳定 + 增删行；
 * 提交时由 toPaymentPayload 剥离 tempId 返回 shared schema 兼容形式。
 */
export interface PaymentItemFormRow {
  tempId: string;
  saleOrderProductId: string;
  productName: string;
  /** 金额（前端用 number，提交时序列化为字符串） */
  amount: number;
  /** direct / dingtalk_collect / pass_through（PR-B 不开放 admin 调账专用 pass_through_cost） */
  paymentMode: string;
  financeSubjectId?: string | null;
  remark?: string | null;
}

export function createEmptyPaymentItemRow(): PaymentItemFormRow {
  return {
    tempId: `pi-${Math.random().toString(36).slice(2, 10)}`,
    saleOrderProductId: '',
    productName: '',
    amount: 0,
    paymentMode: PAYMENT_MODE.DIRECT,
    remark: null,
  };
}

/**
 * 新建回款关联合同时，将合同产品及其合同明细金额直接带入拆分明细。
 */
export function createPaymentItemRowsFromSaleOrderProducts(
  products: ReadonlyArray<
    Pick<IOrderProductInfo, 'id' | 'productName'> & {
      subtotalAmount?: string | number | null;
    }
  >
): PaymentItemFormRow[] {
  return products.map((product) => ({
    tempId: `pi-${product.id}`,
    saleOrderProductId: product.id,
    productName: product.productName,
    amount: Number(product.subtotalAmount ?? 0),
    paymentMode: PAYMENT_MODE.DIRECT,
    remark: null,
  }));
}

export interface PaymentFormData extends Omit<ICreatePayment, 'items'> {
  version?: number;
  items: PaymentItemFormRow[];
}

/**
 * 退款表单数据（OUT 方向）
 *
 * 与 PaymentFormData 的差异：
 * - refundType 必填
 * - relatedPaymentId 必填
 * - relatedInvoiceId 可选（同步触发冲红时填入）
 * - direction 固定 OUT，前端不再展示该字段
 */
export interface PaymentRefundFormData extends ICreatePaymentRefund {
  version?: number;
}

/**
 * 前端 PaymentItemFormRow zod schema（含 tempId）
 * 不在 shared 里维护，仅用于前端表单类型推断；提交时 toPaymentPayload 剥 tempId。
 * 金额加总等业务规则由 PaymentItemForm 子组件实时校验，不依赖此 schema 校验。
 */
const paymentItemFormRowSchema = z.object({
  tempId: z.string(),
  saleOrderProductId: z.string().min(1, '请选择订单产品'),
  productName: z.string(),
  amount: z.coerce.number().finite('金额必须是有限数字').positive('金额必须大于 0'),
  paymentMode: z.enum(PAYMENT_MODE_VALUES_SALES),
  financeSubjectId: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});

/**
 * 前端表单 schema：剔除 shared items 字段（PaymentItemInput 跟前端 PaymentItemFormRow
 * 多了 tempId 不兼容），换用前端 row schema；非空、正数与合计规则和 Shared 共用。
 */
export const paymentFormSchema = paymentInputFieldsSchema
  .omit({ items: true, direction: true })
  .extend({
    direction: z.enum([PAYMENT_DIRECTION.IN, PAYMENT_DIRECTION.OUT]).optional(),
    items: z.array(paymentItemFormRowSchema),
  })
  .superRefine((value, ctx) => {
    // OUT 退款不承载 PaymentItem；IN（含 direction 缺省的新建）必须完整拆分。
    if (value.direction === PAYMENT_DIRECTION.OUT) return;
    if (value.items.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: '回款必须至少拆分一条产品明细',
      });
      return;
    }
    if (!isPaymentItemAmountTotalValid(value.paymentAmount, value.items)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: '产品明细金额合计必须与回款金额一致（误差需小于 0.01）',
      });
    }
  });
export const paymentRefundFormSchema = createPaymentRefundSchema;

export function getDefaultPaymentAmountFromSaleOrder(
  order: Pick<SaleOrderForSelection, 'orderAmount' | 'totalUncollected'> | null | undefined
): number | null {
  if (!order) return null;

  const uncollectedAmount = order.totalUncollected == null ? null : Number(order.totalUncollected);
  if (uncollectedAmount != null && Number.isFinite(uncollectedAmount)) {
    return Math.max(Math.round(uncollectedAmount * 100) / 100, 0);
  }

  if (order.orderAmount == null) return null;
  const amount = Number(order.orderAmount);
  return Number.isFinite(amount) ? Math.max(Math.round(amount * 100) / 100, 0) : null;
}

function normalizeDateOnly(value: string | null | undefined): string | null {
  const formatted = formatDateString(value);
  return formatted || null;
}

/**
 * API 响应 -> 前端展示对象
 */
export function toPaymentProfile(data: IPaymentResponse): PaymentProfile {
  return {
    ...data,
    businessDate: normalizeDateOnly(data.businessDate),
    items: data.items ?? [],
  };
}

/**
 * 响应/展示 -> 表单数据（IN/编辑通用，OUT 不在此走 update）
 *
 * Payment 响应始终携带当前活动 items；编辑时直接映射并沿用数据库 id 作为稳定 React key。
 */
export function toPaymentFormData(data: PaymentProfile): PaymentFormData {
  return {
    saleOrderId: data.saleOrderId,
    customerId: data.customerId,
    subject: data.subject ?? '',
    paymentAmount: Number(data.paymentAmount),
    paymentType: data.paymentType ?? null,
    businessDate: normalizeDateOnly(data.businessDate),
    bankName: data.bankName ?? null,
    tradeSerialNumber: data.tradeSerialNumber ?? null,
    chargerId: data.chargerId ?? null,
    remark: data.remark ?? null,
    direction: data.direction ?? PAYMENT_DIRECTION.IN,
    items: (data.items ?? []).map((item) => ({
      tempId: item.id,
      saleOrderProductId: item.saleOrderProductId,
      productName: item.productName,
      amount: Number(item.amount),
      paymentMode: item.paymentMode,
      financeSubjectId: item.financeSubjectId ?? null,
      remark: item.remark ?? null,
    })),
    version: data.version,
  };
}

/**
 * 表单数据 -> API 提交 payload（IN/update 通用）
 *
 * IN items 剥离 tempId 后原样透传；禁止过滤空行掩盖 Shared 错误。OUT 不发送 items。
 */
export function toPaymentPayload(form: PaymentFormData) {
  const items = form.items.map((it) => ({
    saleOrderProductId: it.saleOrderProductId,
    amount: Number(it.amount),
    paymentMode: it.paymentMode,
    financeSubjectId: it.financeSubjectId ?? null,
    productName: it.productName || null,
    remark: it.remark || null,
  }));
  const payload = {
    saleOrderId: form.saleOrderId,
    customerId: form.customerId || null,
    subject: form.subject,
    paymentAmount: String(form.paymentAmount),
    paymentType: form.paymentType || null,
    businessDate: toAPIDateString(form.businessDate),
    bankName: form.bankName || null,
    tradeSerialNumber: form.tradeSerialNumber || null,
    chargerId: form.chargerId || null,
    remark: form.remark || null,
    version: form.version,
  };
  const result: typeof payload & { items?: typeof items } =
    form.direction === PAYMENT_DIRECTION.OUT ? payload : { ...payload, items };
  return result;
}

/**
 * 退款表单 -> API 提交 payload（POST /payments/refund）
 */
export function toPaymentRefundPayload(form: PaymentRefundFormData) {
  return {
    saleOrderId: form.saleOrderId,
    customerId: form.customerId || null,
    // OUT 方向 subject 可选；不传时后端用 refundType 兜底
    subject: form.subject || undefined,
    paymentAmount: String(form.paymentAmount),
    paymentType: form.paymentType || null,
    businessDate: toAPIDateString(form.businessDate),
    bankName: form.bankName || null,
    tradeSerialNumber: form.tradeSerialNumber || null,
    chargerId: form.chargerId || null,
    remark: form.remark || null,
    refundType: form.refundType,
    refundReason: form.refundReason || null,
    relatedPaymentId: form.relatedPaymentId,
    relatedInvoiceId: form.relatedInvoiceId || null,
    version: form.version,
  };
}
