import { describe, expect, it } from 'vitest';

import { customerToTrashItem, type DeletedCustomerProfile } from '../types';

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

describe('customer trash optimistic lock mapping', () => {
  it('保留回收站响应中的真实 version，供恢复与永久删除透传', () => {
    const item = customerToTrashItem({
      id: CUSTOMER_ID,
      serialNumber: 'KH0001',
      customerName: '测试客户',
      deletedAt: '2026-08-24T00:00:00.000Z',
      version: 7,
    } as DeletedCustomerProfile);

    expect(item).toEqual(
      expect.objectContaining({
        id: CUSTOMER_ID,
        version: 7,
        restoreEndpoint: `/customers/${CUSTOMER_ID}/restore`,
        permanentDeleteEndpoint: `/customers/${CUSTOMER_ID}/permanent`,
      })
    );
  });
});
