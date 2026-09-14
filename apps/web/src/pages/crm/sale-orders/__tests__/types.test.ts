import type { IOpportunityResponse } from '@ky-azeroth/shared/types/opportunity';
import type { ISaleOrderResponse } from '@ky-azeroth/shared/types/sale-order';
import { describe, expect, it } from 'vitest';

import {
  applyOpportunityToSaleOrderFormData,
  applyProductSelectionToOrderProduct,
  createEmptyOrderProductItem,
  type OrderProductFormItem,
  type SaleOrderFormData,
  toSaleOrderFormData,
  toSaleOrderPayload,
  toSaleOrderProfile,
  toSaleOrderUpdatePayload,
  updateOrderProductPricingField,
} from '../types';

const productRow: OrderProductFormItem = {
  tempId: 'product-row',
  productName: '原产品',
  productNumber: 'OLD',
  productPrice: 100,
  quantity: 2,
  unitPrice: 100,
  contractUnitPrice: 100,
  discount: 0,
  subtotalAmount: 200,
  remark: null,
};

describe('订单产品明细价格交互', () => {
  it('空白行填写产品单价时，自动填入合同单价', () => {
    const result = updateOrderProductPricingField(createEmptyOrderProductItem(), 'unitPrice', 1500);

    expect(result.unitPrice).toBe(1500);
    expect(result.contractUnitPrice).toBe(1500);
  });

  it('合同单价尚未单独修改时，跟随产品单价更新', () => {
    const result = updateOrderProductPricingField(productRow, 'unitPrice', 120);

    expect(result.unitPrice).toBe(120);
    expect(result.contractUnitPrice).toBe(120);
    expect(result.subtotalAmount).toBe(240);
  });

  it('合同单价已经单独修改时，不被产品单价覆盖', () => {
    const result = updateOrderProductPricingField(
      { ...productRow, contractUnitPrice: 150 },
      'unitPrice',
      120
    );

    expect(result.unitPrice).toBe(120);
    expect(result.contractUnitPrice).toBe(150);
    expect(result.subtotalAmount).toBe(300);
  });

  it('切换产品时保留已有产品单价和合同单价', () => {
    const result = applyProductSelectionToOrderProduct(
      { ...productRow, unitPrice: 295, contractUnitPrice: 385 },
      { productName: '新产品', productNumber: 'NEW', standardPrice: 9999 }
    );

    expect(result.productName).toBe('新产品');
    expect(result.productNumber).toBe('NEW');
    expect(result.unitPrice).toBe(295);
    expect(result.contractUnitPrice).toBe(385);
    expect(result.subtotalAmount).toBe(770);
  });

  it('空白行首次选择产品时，产品标准价同时带入两个单价', () => {
    const result = applyProductSelectionToOrderProduct(createEmptyOrderProductItem(), {
      productName: '新产品',
      productNumber: 'NEW',
      standardPrice: 1500,
    });

    expect(result.unitPrice).toBe(1500);
    expect(result.contractUnitPrice).toBe(1500);
  });
});

describe('toSaleOrderUpdatePayload', () => {
  const baseForm: SaleOrderFormData = {
    orderTitle: '测试合同',
    customerId: '11111111-1111-1111-1111-111111111111',
    opportunityId: '22222222-2222-2222-2222-222222222222',
    orderAmount: 100,
    otherFee: 0,
    badDebtAmount: 0,
    businessDate: '2026-05-14',
    paymentDate: null,
    orderBeginDate: '2026-05-15',
    chargerId: 'emp-current',
    version: 1,
    products: [
      {
        tempId: 'tmp-1',
        productName: '测试产品',
        productNumber: null,
        quantity: 1,
        unitPrice: 100,
        contractUnitPrice: 100,
        discount: null,
        subtotalAmount: 100,
        remark: null,
      },
    ],
    productsTouched: false,
  };

  it('未触碰产品明细时不提交 products，避免 update 误清空子表', () => {
    const payload = toSaleOrderUpdatePayload(baseForm);

    expect(payload).not.toHaveProperty('products');
  });

  it('触碰产品明细后提交产品数组，用于显式替换子表', () => {
    const payload = toSaleOrderUpdatePayload({
      ...baseForm,
      productsTouched: true,
    });

    expect('products' in payload).toBe(true);
    if ('products' in payload) {
      expect(payload.products).toHaveLength(1);
    }
  });

  it('日期字段从响应到表单和 payload 都保持 YYYY-MM-DD', () => {
    const response = {
      id: 'order-1',
      serialNumber: 'DD0001',
      orderTitle: '测试合同',
      customerId: '11111111-1111-1111-1111-111111111111',
      opportunityId: null,
      orderAmount: 100,
      otherFee: null,
      badDebtAmount: 0,
      productAmount: 100,
      totalReceivables: 100,
      totalReceived: 0,
      totalRefunded: 0,
      totalUncollected: 100,
      invoicedAmount: 0,
      orderInvoiceStatus: null,
      orderStatus: null,
      legacyAdjustment: false,
      businessDate: '2026-05-14T00:00:00.000Z',
      paymentDate: '2026-06-01T00:00:00.000Z',
      lastPaymentDate: null,
      orderBeginDate: '2026-05-15T00:00:00.000Z',
      orderEndDate: '2027-05-15T00:00:00.000Z',
      chargerId: null,
      chargerName: null,
      remark: null,
      flowStatus: null,
      status: 'active',
      products: [],
    } satisfies ISaleOrderResponse;

    const profile = toSaleOrderProfile(response);
    const form = toSaleOrderFormData(profile);
    const payload = toSaleOrderPayload({
      ...form,
      businessDate: '2026-05-14T00:00:00.000Z',
      paymentDate: '2026-06-01T00:00:00.000Z',
      orderBeginDate: '2026-05-15T00:00:00.000Z',
      orderEndDate: '2027-05-15T00:00:00.000Z',
    });

    expect(profile.businessDate).toBe('2026-05-14');
    expect(profile.paymentDate).toBe('2026-06-01');
    expect(form.orderBeginDate).toBe('2026-05-15');
    expect(payload).toMatchObject({
      businessDate: '2026-05-14',
      paymentDate: '2026-06-01',
      orderBeginDate: '2026-05-15',
      orderEndDate: '2027-05-15',
    });
  });
});

describe('applyOpportunityToSaleOrderFormData', () => {
  const baseForm: SaleOrderFormData = {
    orderTitle: null,
    customerId: '',
    opportunityId: null,
    orderAmount: null,
    otherFee: 0,
    badDebtAmount: 0,
    businessDate: null,
    paymentDate: null,
    orderBeginDate: null,
    chargerId: 'emp-current',
    products: [],
    productsTouched: false,
  };

  it('新增订单产品明细默认折扣为0%', () => {
    expect(createEmptyOrderProductItem().discount).toBe(0);
  });

  it('关联商机后带出客户、商机金额和产品明细，且不覆盖当前负责人', () => {
    const opportunity = {
      id: '22222222-2222-2222-2222-222222222222',
      serialNumber: 'SJ0001',
      opportunityName: '测试商机',
      customerId: '11111111-1111-1111-1111-111111111111',
      contactId: null,
      opportunityStage: '商务谈判',
      opportunityAmount: 12345.67,
      winRate: null,
      expectedDealDate: null,
      realDealDate: null,
      wonSourceType: null,
      wonSourceSaleOrderId: null,
      wonSourcePreviousStage: null,
      wonSourcePreviousDealDate: null,
      wonSourcePreviousWinRate: null,
      lostDate: null,
      chargerId: 'emp-opportunity',
      chargerName: '商机负责人',
      chargerAvatar: null,
      loseReason: null,
      loseReasonDetail: null,
      remark: null,
      flowStatus: null,
      status: 'active',
      products: [
        {
          id: 'product-1',
          productName: '钉钉专业版',
          productNumber: 'DD-PRO',
          productPrice: 1200,
          quantity: 2,
          unitPrice: 1000,
          discount: 10,
          subtotalAmount: 1800,
          remark: '首年',
        },
      ],
    } satisfies IOpportunityResponse;

    const result = applyOpportunityToSaleOrderFormData(baseForm, opportunity);

    expect(result.customerId).toBe(opportunity.customerId);
    expect(result.opportunityId).toBe(opportunity.id);
    expect(result.orderAmount).toBe(12345.67);
    expect(result.chargerId).toBe('emp-current');
    expect(result.productsTouched).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      productName: '钉钉专业版',
      productNumber: 'DD-PRO',
      productPrice: 1200,
      quantity: 2,
      unitPrice: 1000,
      contractUnitPrice: 900,
      discount: 10,
      subtotalAmount: 1800,
      remark: '首年',
    });
  });

  it('商机产品缺少小计时按数量、单价和折扣计算订单产品小计', () => {
    const opportunity = {
      id: '22222222-2222-2222-2222-222222222222',
      serialNumber: 'SJ0001',
      opportunityName: '测试商机',
      customerId: '11111111-1111-1111-1111-111111111111',
      contactId: null,
      opportunityStage: '商务谈判',
      opportunityAmount: 2000,
      winRate: null,
      expectedDealDate: null,
      realDealDate: null,
      wonSourceType: null,
      wonSourceSaleOrderId: null,
      wonSourcePreviousStage: null,
      wonSourcePreviousDealDate: null,
      wonSourcePreviousWinRate: null,
      lostDate: null,
      chargerId: 'emp-opportunity',
      chargerName: '商机负责人',
      chargerAvatar: null,
      loseReason: null,
      loseReasonDetail: null,
      remark: null,
      flowStatus: null,
      status: 'active',
      products: [
        {
          id: 'product-1',
          productName: '钉钉专业版',
          productNumber: 'DD-PRO',
          productPrice: null,
          quantity: 2,
          unitPrice: 1000,
          discount: 10,
          subtotalAmount: null,
          remark: null,
        },
      ],
    } satisfies IOpportunityResponse;

    const result = applyOpportunityToSaleOrderFormData(baseForm, opportunity);

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.contractUnitPrice).toBe(900);
    expect(result.products[0]?.discount).toBe(10);
    expect(result.products[0]?.subtotalAmount).toBe(1800);
  });

  it('商机产品折扣为空时带入订单产品明细为0%', () => {
    const opportunity = {
      id: '22222222-2222-2222-2222-222222222222',
      serialNumber: 'SJ0001',
      opportunityName: '测试商机',
      customerId: '11111111-1111-1111-1111-111111111111',
      contactId: null,
      opportunityStage: '商务谈判',
      opportunityAmount: 2000,
      winRate: null,
      expectedDealDate: null,
      realDealDate: null,
      wonSourceType: null,
      wonSourceSaleOrderId: null,
      wonSourcePreviousStage: null,
      wonSourcePreviousDealDate: null,
      wonSourcePreviousWinRate: null,
      lostDate: null,
      chargerId: 'emp-opportunity',
      chargerName: '商机负责人',
      chargerAvatar: null,
      loseReason: null,
      loseReasonDetail: null,
      remark: null,
      flowStatus: null,
      status: 'active',
      products: [
        {
          id: 'product-1',
          productName: '钉钉专业版',
          productNumber: 'DD-PRO',
          productPrice: null,
          quantity: 2,
          unitPrice: 1000,
          discount: null,
          subtotalAmount: null,
          remark: null,
        },
      ],
    } satisfies IOpportunityResponse;

    const result = applyOpportunityToSaleOrderFormData(baseForm, opportunity);

    expect(result.products[0]?.discount).toBe(0);
    expect(result.products[0]?.contractUnitPrice).toBe(1000);
    expect(result.products[0]?.subtotalAmount).toBe(2000);
  });
});
