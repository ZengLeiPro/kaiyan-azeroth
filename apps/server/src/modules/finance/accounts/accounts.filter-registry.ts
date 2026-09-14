import {
  buildEnumFilter,
  buildStringFilter,
  defineFilterRegistry,
  type FilterOption,
} from '../../../common/filter-scheme';

export const FINANCE_ACCOUNT_PAGE_KEY = 'finance.accounts';

const ACCOUNT_KIND_LABELS: Record<string, string> = {
  virtual: '虚拟',
  bank: '银行',
  alipay: '支付宝',
  wechat: '微信',
  cash: '现金',
};

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: '启用',
  inactive: '停用',
};

const ACCOUNT_KIND_SET = new Set(Object.keys(ACCOUNT_KIND_LABELS));
const ACCOUNT_STATUS_SET = new Set(Object.keys(ACCOUNT_STATUS_LABELS));

function toOptions(labels: Record<string, string>): FilterOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const FINANCE_ACCOUNT_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: FINANCE_ACCOUNT_PAGE_KEY,
  pageName: '账户字典',
  fields: {
    kind: {
      label: '类型',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(ACCOUNT_KIND_LABELS),
      build: (value) => buildEnumFilter('kind', ACCOUNT_KIND_SET, value),
    },
    status: {
      label: '状态',
      dataType: 'enum',
      allowedControls: ['select'],
      optionsSource: () => toOptions(ACCOUNT_STATUS_LABELS),
      build: (value) => buildEnumFilter('status', ACCOUNT_STATUS_SET, value),
    },
    code: {
      label: '代码',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('code', value),
    },
    name: {
      label: '账户名称',
      dataType: 'string',
      searchable: true,
      allowedControls: ['text'],
      build: (value) => buildStringFilter('name', value),
    },
  },
  defaults: {
    fields: [
      { fieldKey: 'kind', control: 'select', width: 'w-32' },
      { fieldKey: 'status', control: 'select', width: 'w-32' },
    ],
    keyword: {
      enabled: true,
      fieldKeys: ['code', 'name'],
      placeholder: '代码/账户名称',
    },
  },
});
