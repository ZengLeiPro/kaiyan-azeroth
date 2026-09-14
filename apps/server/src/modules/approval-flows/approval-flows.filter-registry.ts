import { APPROVAL_EVENT_REGISTRY } from '@ky-azeroth/shared/constants/approval-events';

import {
  buildDateFilter,
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterOption,
} from '../../common/filter-scheme';

const APPROVAL_FLOW_PAGE_KEY = 'approval_flows';
const APPROVAL_SETTINGS_PAGE_KEY = 'approval_settings';

const EVENT_TYPE_SET = new Set<string>(Object.keys(APPROVAL_EVENT_REGISTRY));
const APPROVAL_CATEGORY_SET = new Set<string>(
  Object.values(APPROVAL_EVENT_REGISTRY).map((config) => config.category)
);
const APPROVAL_ENABLED_SET = new Set<string>(['true', 'false']);

// 审批流状态只取 registry 实际支持的值（queryApprovalFlowSchema 枚举）
const FLOW_STATUS_LABELS: Record<string, string> = {
  active: '激活',
  inactive: '停用',
  deleted: '已删除',
};
const FLOW_STATUS_SET = new Set<string>(Object.keys(FLOW_STATUS_LABELS));

function eventTypeOptions(): FilterOption[] {
  return Object.entries(APPROVAL_EVENT_REGISTRY).map(([value, cfg]) => ({
    value,
    label: cfg.label,
  }));
}

function flowStatusOptions(): FilterOption[] {
  return Object.entries(FLOW_STATUS_LABELS).map(([value, label]) => ({ value, label }));
}

function approvalCategoryOptions(): FilterOption[] {
  return Array.from(
    new Map(
      Object.values(APPROVAL_EVENT_REGISTRY).map((config) => [
        config.category,
        config.categoryLabel,
      ])
    )
  ).map(([value, label]) => ({ value, label }));
}

export const APPROVAL_SETTINGS_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: APPROVAL_SETTINGS_PAGE_KEY,
  pageName: '审批设置',
  fields: {
    category: {
      label: '所属分类',
      dataType: 'enum',
      allowedControls: ['multiSelect'],
      optionsSource: approvalCategoryOptions,
      build: (value) => buildEnumFilter('category', APPROVAL_CATEGORY_SET, value),
    },
    enabled: {
      label: '审批开关',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => [
        { value: 'true', label: '已启用' },
        { value: 'false', label: '未启用' },
      ],
      build: (value) => buildEnumFilter('enabled', APPROVAL_ENABLED_SET, value),
    },
    label: {
      label: '业务模块',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('label', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'category', control: 'multiSelect' },
      { fieldKey: 'enabled', control: 'select' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['label'],
      placeholder: '模块名称',
    },
  },
});

export const APPROVAL_FLOW_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: APPROVAL_FLOW_PAGE_KEY,
  pageName: '审批流程列表',
  fields: {
    eventType: {
      label: '事件类型',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: eventTypeOptions,
      build: (value) => buildEnumFilter('eventType', EVENT_TYPE_SET, value),
    },
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select', 'multiSelect'],
      optionsSource: flowStatusOptions,
      build: (value) => buildEnumFilter('status', FLOW_STATUS_SET, value),
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
    code: {
      label: '流程编码',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('code', value),
    },
    name: {
      label: '流程名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'eventType', control: 'multiSelect' },
      { fieldKey: 'status', control: 'select' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['code', 'name'],
      placeholder: '流程编码/名称',
    },
  },
});
