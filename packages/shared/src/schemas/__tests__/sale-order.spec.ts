import { describe, expect, it } from 'vitest';

import {
  batchTransferSaleOrderSchema,
  batchUpdateSaleOrderSchema,
  createSaleOrderSchema,
  saleOrderDateOnlySchema,
  updateSaleOrderSchema,
} from '../sale-order';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID_2 = '22222222-2222-4222-8222-222222222222';
const ORDER_ID_3 = '33333333-3333-4333-8333-333333333333';
const ORDER_VERSIONS = { [ORDER_ID]: 1 };

const validCreateInput = {
  customerId: '22222222-2222-4222-8222-222222222222',
  opportunityId: '33333333-3333-4333-8333-333333333333',
  orderAmount: 100,
  otherFee: 0,
  badDebtAmount: 0,
  businessDate: '2024-02-29',
  paymentDate: '2024-03-01',
  orderBeginDate: '2024-02-29',
  orderEndDate: '2025-02-28',
  chargerId: 'employee-1',
  products: [
    {
      productName: '测试产品',
      quantity: 1,
      unitPrice: 100,
      contractUnitPrice: 100,
    },
  ],
};

describe('SaleOrder 严格日期契约', () => {
  it.each(['not-a-date', '2024-2-29', '2024-02-29T00:00:00.000Z', '0000-01-01'])(
    '拒绝非严格 YYYY-MM-DD 日期：%s',
    (value) => {
      expect(saleOrderDateOnlySchema.safeParse(value).success).toBe(false);
    }
  );

  it.each(['2023-02-29', '2024-02-30', '2026-02-31', '2024-04-31', '2024-13-01'])(
    '拒绝不存在的日历日：%s',
    (value) => {
      expect(saleOrderDateOnlySchema.safeParse(value).success).toBe(false);
    }
  );

  it('按公历闰年规则接受真实日期', () => {
    expect(saleOrderDateOnlySchema.safeParse('2024-02-29').success).toBe(true);
    expect(saleOrderDateOnlySchema.safeParse('2000-02-29').success).toBe(true);
    expect(saleOrderDateOnlySchema.safeParse('2100-02-29').success).toBe(false);
  });

  it.each(['businessDate', 'paymentDate', 'orderBeginDate', 'orderEndDate'] as const)(
    '创建 schema 的 %s 字段拒绝非法日期',
    (field) => {
      expect(
        createSaleOrderSchema.safeParse({ ...validCreateInput, [field]: '2026-02-31' }).success
      ).toBe(false);
    }
  );

  it('创建对象拒绝倒置合同区间，并接受同日区间', () => {
    expect(
      createSaleOrderSchema.safeParse({
        ...validCreateInput,
        orderBeginDate: '2026-05-02',
        orderEndDate: '2026-05-01',
      }).success
    ).toBe(false);
    expect(
      createSaleOrderSchema.safeParse({
        ...validCreateInput,
        orderBeginDate: '2026-05-02',
        orderEndDate: '2026-05-02',
      }).success
    ).toBe(true);
  });

  it('update partial 仅在起止日期同时提供时校验区间', () => {
    expect(
      updateSaleOrderSchema.safeParse({ version: 1, orderBeginDate: '2026-05-02' }).success
    ).toBe(true);
    expect(
      updateSaleOrderSchema.safeParse({ version: 1, orderEndDate: '2026-05-01' }).success
    ).toBe(true);
    expect(
      updateSaleOrderSchema.safeParse({
        version: 1,
        orderBeginDate: '2026-05-02',
        orderEndDate: '2026-05-01',
      }).success
    ).toBe(false);
    expect(
      updateSaleOrderSchema.safeParse({ version: 1, businessDate: '2026-02-31' }).success
    ).toBe(false);
  });

  it('batch partial 仅在 patch 起止日期同时提供时校验区间', () => {
    expect(
      batchUpdateSaleOrderSchema.safeParse({
        ids: [ORDER_ID],
        versions: ORDER_VERSIONS,
        patch: { orderBeginDate: '2026-05-02' },
      }).success
    ).toBe(true);
    expect(
      batchUpdateSaleOrderSchema.safeParse({
        ids: [ORDER_ID],
        versions: ORDER_VERSIONS,
        patch: { orderEndDate: '2026-05-01' },
      }).success
    ).toBe(true);
    expect(
      batchUpdateSaleOrderSchema.safeParse({
        ids: [ORDER_ID],
        versions: ORDER_VERSIONS,
        patch: { orderBeginDate: '2026-05-02', orderEndDate: '2026-05-01' },
      }).success
    ).toBe(false);
    expect(
      batchUpdateSaleOrderSchema.safeParse({
        ids: [ORDER_ID],
        versions: ORDER_VERSIONS,
        patch: { paymentDate: '2026-02-31' },
      }).success
    ).toBe(false);
  });
});

const versionedBatchSchemas = [
  ['批量编辑', batchUpdateSaleOrderSchema, { patch: { remark: '修正' } }],
  ['批量转交', batchTransferSaleOrderSchema, { chargerId: 'employee-1' }],
] as const;

describe.each(versionedBatchSchemas)('SaleOrder %s逐行 version 契约', (_label, schema, extra) => {
  const validSelection = {
    ids: [ORDER_ID, ORDER_ID_2],
    versions: { [ORDER_ID]: 1, [ORDER_ID_2]: 7 },
    ...extra,
  };

  it('接受与去重 ids 精确一一对应的正整数 versions', () => {
    expect(schema.safeParse(validSelection).success).toBe(true);
  });

  it('拒绝缺失 versions 或缺少任一 ID 的 version', () => {
    const { versions: _versions, ...withoutVersions } = validSelection;
    expect(schema.safeParse(withoutVersions).success).toBe(false);
    expect(schema.safeParse({ ...validSelection, versions: { [ORDER_ID]: 1 } }).success).toBe(
      false
    );
  });

  it('拒绝额外 version 键与重复 ID', () => {
    expect(
      schema.safeParse({
        ...validSelection,
        versions: { ...validSelection.versions, [ORDER_ID_3]: 2 },
      }).success
    ).toBe(false);
    expect(schema.safeParse({ ...validSelection, ids: [ORDER_ID, ORDER_ID] }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null])(
    '拒绝非法逐行 version %s',
    (version) => {
      expect(
        schema.safeParse({
          ...validSelection,
          versions: { [ORDER_ID]: 1, [ORDER_ID_2]: version },
        }).success
      ).toBe(false);
    }
  );
});

describe('SaleOrder 坏账金额契约', () => {
  it('创建时默认坏账金额为 0，并拒绝负数', () => {
    expect(createSaleOrderSchema.parse(validCreateInput).badDebtAmount).toBe(0);
    expect(
      createSaleOrderSchema.safeParse({ ...validCreateInput, badDebtAmount: -0.01 }).success
    ).toBe(false);
  });
});
