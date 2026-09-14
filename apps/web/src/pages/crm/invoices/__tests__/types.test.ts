import type { IInvoiceResponse } from '@ky-azeroth/shared/types/invoice';
import { describe, expect, it } from 'vitest';

import {
  buildInvoicePrefillClears,
  buildInvoicePrefillUpdates,
  extractInvoicePrefillValues,
  hasInvoicePrefillValues,
} from '../invoice-prefill';
import { toInvoiceFormData, toInvoicePayload, toInvoiceProfile } from '../types';

const baseInvoice = {
  id: 'inv-1',
  serialNumber: 'FP0001',
  subject: '软件开发服务费',
  saleOrderId: '11111111-1111-1111-1111-111111111111',
  customerId: '22222222-2222-2222-2222-222222222222',
  invoiceAmount: 100,
  invoiceType: '增值税专用发票',
  invoiceDate: '2026-05-14T00:00:00.000Z',
  invoiceNumber: 'INV-001',
  title: '示例科技',
  taxIdentifyNum: '91330000MA1XXXXX',
  invoiceStatus: 'pending',
  itemType: null,
  bankName: null,
  bankAccount: null,
  registeredAddress: null,
  registeredPhone: null,
  remark: null,
  flowStatus: null,
  status: 'active',
  version: 1,
} satisfies IInvoiceResponse;

describe('invoice date conversion', () => {
  it('响应转 Profile/FormData 时把开票日期规范为 YYYY-MM-DD', () => {
    const profile = toInvoiceProfile(baseInvoice);
    const form = toInvoiceFormData(profile);

    expect(profile.invoiceDate).toBe('2026-05-14');
    expect(form.invoiceDate).toBe('2026-05-14');
  });

  it('提交 payload 时只提交 YYYY-MM-DD，避免把 ISO 字符串回写给后端', () => {
    const payload = toInvoicePayload({
      saleOrderId: baseInvoice.saleOrderId,
      customerId: baseInvoice.customerId,
      subject: baseInvoice.subject,
      invoiceAmount: 100,
      invoiceType: baseInvoice.invoiceType,
      invoiceDate: '2026-05-14T00:00:00.000Z',
      invoiceNumber: baseInvoice.invoiceNumber,
      title: baseInvoice.title,
      taxIdentifyNum: baseInvoice.taxIdentifyNum,
      invoiceStatus: baseInvoice.invoiceStatus,
      itemType: baseInvoice.itemType,
      bankName: baseInvoice.bankName,
      bankAccount: baseInvoice.bankAccount,
      registeredAddress: baseInvoice.registeredAddress,
      registeredPhone: baseInvoice.registeredPhone,
      remark: baseInvoice.remark,
      version: 1,
    });

    expect(payload.invoiceDate).toBe('2026-05-14');
  });
});

describe('invoice prefill rules', () => {
  const blankForm = toInvoiceFormData({
    ...baseInvoice,
    invoiceType: null,
    title: null,
    taxIdentifyNum: null,
    itemType: null,
    bankName: null,
    bankAccount: null,
    registeredAddress: null,
    registeredPhone: null,
  });

  const template = extractInvoicePrefillValues({
    invoiceType: '增值税专用发票',
    title: '示例科技有限公司',
    taxIdentifyNum: '91350100MA00000000',
    itemType: '技术服务',
    bankName: '招商银行福州分行',
    bankAccount: '1234567890',
    registeredAddress: '福州市软件园',
    registeredPhone: '0591-12345678',
  });

  it('只把历史开票资料填入空字段', () => {
    expect(buildInvoicePrefillUpdates(blankForm, template)).toEqual(template);
  });

  it('能识别历史发票是否含可回填资料', () => {
    expect(hasInvoicePrefillValues({ title: '示例科技有限公司' })).toBe(true);
    expect(hasInvoicePrefillValues({ title: '   ', taxIdentifyNum: null })).toBe(false);
  });

  it('不覆盖用户已经手填的字段', () => {
    const updates = buildInvoicePrefillUpdates({ ...blankForm, title: '用户手填抬头' }, template);

    expect(updates.title).toBeUndefined();
    expect(updates.taxIdentifyNum).toBe(template.taxIdentifyNum);
  });

  it('切换客户时，允许把上一次自动填入的值替换为新客户模板', () => {
    const nextTemplate = extractInvoicePrefillValues({
      ...template,
      title: '新客户抬头',
      taxIdentifyNum: '91350200MA11111111',
    });

    const updates = buildInvoicePrefillUpdates(
      { ...blankForm, title: template.title, taxIdentifyNum: template.taxIdentifyNum },
      nextTemplate,
      template
    );

    expect(updates.title).toBe('新客户抬头');
    expect(updates.taxIdentifyNum).toBe('91350200MA11111111');
  });

  it('切换到无模板客户时，只清空上一次自动填入且未被用户修改的字段', () => {
    const clears = buildInvoicePrefillClears(
      { ...blankForm, title: template.title, taxIdentifyNum: '用户改过的税号' },
      template
    );

    expect(clears.title).toBeNull();
    expect(clears.taxIdentifyNum).toBeUndefined();
  });
});
