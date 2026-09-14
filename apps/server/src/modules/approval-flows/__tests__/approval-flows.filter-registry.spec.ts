import { describe, expect, it } from 'vitest';

import {
  APPROVAL_FLOW_FILTER_REGISTRY,
  APPROVAL_SETTINGS_FILTER_REGISTRY,
} from '../approval-flows.filter-registry';

describe('approval-flows filter registries', () => {
  it('审批设置应使用独立 pageKey 并完整注册现有筛选字段', () => {
    expect(APPROVAL_SETTINGS_FILTER_REGISTRY.pageKey).toBe('approval_settings');
    expect(APPROVAL_SETTINGS_FILTER_REGISTRY.pageKey).not.toBe(
      APPROVAL_FLOW_FILTER_REGISTRY.pageKey
    );
    expect(APPROVAL_SETTINGS_FILTER_REGISTRY.defaults).toEqual({
      fields: [
        { fieldKey: 'category', control: 'multiSelect' },
        { fieldKey: 'enabled', control: 'select' },
      ],
      keyword: {
        enabled: true,
        fieldKeys: ['label'],
        placeholder: '模块名称',
      },
    });
  });

  it('审批设置分类和开关选项应与页面原有值一致', () => {
    expect(APPROVAL_SETTINGS_FILTER_REGISTRY.fields.category.optionsSource?.()).toEqual([
      { value: 'crm', label: 'CRM' },
      { value: 'project', label: '项目管理' },
    ]);
    expect(APPROVAL_SETTINGS_FILTER_REGISTRY.fields.enabled.optionsSource?.()).toEqual([
      { value: 'true', label: '已启用' },
      { value: 'false', label: '未启用' },
    ]);
  });
});
