import {
  buildDateFilter,
  buildEnumFilter,
  buildForeignKeyFilter,
  buildStringFilter,
  defineFilterRegistry,
  toOptions,
} from '../../common/filter-scheme';

export const FINANCE_LEDGER_PAGE_KEY = 'finance.ledger';
export const FINANCE_PERSONAL_LEDGER_PAGE_KEY = 'finance.personal_ledger';
export const FINANCE_PNL_PAGE_KEY = 'finance.pnl';

const DIRECTION_LABELS = { in: '收入', out: '支出' };
const SOURCE_LABELS = { dingtalk_import: '钉钉', manual: '手工' };
const CATEGORY_LABELS = {
  revenue: '营业收入',
  cogs: '营业成本',
  opex: '期间费用',
  tax: '税金',
  other_income: '营业外收入',
  non_pl: '非 P&L',
};

const DIRECTION_SET = new Set(Object.keys(DIRECTION_LABELS));
const SOURCE_SET = new Set(Object.keys(SOURCE_LABELS));
const CATEGORY_SET = new Set(Object.keys(CATEGORY_LABELS));

function buildSubjectNameFilter(value: Parameters<typeof buildStringFilter>[1]) {
  const fragment = buildStringFilter('name', value);
  return fragment ? { subject: fragment } : null;
}

function createLedgerRegistry(pageKey: string, pageName: string) {
  return defineFilterRegistry({
    pageKey,
    pageName,
    fields: {
      txDate: {
        label: '日期',
        dataType: 'date' as const,
        allowedControls: ['date', 'dateRange'] as const,
        build: (value) => buildDateFilter('txDate', value),
      },
      accountId: {
        label: '账户',
        dataType: 'foreignKey' as const,
        allowedControls: ['select'] as const,
        optionsSource: () => [],
        build: (value) => buildForeignKeyFilter('accountId', value),
      },
      subjectId: {
        label: '科目',
        dataType: 'foreignKey' as const,
        allowedControls: ['select'] as const,
        optionsSource: () => [],
        build: (value) => buildForeignKeyFilter('subjectId', value),
      },
      category: {
        label: '大类',
        dataType: 'enum' as const,
        allowedControls: ['select', 'multiSelect'] as const,
        optionsSource: () => toOptions(CATEGORY_LABELS),
        build: (value) => buildEnumFilter('category', CATEGORY_SET, value),
      },
      direction: {
        label: '方向',
        dataType: 'enum' as const,
        allowedControls: ['select'] as const,
        optionsSource: () => toOptions(DIRECTION_LABELS),
        build: (value) => buildEnumFilter('direction', DIRECTION_SET, value),
      },
      source: {
        label: '来源',
        dataType: 'enum' as const,
        allowedControls: ['select', 'multiSelect'] as const,
        optionsSource: () => toOptions(SOURCE_LABELS),
        build: (value) => buildEnumFilter('source', SOURCE_SET, value),
      },
      remark: {
        label: '备注',
        dataType: 'string' as const,
        searchable: true,
        allowedControls: ['text'] as const,
        build: (value) => buildStringFilter('remark', value),
      },
      subjectName: {
        label: '科目名称',
        dataType: 'string' as const,
        searchable: true,
        allowedControls: ['text'] as const,
        build: buildSubjectNameFilter,
      },
    },
    defaults: {
      fields: [
        { fieldKey: 'txDate', control: 'dateRange' as const },
        { fieldKey: 'accountId', control: 'select' as const },
        { fieldKey: 'subjectId', control: 'select' as const },
        { fieldKey: 'category', control: 'multiSelect' as const },
        { fieldKey: 'direction', control: 'select' as const },
        { fieldKey: 'source', control: 'select' as const },
      ],
      keyword: {
        enabled: true,
        fieldKeys: ['remark', 'subjectName'],
        placeholder: '备注/科目',
      },
    },
  });
}

export const FINANCE_LEDGER_FILTER_REGISTRY = createLedgerRegistry(
  FINANCE_LEDGER_PAGE_KEY,
  '公司流水'
);

export const FINANCE_PERSONAL_LEDGER_FILTER_REGISTRY = createLedgerRegistry(
  FINANCE_PERSONAL_LEDGER_PAGE_KEY,
  '个人流水'
);

export const FINANCE_PNL_FILTER_REGISTRY = defineFilterRegistry({
  pageKey: FINANCE_PNL_PAGE_KEY,
  pageName: '损益表（P&L）',
  fields: {
    year: {
      label: '年份',
      dataType: 'string',
      allowedControls: ['text'],
      build: () => null,
    },
  },
  defaults: {
    fields: [{ fieldKey: 'year', control: 'text' }],
    keyword: { enabled: false, fieldKeys: [] },
  },
});
