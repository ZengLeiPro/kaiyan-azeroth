import { describe, expect, it } from 'vitest';

import { formatSaleOrderPriceAdjustment } from '../sale-order-product';

describe('formatSaleOrderPriceAdjustment', () => {
  it('合同价高于产品价时显示为加价，不显示负折扣', () => {
    expect(formatSaleOrderPriceAdjustment(-30.51)).toBe('加价 30.51%');
  });

  it('合同价低于产品价时显示为折扣', () => {
    expect(formatSaleOrderPriceAdjustment(10)).toBe('折扣 10.00%');
  });

  it('价格相同时显示无浮动', () => {
    expect(formatSaleOrderPriceAdjustment(0)).toBe('无浮动');
  });

  it('缺少有效数值时显示占位符', () => {
    expect(formatSaleOrderPriceAdjustment(null)).toBe('-');
    expect(formatSaleOrderPriceAdjustment('invalid')).toBe('-');
  });
});
