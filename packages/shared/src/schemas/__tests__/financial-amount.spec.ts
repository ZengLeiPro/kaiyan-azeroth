import { describe, expect, it } from 'vitest';

import { createInvoiceSchema, updateInvoiceSchema } from '../invoice';
import { paymentInputFieldsSchema, updatePaymentSchema } from '../payment';

const paymentAmountSchema = paymentInputFieldsSchema.shape.paymentAmount;
const invoiceAmountSchema = createInvoiceSchema.shape.invoiceAmount;

describe('财务金额 schema', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '回款金额拒绝非法值 %s',
    (paymentAmount) => {
      expect(paymentAmountSchema.safeParse(paymentAmount).success).toBe(false);
    }
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '发票金额拒绝非法值 %s',
    (invoiceAmount) => {
      expect(invoiceAmountSchema.safeParse(invoiceAmount).success).toBe(false);
    }
  );

  it('接受正数，并让 update 在传入金额时沿用同一约束', () => {
    expect(paymentAmountSchema.safeParse(0.01).success).toBe(true);
    expect(invoiceAmountSchema.safeParse(0.01).success).toBe(true);
    expect(updatePaymentSchema.safeParse({ paymentAmount: 0, version: 1 }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ invoiceAmount: -1, version: 1 }).success).toBe(false);
    expect(updatePaymentSchema.safeParse({ paymentAmount: 0.01, version: 1 }).success).toBe(true);
    expect(updateInvoiceSchema.safeParse({ invoiceAmount: 0.01, version: 1 }).success).toBe(true);
  });
});
