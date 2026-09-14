import { describe, expect, it } from 'vitest';

import { toCrmProductUpdatePayload } from '../types';

describe('toCrmProductUpdatePayload', () => {
  it('should retain only supplied fields and serialize values for the API', () => {
    expect(
      toCrmProductUpdatePayload({
        productName: ' 产品 ',
        productNumber: ' P001 ',
        productTypes: '不再使用,作废',
        productUnit: ' 套 ',
        standardPrice: 99.5,
        productStatus: 'off_sale',
        remark: ' 已下架 ',
        version: 2,
      })
    ).toEqual({
      productName: '产品',
      productNumber: 'P001',
      productTypes: '不再使用,作废',
      productUnit: '套',
      standardPrice: '99.5',
      productStatus: 'off_sale',
      remark: '已下架',
      version: 2,
    });
  });

  it('should preserve explicit null values for optional fields', () => {
    expect(
      toCrmProductUpdatePayload({
        productNumber: null,
        productTypes: null,
        productUnit: null,
        standardPrice: null,
        productStatus: null,
        remark: null,
      })
    ).toEqual({
      productNumber: null,
      productTypes: null,
      productUnit: null,
      standardPrice: null,
      productStatus: null,
      remark: null,
    });
  });
});
