import type { IContactResponse } from '@ky-azeroth/shared/types/contact';
import { describe, expect, it } from 'vitest';

import { toContactFormData, toContactPayload, toContactProfile } from '../types';

const baseContact: IContactResponse = {
  id: 'contact-1',
  contactName: ' 张三 ',
  customerId: 'customer-1',
  sex: null,
  mobile: ' 13800000000 ',
  phone: '',
  email: ' zhang@example.com ',
  wechat: null,
  position: ' CTO ',
  department: null,
  remark: ' 关键联系人 ',
  flowStatus: null,
  status: 'active',
  version: 2,
};

describe('contact types converters', () => {
  it('API 响应转 Profile/FormData 时保留字段和 version', () => {
    const profile = toContactProfile(baseContact);
    const form = toContactFormData(profile);

    expect(profile).toEqual(baseContact);
    expect(form.contactName).toBe(' 张三 ');
    expect(form.version).toBe(2);
  });

  it('提交 payload 时 trim 字符串并将空字符串转为 null', () => {
    const payload = toContactPayload({
      contactName: ' 张三 ',
      customerId: 'customer-1',
      sex: '',
      mobile: ' 13800000000 ',
      phone: '',
      email: ' zhang@example.com ',
      wechat: ' ',
      position: ' CTO ',
      department: '',
      remark: ' 关键联系人 ',
      version: 2,
    });

    expect(payload.contactName).toBe('张三');
    expect(payload.mobile).toBe('13800000000');
    expect(payload.phone).toBeNull();
    expect(payload.wechat).toBeNull();
    expect(payload.position).toBe('CTO');
    expect(payload.department).toBeNull();
    expect(payload.remark).toBe('关键联系人');
  });
});
