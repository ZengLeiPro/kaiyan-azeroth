import { describe, expect, it } from 'vitest';

import { buildEntityVersionMap } from '@/lib/api';

import { buildSaleOrderBulkEditPayload, toSaleOrderBulkDateOnly } from './sale-order-bulk-payload';

describe('SaleOrderBulkEditModal 日期提交', () => {
  it('把 Date 按用户本地日历日提交为 YYYY-MM-DD，不生成 ISO 时间戳', () => {
    const selectedLocalDay = new Date(2024, 1, 29, 23, 59, 59);

    const value = toSaleOrderBulkDateOnly(selectedLocalDay);

    expect(value).toBe('2024-02-29');
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value).not.toContain('T');
  });
});

describe('SaleOrderBulkEditModal 乐观锁 payload', () => {
  it('把当前选中行的真实 version 与 ids、patch 一起提交', () => {
    const selectedRows = [
      { id: 'order-1', version: 2 },
      { id: 'order-2', version: 7 },
    ];
    const ids = selectedRows.map((row) => row.id);
    const versions = buildEntityVersionMap(selectedRows);

    expect(buildSaleOrderBulkEditPayload(ids, versions, { remark: '修正' })).toEqual({
      ids: ['order-1', 'order-2'],
      versions: { 'order-1': 2, 'order-2': 7 },
      patch: { remark: '修正' },
    });
  });
});
