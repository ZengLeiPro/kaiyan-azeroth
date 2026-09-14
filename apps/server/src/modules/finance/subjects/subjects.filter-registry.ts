import {
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterFieldBuildValue,
  type FilterOption,
} from '../../../common/filter-scheme';

export const FINANCE_SUBJECT_PAGE_KEY = 'finance.subjects';

const SUBJECT_CATEGORY_LABELS: Record<string, string> = {
  revenue: '营业收入',
  cogs: '营业成本',
  opex: '期间费用',
  tax: '税金',
  other_income: '营业外收入',
  non_pl: '非 P&L',
};

const SUBJECT_LEVEL_LABELS: Record<string, string> = {
  '1': '分组',
  '2': '叶子',
};

const SUBJECT_STATUS_LABELS: Record<string, string> = {
  active: '启用',
  inactive: '停用',
};

const SUBJECT_CATEGORY_SET = new Set(Object.keys(SUBJECT_CATEGORY_LABELS));
const SUBJECT_STATUS_SET = new Set(Object.keys(SUBJECT_STATUS_LABELS));

function toOptions(labels: Record<string, string>): FilterOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

function buildLevelFilter(value: FilterFieldBuildValue): Record<string, unknown> | null {
  const selected = Array.isArray(value) ? value[0] : value;
  if (selected !== '1' && selected !== '2') return null;
  return { level: Number(selected) };
}

export const FINANCE_SUBJECT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: FINANCE_SUBJECT_PAGE_KEY,
  pageName: '科目字典',
  fields: {
    category: {
      label: '大类',
      dataType: 'enum',
      allowedControls: ['multiSelect'],
      optionsSource: () => toOptions(SUBJECT_CATEGORY_LABELS),
      build: (value) => buildEnumFilter('category', SUBJECT_CATEGORY_SET, value),
    },
    level: {
      label: '层级',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(SUBJECT_LEVEL_LABELS),
      build: buildLevelFilter,
    },
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(SUBJECT_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', SUBJECT_STATUS_SET, value),
    },
    code: {
      label: '代码',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('code', value),
    },
    name: {
      label: '科目名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'category', control: 'multiSelect', width: 'w-44' },
      { fieldKey: 'level', control: 'select', width: 'w-32' },
      { fieldKey: 'status', control: 'select', width: 'w-32' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['code', 'name'],
      placeholder: '代码/科目名称',
    },
  },
});
