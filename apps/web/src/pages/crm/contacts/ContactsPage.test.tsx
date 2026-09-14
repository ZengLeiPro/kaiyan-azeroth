import { describe, expect, it } from 'vitest';

import { CONTACT_COLUMN_CONFIG, getContactMobileFields } from './contact-display';
import type { ContactProfile } from './types';

describe('联系人展示配置', () => {
  it('表格与移动端均展示创建人', () => {
    expect(CONTACT_COLUMN_CONFIG).toContainEqual({
      key: 'createdBy',
      label: '创建人',
      visible: true,
    });

    const fields = getContactMobileFields({
      customer: { id: 'customer-1', customerName: '测试客户', shortName: null },
      sex: null,
      mobile: null,
      phone: null,
      position: null,
      email: null,
      wechat: null,
      createdBy: '王创建',
      updatedAt: '2026-09-04T00:00:00.000Z',
      updatedBy: '李修改',
    } as ContactProfile);

    expect(fields).toContainEqual({ label: '创建人', value: '王创建' });

    const fallbackFields = getContactMobileFields({ createdBy: null } as ContactProfile);
    expect(fallbackFields).toContainEqual({ label: '创建人', value: '-' });
  });
});
