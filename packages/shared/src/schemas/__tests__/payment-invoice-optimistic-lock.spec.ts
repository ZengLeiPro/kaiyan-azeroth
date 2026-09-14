import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import {
  batchRemoveInvoiceSchema,
  batchTransferInvoiceSchema,
  batchUpdateInvoiceSchema,
  updateInvoiceSchema,
} from '../invoice';
import {
  batchRemovePaymentSchema,
  batchTransferPaymentSchema,
  batchUpdatePaymentSchema,
  createPaymentSchema,
  updatePaymentSchema,
} from '../payment';

const updateSchemas: Array<[string, ZodTypeAny]> = [
  ['回款', updatePaymentSchema],
  ['发票', updateInvoiceSchema],
];

describe.each(updateSchemas)('%s update version 乐观锁契约', (_label, schema) => {
  it('拒绝缺失 version', () => {
    expect(schema.safeParse({ remark: '更新备注' }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null])(
    '拒绝非法 version %s',
    (version) => {
      expect(schema.safeParse({ remark: '更新备注', version }).success).toBe(false);
    }
  );

  it('接受整数且大于等于 1 的 version', () => {
    expect(schema.safeParse({ remark: '更新备注', version: 1 }).success).toBe(true);
    expect(schema.safeParse({ remark: '更新备注', version: 8 }).success).toBe(true);
  });
});

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

const baseCreatePayment = {
  saleOrderId: ID_1,
  customerId: ID_2,
  subject: '首期款',
  paymentAmount: 100,
  paymentType: '银行转账',
  businessDate: '2026-08-24',
  bankName: '招商银行',
  chargerId: ID_3,
  items: [{ saleOrderProductId: ID_3, amount: 100, paymentMode: 'direct' }],
};

describe('IN 回款 PaymentItem 完整拆分契约', () => {
  it('拒绝缺失/空 items、非有限正数与合计不一致', () => {
    const { items: _items, ...withoutItems } = baseCreatePayment;
    expect(createPaymentSchema.safeParse(withoutItems).success).toBe(false);
    expect(createPaymentSchema.safeParse({ ...baseCreatePayment, items: [] }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ ...baseCreatePayment, direction: 'OUT' }).success).toBe(
      false
    );
    expect(
      createPaymentSchema.safeParse({
        ...baseCreatePayment,
        items: [{ ...baseCreatePayment.items[0], amount: Number.POSITIVE_INFINITY }],
      }).success
    ).toBe(false);
    expect(
      createPaymentSchema.safeParse({
        ...baseCreatePayment,
        items: [{ ...baseCreatePayment.items[0], amount: 99.98 }],
      }).success
    ).toBe(false);
  });

  it('金额严格限制为两位小数并按整数分精确核对', () => {
    expect(
      createPaymentSchema.safeParse({
        ...baseCreatePayment,
        paymentAmount: 99.991,
        items: [{ ...baseCreatePayment.items[0], amount: 99.991 }],
      }).success
    ).toBe(false);
    expect(
      createPaymentSchema.safeParse({
        ...baseCreatePayment,
        paymentAmount: 0.004,
        items: [{ ...baseCreatePayment.items[0], amount: 0.004 }],
      }).success
    ).toBe(false);
    expect(
      createPaymentSchema.safeParse({
        ...baseCreatePayment,
        paymentAmount: 0.3,
        items: [
          { ...baseCreatePayment.items[0], amount: 0.1 },
          { ...baseCreatePayment.items[0], saleOrderProductId: ID_2, amount: 0.2 },
        ],
      }).success
    ).toBe(true);
  });

  it('纯弱字段更新不要求 items；金额与 replacement 同传时复用合计规则', () => {
    expect(updatePaymentSchema.safeParse({ remark: '仅改备注', version: 1 }).success).toBe(true);
    expect(
      updatePaymentSchema.safeParse({
        paymentAmount: 100,
        items: [{ saleOrderProductId: ID_3, amount: 99, paymentMode: 'direct' }],
        version: 1,
      }).success
    ).toBe(false);
    expect(
      updatePaymentSchema.safeParse({
        paymentAmount: 100,
        items: baseCreatePayment.items,
        version: 1,
      }).success
    ).toBe(true);
  });
});

const versionedBatchSchemas: Array<[string, ZodTypeAny, Record<string, unknown>]> = [
  ['回款批量编辑', batchUpdatePaymentSchema, { patch: { remark: '修正' } }],
  ['回款批量转交', batchTransferPaymentSchema, { chargerId: 'employee-1' }],
  ['回款批量删除', batchRemovePaymentSchema, {}],
  ['发票批量编辑', batchUpdateInvoiceSchema, { patch: { remark: '修正' } }],
  ['发票批量转交', batchTransferInvoiceSchema, { chargerId: 'employee-1' }],
  ['发票批量删除', batchRemoveInvoiceSchema, {}],
];

describe.each(versionedBatchSchemas)('%s逐行 version 契约', (_label, schema, extra) => {
  const validSelection = {
    ids: [ID_1, ID_2],
    versions: { [ID_1]: 1, [ID_2]: 7 },
    ...extra,
  };

  it('只接受 ids 与 versions 精确一一对应', () => {
    expect(schema.safeParse(validSelection).success).toBe(true);
  });

  it('拒绝缺失 versions 或缺少任一 ID 的 version', () => {
    const { versions: _versions, ...withoutVersions } = validSelection;
    expect(schema.safeParse(withoutVersions).success).toBe(false);
    expect(schema.safeParse({ ...validSelection, versions: { [ID_1]: 1 } }).success).toBe(false);
  });

  it('拒绝额外 version 键、重复 ID 与未知顶层字段', () => {
    expect(
      schema.safeParse({
        ...validSelection,
        versions: { ...validSelection.versions, [ID_3]: 2 },
      }).success
    ).toBe(false);
    expect(schema.safeParse({ ...validSelection, ids: [ID_1, ID_1] }).success).toBe(false);
    expect(schema.safeParse({ ...validSelection, unexpected: true }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null])(
    '拒绝任一非法逐行 version %s',
    (version) => {
      expect(
        schema.safeParse({
          ...validSelection,
          versions: { [ID_1]: 1, [ID_2]: version },
        }).success
      ).toBe(false);
    }
  );
});
