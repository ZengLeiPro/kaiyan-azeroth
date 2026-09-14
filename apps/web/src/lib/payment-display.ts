import { PAYMENT_DIRECTION } from '@ky-azeroth/shared/constants';

interface PaymentDisplayInput {
  direction?: string | null;
  legacyAdjustment: boolean;
}

/**
 * 回款展示语义：历史负向调整优先于普通 OUT 退款。
 * 金额正负仍只由 direction 决定，legacyAdjustment 不改变账务方向。
 */
export function getPaymentDisplayMeta(payment: PaymentDisplayInput): {
  directionLabel: string;
  amountLabel: string;
  isOut: boolean;
} {
  const isOut = payment.direction === PAYMENT_DIRECTION.OUT;
  const directionLabel = payment.legacyAdjustment
    ? '历史冲正'
    : isOut
      ? '退款'
      : payment.direction === PAYMENT_DIRECTION.IN
        ? '回款'
        : payment.direction || '-';

  return {
    directionLabel,
    amountLabel: `${directionLabel}金额`,
    isOut,
  };
}
