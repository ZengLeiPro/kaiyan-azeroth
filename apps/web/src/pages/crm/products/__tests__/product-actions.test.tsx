import { describe, expect, it, vi } from 'vitest';

import { createCrmProductActions } from '../product-actions';
import type { CrmProductProfile } from '../types';

const product: CrmProductProfile = {
  id: 'product-1',
  productName: '测试产品',
  productNumber: null,
  productTypes: null,
  productUnit: null,
  standardPrice: null,
  productStatus: 'on_sale',
  remark: null,
  flowStatus: null,
  status: 'active',
  version: 2,
};

describe('createCrmProductActions', () => {
  it('should expose the off-sale action and hide it for off-sale products', () => {
    const onOffSale = vi.fn();
    const actions = createCrmProductActions({
      onView: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onOffSale,
      canEdit: true,
      canDelete: true,
    });
    const offSaleAction = actions.find((action) => action.key === 'off-sale');

    expect(offSaleAction).toBeDefined();
    offSaleAction?.onClick(product);
    expect(onOffSale).toHaveBeenCalledWith(product);
    expect(offSaleAction?.hidden?.(product)).toBe(false);
    expect(offSaleAction?.hidden?.({ ...product, productStatus: 'off_sale' })).toBe(true);
  });

  it('should hide edit, delete, and off-sale actions without permissions', () => {
    const actions = createCrmProductActions({
      onView: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onOffSale: vi.fn(),
      canEdit: false,
      canDelete: false,
    });

    expect(actions.map((action) => action.key)).toEqual(['view']);
  });
});
