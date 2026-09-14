import { describe, expect, it } from 'vitest';

import { APPROVAL_FILTER_REGISTRIES } from '../approvals.filter-registry';

describe('APPROVAL_FILTER_REGISTRIES', () => {
  it('五个审批 Tab 应使用稳定且互不冲突的 pageKey', () => {
    const pageKeys = APPROVAL_FILTER_REGISTRIES.map((registry) => registry.pageKey);

    expect(pageKeys).toEqual([
      'approvals.pending',
      'approvals.completed',
      'approvals.copy_to',
      'approvals.initiated',
      'approvals.all',
    ]);
    expect(new Set(pageKeys).size).toBe(pageKeys.length);
  });

  it.each(APPROVAL_FILTER_REGISTRIES)('$pageKey 应完整注册页面原有筛选字段', (registry) => {
    expect(Object.keys(registry.fields)).toEqual(['eventType', 'title']);
    expect(registry.defaults).toEqual({
      fields: [{ fieldKey: 'eventType', control: 'multiSelect' }],
      keyword: {
        enabled: true,
        fieldKeys: ['title'],
        placeholder: '搜索标题...',
      },
    });
  });

  it('表单类型选项应保持原页面的值、顺序和标签', () => {
    expect(APPROVAL_FILTER_REGISTRIES[0].fields.eventType.optionsSource?.()).toEqual([
      { value: 'sale_order_activate', label: '合同订单审批' },
      { value: 'sale_order_change', label: '合同订单变更审批' },
      { value: 'sale_order_void', label: '合同订单纠错作废审批' },
      { value: 'invoice_approve', label: '开票申请审批' },
      { value: 'invoice_change', label: '开票变更审批' },
      { value: 'payment_approve', label: '回款审批' },
      { value: 'payment_change', label: '回款变更审批' },
      { value: 'payment_refund_approve', label: '退款审批' },
      { value: 'payment_refund_change', label: '退款变更审批' },
      { value: 'visit_approve', label: '拜访审批' },
      { value: 'visit_change', label: '拜访变更审批' },
    ]);
  });
});
