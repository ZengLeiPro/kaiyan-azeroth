import {
  SALES_ACTION_ITEM_CATEGORY_LABELS,
  SALES_ACTION_ITEM_CONFIDENCE_LABELS,
  SALES_ACTION_ITEM_DONE_TYPE_LABELS,
  SALES_ACTION_ITEM_STATUS_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import {
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterFieldBuildValue,
  toOptions,
  toStringArray,
} from '../../common/filter-scheme';

const SALES_ACTION_ITEMS_PAGE_KEY = 'crm.sales_action_items';

const CATEGORY_SET = new Set<string>(Object.keys(SALES_ACTION_ITEM_CATEGORY_LABELS));
const STATUS_SET = new Set<string>(Object.keys(SALES_ACTION_ITEM_STATUS_LABELS));
const DONE_TYPE_SET = new Set<string>(Object.keys(SALES_ACTION_ITEM_DONE_TYPE_LABELS));
const CONFIDENCE_SET = new Set<string>(Object.keys(SALES_ACTION_ITEM_CONFIDENCE_LABELS));

export const SALES_ACTION_ITEMS_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: SALES_ACTION_ITEMS_PAGE_KEY,
  pageName: '销售待办列表',
  fields: {
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(SALES_ACTION_ITEM_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', STATUS_SET, value),
    },
    category: {
      label: '类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(SALES_ACTION_ITEM_CATEGORY_LABELS),
      build: (value) => buildEnumFilter('category', CATEGORY_SET, value),
    },
    doneType: {
      label: '办结类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(SALES_ACTION_ITEM_DONE_TYPE_LABELS),
      build: (value) => buildEnumFilter('doneType', DONE_TYPE_SET, value),
    },
    confidence: {
      label: '置信度',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: () => toOptions(SALES_ACTION_ITEM_CONFIDENCE_LABELS),
      build: (value) => buildEnumFilter('confidence', CONFIDENCE_SET, value),
    },
    employeeId: {
      label: '收件销售',
      dataType: 'foreignKey',
      entity: 'employee',
      isScopeField: true,
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: (value) => buildEmployeeFilter(value),
    },
    customerId: {
      label: '客户',
      dataType: 'foreignKey',
      entity: 'customer',
      allowedControls: ['entitySelect', 'entityMultiSelect'],
      build: buildCustomerFilter,
    },
    sourceRunId: {
      label: '夜间批次',
      dataType: 'string',
      allowedControls: ['text'],
      build: (value) => buildExactStringFilter('sourceRunId', value),
    },
    createdAt: {
      label: '创建时间',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('createdAt', value),
    },
    updatedAt: {
      label: '最近修改',
      dataType: 'date',
      allowedControls: ['date', 'dateRange'],
      build: (value) => buildDateFilter('updatedAt', value),
    },
    title: {
      label: '标题',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('title', value),
    },
    reason: {
      label: '原因',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('reason', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'status', control: 'multiSelect' },
      { fieldKey: 'doneType', control: 'multiSelect' },
      { fieldKey: 'category', control: 'multiSelect' },
      { fieldKey: 'customerId', control: 'entityMultiSelect' },
      { fieldKey: 'createdAt', control: 'dateRange' },
      { fieldKey: 'employeeId', control: 'entityMultiSelect' },
      { fieldKey: 'sourceRunId', control: 'text' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['title', 'reason'],
      placeholder: '标题/原因',
    },
  },
});

function buildEmployeeFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const selected = toStringArray(value);
  if (!selected || selected.length === 0) return null;
  return {
    employeeId: {
      in: selected,
    },
  };
}

function buildCustomerFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const selected = toStringArray(value);
  if (!selected || selected.length === 0) return null;

  return {
    OR: [
      { refType: 'Customer', refId: { in: selected } },
      ...selected.flatMap((customerId) => [
        { aiDraft: { path: ['matchedCustomerId'], equals: customerId } },
        { aiDraft: { path: ['payload', 'customerId'], equals: customerId } },
      ]),
    ],
  };
}

function buildExactStringFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return { [fieldKey]: trimmed };
}
