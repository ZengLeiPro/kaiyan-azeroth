import { describe, expect, it } from 'vitest';

import { CLOUD_INSTANCE_META_FILTER_REGISTRY } from '../cloud-instance-metas.filter-registry';

describe('CLOUD_INSTANCE_META_FILTER_REGISTRY', () => {
  it('默认展示可隐藏的关键词，并注册实例现存查询筛选项', () => {
    expect(CLOUD_INSTANCE_META_FILTER_REGISTRY.pageKey).toBe('ops.cloud_cost.instances');
    expect(CLOUD_INSTANCE_META_FILTER_REGISTRY.defaults).toEqual({
      fields: [{ fieldKey: 'keyword', control: 'text' }],
      keyword: { enabled: false, fieldKeys: [], placeholder: null },
    });
    expect(Object.keys(CLOUD_INSTANCE_META_FILTER_REGISTRY.fields)).toEqual([
      'keyword',
      'vendor',
      'productCode',
      'ownerCategory',
      'renewalIntent',
      'archived',
    ]);
  });

  it('归档状态保留布尔构建语义', () => {
    expect(CLOUD_INSTANCE_META_FILTER_REGISTRY.fields.archived.build(true)).toEqual({
      archived: true,
    });
    expect(CLOUD_INSTANCE_META_FILTER_REGISTRY.fields.archived.build(false)).toEqual({
      archived: false,
    });
  });
});
