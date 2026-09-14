import { describe, expect, it } from 'vitest';

import { FINANCE_ACCOUNT_FILTER_REGISTRY } from '../accounts/accounts.filter-registry';
import { FINANCE_SUBJECT_FILTER_REGISTRY } from '../subjects/subjects.filter-registry';

describe('finance filter registries', () => {
  it('账户字典保留现有默认筛选及关键词字段', () => {
    expect(FINANCE_ACCOUNT_FILTER_REGISTRY.pageKey).toBe('finance.accounts');
    expect(FINANCE_ACCOUNT_FILTER_REGISTRY.defaults).toEqual({
      fields: [
        { fieldKey: 'kind', control: 'select', width: 'w-32' },
        { fieldKey: 'status', control: 'select', width: 'w-32' },
      ],
      keyword: {
        enabled: true,
        fieldKeys: ['code', 'name'],
        placeholder: '代码/账户名称',
      },
    });
    expect(FINANCE_ACCOUNT_FILTER_REGISTRY.fields.kind.optionsSource?.()).toEqual([
      { value: 'virtual', label: '虚拟' },
      { value: 'bank', label: '银行' },
      { value: 'alipay', label: '支付宝' },
      { value: 'wechat', label: '微信' },
      { value: 'cash', label: '现金' },
    ]);
  });

  it('科目字典保留现有默认筛选及关键词字段', () => {
    expect(FINANCE_SUBJECT_FILTER_REGISTRY.pageKey).toBe('finance.subjects');
    expect(FINANCE_SUBJECT_FILTER_REGISTRY.defaults.fields).toEqual([
      { fieldKey: 'category', control: 'multiSelect', width: 'w-44' },
      { fieldKey: 'level', control: 'select', width: 'w-32' },
      { fieldKey: 'status', control: 'select', width: 'w-32' },
    ]);
    expect(FINANCE_SUBJECT_FILTER_REGISTRY.defaults.keyword).toEqual({
      enabled: true,
      fieldKeys: ['code', 'name'],
      placeholder: '代码/科目名称',
    });
  });

  it('科目层级筛选将 UI 字符串转换为 Prisma 数字条件', () => {
    expect(FINANCE_SUBJECT_FILTER_REGISTRY.fields.level.build('1')).toEqual({ level: 1 });
    expect(FINANCE_SUBJECT_FILTER_REGISTRY.fields.level.build('2')).toEqual({ level: 2 });
    expect(FINANCE_SUBJECT_FILTER_REGISTRY.fields.level.build('3')).toBeNull();
  });
});
