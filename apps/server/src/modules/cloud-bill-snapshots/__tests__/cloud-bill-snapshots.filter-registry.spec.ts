import { describe, expect, it } from 'vitest';

import { CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY } from '../cloud-bill-snapshots.filter-registry';

describe('CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY', () => {
  it('默认展示可隐藏的关键词，并注册账单现存查询筛选项', () => {
    expect(CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY.pageKey).toBe('ops.cloud_cost.bills');
    expect(CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY.defaults).toEqual({
      fields: [{ fieldKey: 'keyword', control: 'text' }],
      keyword: { enabled: false, fieldKeys: [], placeholder: null },
    });
    expect(Object.keys(CLOUD_BILL_SNAPSHOT_FILTER_REGISTRY.fields)).toEqual([
      'keyword',
      'vendor',
      'billingCycle',
      'snapshotDate',
    ]);
  });
});
