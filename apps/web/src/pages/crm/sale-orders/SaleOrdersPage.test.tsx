import { describe, expect, it } from 'vitest';

import { SALE_ORDER_COLUMN_CONFIG } from './sale-order-column-config';
import { createInitialSaleOrderFormData } from './SaleOrdersPage';

describe('createInitialSaleOrderFormData', () => {
  it('新建订单默认坏账金额为 0，并带入当前负责人', () => {
    const form = createInitialSaleOrderFormData('employee-1');

    expect(form.badDebtAmount).toBe(0);
    expect(form.chargerId).toBe('employee-1');
  });

  it('没有当前负责人时保持空负责人', () => {
    expect(createInitialSaleOrderFormData(null).chargerId).toBeNull();
  });

  it('将坏账金额作为可配置的默认列表列', () => {
    expect(SALE_ORDER_COLUMN_CONFIG).toContainEqual({
      key: 'badDebtAmount',
      label: '坏账金额',
      visible: true,
    });
  });
});
