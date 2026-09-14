import type { Dispatch, SetStateAction } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  getSingleCustomerIdFromFilters,
  openCreateWithCustomerPreset,
} from '../customer-create-preset';

describe('customer-create-preset', () => {
  it('只在筛选条件能确定唯一客户时返回 customerId', () => {
    expect(
      getSingleCustomerIdFromFilters({
        customerId: ['customer-a'],
        status: '',
      })
    ).toBe('customer-a');

    expect(
      getSingleCustomerIdFromFilters({
        'filters[customerId][]': ['customer-a', 'customer-b'],
      })
    ).toBeNull();

    expect(
      getSingleCustomerIdFromFilters({
        customerId: '',
      })
    ).toBeNull();
  });

  it('打开新增弹窗后把唯一 customerId 写入表单', () => {
    const openCreateDialog = vi.fn();
    let formData = { customerId: '', remark: 'old' };
    const setFormData: Dispatch<SetStateAction<typeof formData>> = (action) => {
      formData = typeof action === 'function' ? action(formData) : action;
    };

    openCreateWithCustomerPreset({ customerId: 'customer-a' }, openCreateDialog, setFormData);

    expect(openCreateDialog).toHaveBeenCalledTimes(1);
    expect(formData).toEqual({ customerId: 'customer-a', remark: 'old' });
  });
});
