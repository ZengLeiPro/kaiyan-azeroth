import { describe, expect, it } from 'vitest';

import {
  createPaymentItemRowsFromSaleOrderProducts,
  getDefaultPaymentAmountFromSaleOrder,
  getPaymentDisplayMeta,
  paymentFormSchema,
  toPaymentFormData,
  toPaymentPayload,
  toPaymentProfile,
  toPaymentRefundPayload,
} from '../types';

const basePayment = {
  id: 'pay-1',
  serialNumber: 'PAY00001',
  subject: '首期款',
  saleOrderId: '11111111-1111-1111-1111-111111111111',
  customerId: '22222222-2222-2222-2222-222222222222',
  paymentAmount: 100,
  paymentType: '银行转账',
  businessDate: '2026-05-14T00:00:00.000Z',
  bankName: '招商银行',
  tradeSerialNumber: 'TXN001',
  chargerId: '33333333-3333-3333-3333-333333333333',
  chargerName: '李四',
  remark: null,
  flowStatus: null,
  status: 'active',
  direction: 'IN',
  legacyAdjustment: false,
  refundType: null,
  refundReason: null,
  relatedPaymentId: null,
  relatedInvoiceId: null,
  items: [
    {
      id: 'item-1',
      paymentId: 'pay-1',
      saleOrderProductId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      itemSeq: 1,
      productName: '钉钉专业版',
      amount: 100,
      financeSubjectId: null,
      paymentMode: 'direct',
      remark: null,
      version: 2,
    },
  ],
  version: 1,
};

const baseFormItems = [
  {
    tempId: 'item-1',
    saleOrderProductId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    productName: '钉钉专业版',
    amount: 100,
    paymentMode: 'direct',
    financeSubjectId: null,
    remark: null,
  },
];

describe('createPaymentItemRowsFromSaleOrderProducts', () => {
  it('为合同的每个产品预填一条可提交前继续分配金额的回款明细', () => {
    expect(
      createPaymentItemRowsFromSaleOrderProducts([
        { id: 'product-1', productName: '钉钉专业版' },
        { id: 'product-2', productName: '实施服务' },
      ])
    ).toEqual([
      {
        tempId: 'pi-product-1',
        saleOrderProductId: 'product-1',
        productName: '钉钉专业版',
        amount: 0,
        paymentMode: 'direct',
        remark: null,
      },
      {
        tempId: 'pi-product-2',
        saleOrderProductId: 'product-2',
        productName: '实施服务',
        amount: 0,
        paymentMode: 'direct',
        remark: null,
      },
    ]);
  });
});

describe('getPaymentDisplayMeta', () => {
  it('历史负向调整显示为历史冲正，金额仍按 OUT 方向处理', () => {
    expect(getPaymentDisplayMeta({ direction: 'OUT', legacyAdjustment: true })).toEqual({
      directionLabel: '历史冲正',
      amountLabel: '历史冲正金额',
      isOut: true,
    });
  });

  it('普通 OUT 仍显示退款，IN 仍显示回款', () => {
    expect(getPaymentDisplayMeta({ direction: 'OUT', legacyAdjustment: false })).toEqual({
      directionLabel: '退款',
      amountLabel: '退款金额',
      isOut: true,
    });
    expect(getPaymentDisplayMeta({ direction: 'IN', legacyAdjustment: false })).toEqual({
      directionLabel: '回款',
      amountLabel: '回款金额',
      isOut: false,
    });
  });
});

describe('payment date conversion', () => {
  it('响应转 Profile/FormData 时把业务日期规范为 YYYY-MM-DD', () => {
    const profile = toPaymentProfile(basePayment);
    const form = toPaymentFormData(profile);

    expect(profile.businessDate).toBe('2026-05-14');
    expect(form.businessDate).toBe('2026-05-14');
    expect(form.items).toEqual(baseFormItems);
  });

  it('提交 payload 时只提交 YYYY-MM-DD，避免把 ISO 字符串回写给后端', () => {
    const payload = toPaymentPayload({
      saleOrderId: basePayment.saleOrderId,
      customerId: basePayment.customerId,
      subject: basePayment.subject,
      paymentAmount: 100,
      paymentType: basePayment.paymentType,
      businessDate: '2026-05-14T00:00:00.000Z',
      bankName: basePayment.bankName,
      tradeSerialNumber: basePayment.tradeSerialNumber,
      chargerId: basePayment.chargerId,
      remark: null,
      items: baseFormItems,
      version: 1,
    });

    expect(payload.businessDate).toBe('2026-05-14');
  });
});

describe('toPaymentRefundPayload', () => {
  it('应该把退款必填字段及 Decimal 字符串化、日期规范化都正确转换', () => {
    const payload = toPaymentRefundPayload({
      saleOrderId: '11111111-1111-1111-1111-111111111111',
      customerId: '22222222-2222-2222-2222-222222222222',
      paymentAmount: 3000.55,
      paymentType: '银行转账',
      businessDate: '2026-05-14T00:00:00.000Z',
      bankName: '招商银行',
      tradeSerialNumber: 'REF-TXN-001',
      chargerId: '33333333-3333-3333-3333-333333333333',
      remark: '客户解约退款',
      refundType: '客户取消',
      refundReason: '客户暂不需要',
      relatedPaymentId: '44444444-4444-4444-4444-444444444444',
      relatedInvoiceId: null,
      version: 1,
    });

    expect(payload.refundType).toBe('客户取消');
    expect(payload.relatedPaymentId).toBe('44444444-4444-4444-4444-444444444444');
    expect(payload.relatedInvoiceId).toBe(null);
    expect(payload.paymentAmount).toBe('3000.55');
    expect(payload.businessDate).toBe('2026-05-14');
    expect(payload.refundReason).toBe('客户暂不需要');
  });

  it('空字符串字段应统一规范化为 null（避免后端误解为 0 长度字符串）', () => {
    const payload = toPaymentRefundPayload({
      saleOrderId: '11111111-1111-1111-1111-111111111111',
      customerId: '22222222-2222-2222-2222-222222222222',
      paymentAmount: 100,
      paymentType: '银行转账',
      businessDate: '2026-05-14',
      bankName: '招商银行',
      tradeSerialNumber: '',
      chargerId: '33333333-3333-3333-3333-333333333333',
      remark: '',
      refundType: '解约',
      refundReason: '',
      relatedPaymentId: '44444444-4444-4444-4444-444444444444',
      relatedInvoiceId: '',
      version: 1,
    });

    expect(payload.tradeSerialNumber).toBe(null);
    expect(payload.remark).toBe(null);
    expect(payload.refundReason).toBe(null);
    expect(payload.relatedInvoiceId).toBe(null);
  });
});

describe('getDefaultPaymentAmountFromSaleOrder', () => {
  it('新建回款选择合同订单时默认取未回款金额', () => {
    expect(
      getDefaultPaymentAmountFromSaleOrder({ orderAmount: 12345.67, totalUncollected: 3456.78 })
    ).toBe(3456.78);
  });

  it('未回款金额为空时回退取合同金额', () => {
    expect(getDefaultPaymentAmountFromSaleOrder({ orderAmount: 12345.67 })).toBe(12345.67);
  });

  it('合同金额为空时不返回默认回款金额', () => {
    expect(getDefaultPaymentAmountFromSaleOrder(null)).toBe(null);
    expect(getDefaultPaymentAmountFromSaleOrder({ orderAmount: null })).toBe(null);
  });
});

describe('toPaymentPayload PaymentItem 子项序列化（v2.2 PR-B）', () => {
  const baseForm = {
    saleOrderId: basePayment.saleOrderId,
    customerId: basePayment.customerId,
    subject: basePayment.subject,
    paymentAmount: 10000,
    paymentType: basePayment.paymentType,
    businessDate: '2026-05-14',
    bankName: basePayment.bankName,
    tradeSerialNumber: basePayment.tradeSerialNumber,
    chargerId: basePayment.chargerId,
    remark: null,
    items: baseFormItems,
    version: 1,
  };

  it('items 数组剥 tempId 后传给后端', () => {
    const payload = toPaymentPayload({
      ...baseForm,
      items: [
        {
          tempId: 'pi-aaa',
          saleOrderProductId: 'op-1',
          productName: '钉钉专业版',
          amount: 6000,
          paymentMode: 'dingtalk_collect',
          remark: null,
        },
        {
          tempId: 'pi-bbb',
          saleOrderProductId: 'op-2',
          productName: '定制开发',
          amount: 4000,
          paymentMode: 'direct',
          remark: null,
        },
      ],
    });
    expect(payload.items).toEqual([
      {
        saleOrderProductId: 'op-1',
        amount: 6000,
        paymentMode: 'dingtalk_collect',
        financeSubjectId: null,
        productName: '钉钉专业版',
        remark: null,
      },
      {
        saleOrderProductId: 'op-2',
        amount: 4000,
        paymentMode: 'direct',
        financeSubjectId: null,
        productName: '定制开发',
        remark: null,
      },
    ]);
    expect((payload.items![0] as Record<string, unknown>).tempId).toBeUndefined();
  });

  it('不再过滤未选产品/零金额行，交由同一表单 Schema 明确拒绝', () => {
    const form = {
      ...baseForm,
      items: [
        {
          tempId: 'pi-a',
          saleOrderProductId: 'op-1',
          productName: '钉钉专业版',
          amount: 10000,
          paymentMode: 'direct',
          remark: null,
        },
        {
          tempId: 'pi-blank',
          saleOrderProductId: '',
          productName: '',
          amount: 0,
          paymentMode: 'direct',
          remark: null,
        },
      ],
    };
    expect(toPaymentPayload(form).items).toHaveLength(2);
    expect(paymentFormSchema.safeParse(form).success).toBe(false);
  });

  it('items 为空数组仍原样出现在 payload，且表单 Schema 拒绝提交', () => {
    const form = { ...baseForm, items: [] };
    expect(toPaymentPayload(form).items).toEqual([]);
    expect(paymentFormSchema.safeParse(form).success).toBe(false);
  });

  it('items 合计与回款金额不一致时表单 Schema 拒绝，完全一致时接受', () => {
    expect(paymentFormSchema.safeParse(baseForm).success).toBe(false);
    expect(
      paymentFormSchema.safeParse({
        ...baseForm,
        items: [{ ...baseFormItems[0]!, amount: 10000 }],
      }).success
    ).toBe(true);
  });

  it('OUT 退款编辑不要求且不发送 PaymentItem', () => {
    const form = { ...baseForm, direction: 'OUT', items: [] };
    expect(paymentFormSchema.safeParse(form).success).toBe(true);
    expect(toPaymentPayload(form)).not.toHaveProperty('items');
  });

  it('productName 为空字符串时序列化为 null（避免后端误解为 0 长度字符串）', () => {
    const payload = toPaymentPayload({
      ...baseForm,
      items: [
        {
          tempId: 'pi-a',
          saleOrderProductId: 'op-1',
          productName: '',
          amount: 10000,
          paymentMode: 'direct',
          remark: null,
        },
      ],
    });
    expect(payload.items![0]!.productName).toBe(null);
  });
});
