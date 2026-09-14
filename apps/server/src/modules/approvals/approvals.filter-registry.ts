import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';

import {
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterOption,
} from '../../common/filter-scheme';

const APPROVAL_EVENT_TYPE_LABELS: Record<string, string> = {
  [APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE]: '合同订单审批',
  [APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE]: '合同订单变更审批',
  [APPROVAL_EVENT_TYPE.SALE_ORDER_VOID]: '合同订单纠错作废审批',
  [APPROVAL_EVENT_TYPE.INVOICE_APPROVE]: '开票申请审批',
  [APPROVAL_EVENT_TYPE.INVOICE_CHANGE]: '开票变更审批',
  [APPROVAL_EVENT_TYPE.PAYMENT_APPROVE]: '回款审批',
  [APPROVAL_EVENT_TYPE.PAYMENT_CHANGE]: '回款变更审批',
  [APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE]: '退款审批',
  [APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE]: '退款变更审批',
  [APPROVAL_EVENT_TYPE.VISIT_APPROVE]: '拜访审批',
  [APPROVAL_EVENT_TYPE.VISIT_CHANGE]: '拜访变更审批',
};

const APPROVAL_EVENT_TYPE_SET = new Set(Object.keys(APPROVAL_EVENT_TYPE_LABELS));

function eventTypeOptions(): FilterOption[] {
  return Object.entries(APPROVAL_EVENT_TYPE_LABELS).map(([value, label]) => ({ value, label }));
}

interface ApprovalRegistryOptions {
  pageKey: string;
  pageName: string;
  keywordFieldKeys: string[];
}

function createApprovalFilterRegistry({
  pageKey,
  pageName,
  keywordFieldKeys,
}: ApprovalRegistryOptions) {
  return defineFilterRegistry({
    pageKey,
    pageName,
    fields: {
      eventType: {
        label: '表单类型',
        dataType: 'enum',
        allowedControls: ['multiSelect'],
        optionsSource: eventTypeOptions,
        build: (value) => buildEnumFilter('eventType', APPROVAL_EVENT_TYPE_SET, value),
      },
      title: {
        label: '标题名称',
        dataType: 'string',
        searchable: true,
        allowedControls: ['text'],
        build: (value) => buildStringFilter('title', value),
      },
    },
    defaults: {
      fields: [{ fieldKey: 'eventType', control: 'multiSelect' }],
      keyword: {
        enabled: true,
        fieldKeys: keywordFieldKeys,
        placeholder: '搜索标题...',
      },
    },
  });
}

export const APPROVAL_PENDING_FILTER_REGISTRY = createApprovalFilterRegistry({
  pageKey: 'approvals.pending',
  pageName: '待我审批',
  keywordFieldKeys: ['title'],
});

export const APPROVAL_COMPLETED_FILTER_REGISTRY = createApprovalFilterRegistry({
  pageKey: 'approvals.completed',
  pageName: '我已审批',
  keywordFieldKeys: ['title'],
});

export const APPROVAL_COPY_TO_FILTER_REGISTRY = createApprovalFilterRegistry({
  pageKey: 'approvals.copy_to',
  pageName: '抄送我的',
  keywordFieldKeys: ['title'],
});

export const APPROVAL_INITIATED_FILTER_REGISTRY = createApprovalFilterRegistry({
  pageKey: 'approvals.initiated',
  pageName: '我发起的',
  keywordFieldKeys: ['title'],
});

export const APPROVAL_ALL_FILTER_REGISTRY = createApprovalFilterRegistry({
  pageKey: 'approvals.all',
  pageName: '全部审批',
  keywordFieldKeys: ['title'],
});

export const APPROVAL_FILTER_REGISTRIES = [
  APPROVAL_PENDING_FILTER_REGISTRY,
  APPROVAL_COMPLETED_FILTER_REGISTRY,
  APPROVAL_COPY_TO_FILTER_REGISTRY,
  APPROVAL_INITIATED_FILTER_REGISTRY,
  APPROVAL_ALL_FILTER_REGISTRY,
] as const;
