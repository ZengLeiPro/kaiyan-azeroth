// 公司流水 / 个人流水视图共用的常量、格式化函数与筛选选项。
// 损益表（PnLView）业务语义不同（按 income/expense tone 着色），不在此共享。

import type { FilterOption } from '@/components/patterns/crud-filter-bar';

export const FINANCE_LEDGER_YEAR = 2026;

export const FINANCE_CATEGORY_LABEL: Record<string, string> = {
  revenue: '营业收入',
  cogs: '营业成本',
  opex: '期间费用',
  tax: '税金',
  other_income: '营业外收入',
  non_pl: '非 P&L',
};

export const FINANCE_DIRECTION_LABEL: Record<string, string> = {
  in: '收入',
  out: '支出',
};

export const FINANCE_SOURCE_LABEL: Record<string, string> = {
  dingtalk_import: '钉钉',
  manual: '手工',
};

export const FINANCE_CATEGORY_OPTIONS: FilterOption[] = [
  { value: 'revenue', label: '营业收入' },
  { value: 'cogs', label: '营业成本' },
  { value: 'opex', label: '期间费用' },
  { value: 'tax', label: '税金' },
  { value: 'other_income', label: '营业外收入' },
  { value: 'non_pl', label: '非 P&L' },
];

export const FINANCE_DIRECTION_OPTIONS: FilterOption[] = [
  { value: '', label: '全部方向' },
  { value: 'in', label: '收入' },
  { value: 'out', label: '支出' },
];

export const FINANCE_DIRECTION_FORM_OPTIONS: FilterOption[] = [
  { value: '', label: '自动判断' },
  { value: 'in', label: '收入' },
  { value: 'out', label: '支出' },
];

export const FINANCE_SOURCE_OPTIONS: FilterOption[] = [
  { value: '', label: '全部来源' },
  { value: 'dingtalk_import', label: '钉钉' },
  { value: 'manual', label: '手工' },
];

export function formatLedgerAmount(value: number | null | undefined): string {
  if (value == null) return '-';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatLedgerDate(value: string): string {
  return value.slice(0, 10);
}

export function getOptionLabel(options: FilterOption[], value: string | null | undefined): string {
  if (!value) return '-';
  return options.find((option) => option.value === value)?.label ?? '-';
}

/**
 * PnL → 公司流水钻取使用的 URL 查询参数键。
 * tab=company 时，CompanyLedgerView 会读取这些参数初始化筛选。
 */
export const DRILLDOWN_PARAM_KEYS = {
  subjectId: 'subjectId',
  startDate: 'startDate',
  endDate: 'endDate',
} as const;

/**
 * 给定 year + month，返回该月份首日和末日（YYYY-MM-DD）。
 * month 为 1-12 整数。用 Date(year, month, 0) 拿到上个月的最后一天，即本月末。
 */
export function getMonthDateRange(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/**
 * 给定 year，返回全年日期范围。
 */
export function getYearDateRange(year: number): { start: string; end: string } {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}
