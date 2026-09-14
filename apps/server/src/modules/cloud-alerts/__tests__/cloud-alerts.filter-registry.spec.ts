import { describe, expect, it } from 'vitest';

import { serializeFilterRegistry } from '../../../common/filter-scheme';
import { CLOUD_ALERT_FILTER_REGISTRY } from '../cloud-alerts.filter-registry';

describe('CLOUD_ALERT_FILTER_REGISTRY', () => {
  it('默认展示可隐藏的关键词，并注册全部现存查询筛选项', () => {
    expect(CLOUD_ALERT_FILTER_REGISTRY.pageKey).toBe('ops.cloud_cost.alerts');
    expect(CLOUD_ALERT_FILTER_REGISTRY.defaults).toEqual({
      fields: [{ fieldKey: 'keyword', control: 'text' }],
      keyword: { enabled: false, fieldKeys: [], placeholder: null },
    });
    expect(Object.keys(CLOUD_ALERT_FILTER_REGISTRY.fields)).toEqual([
      'keyword',
      'vendor',
      'level',
      'category',
      'status',
      'triggeredAt',
    ]);
  });

  it('序列化后保留预警枚举选项供个人显示配置使用', () => {
    const registry = serializeFilterRegistry(CLOUD_ALERT_FILTER_REGISTRY);
    expect(registry.fields.find((field) => field.fieldKey === 'status')?.options).toEqual([
      { value: 'active', label: '待处理' },
      { value: 'resolved', label: '已处理' },
      { value: 'dismissed', label: '已忽略' },
    ]);
  });
});
