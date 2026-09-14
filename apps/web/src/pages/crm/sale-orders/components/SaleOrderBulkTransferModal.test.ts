import { describe, expect, it } from 'vitest';

import { buildEntityVersionMap } from '@/lib/api';

import { buildSaleOrderBulkTransferPayload } from './sale-order-bulk-payload';

describe('SaleOrderBulkTransferModal 乐观锁 payload', () => {
  it('把当前选中行的真实 version 与 ids、chargerId 一起提交', () => {
    const selectedRows = [
      { id: 'order-1', version: 3 },
      { id: 'order-2', version: 9 },
    ];
    const ids = selectedRows.map((row) => row.id);
    const versions = buildEntityVersionMap(selectedRows);

    expect(buildSaleOrderBulkTransferPayload(ids, versions, 'employee-new')).toEqual({
      ids: ['order-1', 'order-2'],
      versions: { 'order-1': 3, 'order-2': 9 },
      chargerId: 'employee-new',
    });
  });
});
