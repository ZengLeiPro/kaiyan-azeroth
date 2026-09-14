import { type FinancePersonalLedgerResponseOutput } from '@ky-azeroth/shared/schemas';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar, type FilterOption } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import type { DataTableColumn } from '@/components/ui/data-table';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { useServerPagination } from '@/hooks/use-server-pagination';
import { getErrorMessage } from '@/lib/api';

import {
  FINANCE_CATEGORY_LABEL,
  FINANCE_DIRECTION_LABEL,
  FINANCE_LEDGER_YEAR,
  FINANCE_SOURCE_LABEL,
  formatLedgerAmount,
  formatLedgerDate,
} from '../shared';
import { LedgerAmountCell } from './LedgerAmountCell';

const PERSONAL_LEDGER_COLUMN_CONFIG = [
  { key: 'txDate', label: '日期', visible: true, canHide: false },
  { key: 'accountName', label: '账户', visible: true },
  { key: 'subjectName', label: '科目', visible: true },
  { key: 'subjectCategory', label: '大类', visible: false },
  { key: 'remark', label: '备注', visible: true },
  { key: 'amount', label: '金额', visible: true },
  { key: 'direction', label: '方向', visible: true },
  { key: 'runningBalance', label: '累计', visible: true },
  { key: 'source', label: '来源', visible: true },
];

const PERSONAL_LEDGER_PAGE_KEY = 'finance.personal_ledger' as const;
const TX_DATE_FROM_KEY = 'filters[txDate][from]' as const;
const TX_DATE_TO_KEY = 'filters[txDate][to]';
const ACCOUNT_ID_KEY = 'filters[accountId]';
const SUBJECT_ID_KEY = 'filters[subjectId]';

function readSchemeValue(
  filters: Record<string, FilterValue>,
  fieldKey: string
): FilterValue | undefined {
  return filters[`filters[${fieldKey}]`] ?? filters[`filters[${fieldKey}][]`];
}

function toLedgerQueryParams(
  filters: Record<string, FilterValue>
): Record<string, FilterValue | undefined> {
  return {
    keyword: filters.keyword || undefined,
    startDate: filters[TX_DATE_FROM_KEY] || undefined,
    endDate: filters[TX_DATE_TO_KEY] || undefined,
    accountId: readSchemeValue(filters, 'accountId'),
    subjectId: readSchemeValue(filters, 'subjectId'),
    category: readSchemeValue(filters, 'category'),
    direction: readSchemeValue(filters, 'direction'),
    source: readSchemeValue(filters, 'source'),
  };
}

interface PersonalLedgerViewProps {
  /** 由 Hub 注入的账户下拉（含"全部账户"哨兵项） */
  accountOptions: FilterOption[];
  /** 由 Hub 注入的科目下拉（含"全部科目"哨兵项） */
  subjectOptions: FilterOption[];
}

export function PersonalLedgerView({ accountOptions, subjectOptions }: PersonalLedgerViewProps) {
  const scheme = useFilterScheme(PERSONAL_LEDGER_PAGE_KEY);
  const initialFilters = useMemo(() => {
    const next = { ...scheme.initialFilters };
    if (TX_DATE_FROM_KEY in next) next[TX_DATE_FROM_KEY] = `${FINANCE_LEDGER_YEAR}-01-01`;
    if (TX_DATE_TO_KEY in next) next[TX_DATE_TO_KEY] = `${FINANCE_LEDGER_YEAR}-12-31`;
    return next;
  }, [scheme.initialFilters]);
  const filterFields = useMemo(
    () =>
      scheme.fields.map((field) => {
        if (field.kind === 'select' && field.key === ACCOUNT_ID_KEY) {
          return { ...field, options: accountOptions };
        }
        if (field.kind === 'select' && field.key === SUBJECT_ID_KEY) {
          return { ...field, options: subjectOptions };
        }
        return field;
      }),
    [scheme.fields, accountOptions, subjectOptions]
  );
  const filter = useManualFilter(initialFilters, toLedgerQueryParams, scheme.version);
  const list = useServerPagination<FinancePersonalLedgerResponseOutput>({
    endpoint: '/finance-personal-ledger',
    extraParams: filter.apiParams,
    initialPageSize: 100,
  });
  const columnVisibility = useColumnVisibility(PERSONAL_LEDGER_COLUMN_CONFIG);

  useEffect(() => {
    if (list.error) {
      toast.error(getErrorMessage(list.error, '加载个人流水失败'));
    }
  }, [list.error]);

  const columns = useMemo<DataTableColumn<FinancePersonalLedgerResponseOutput>[]>(
    () => [
      {
        key: 'txDate',
        header: '日期',
        width: 120,
        render: (item) => (
          <span className="font-mono text-xs">{formatLedgerDate(item.txDate)}</span>
        ),
      },
      {
        key: 'accountName',
        header: '账户',
        width: 140,
        render: (item) => item.accountName ?? '-',
      },
      {
        key: 'subjectName',
        header: '科目',
        width: 180,
        render: (item) => <span className="font-medium">{item.subjectName ?? '-'}</span>,
      },
      {
        key: 'subjectCategory',
        header: '大类',
        width: 140,
        render: (item) => (
          <Badge variant="outline">
            {item.subjectCategory
              ? (FINANCE_CATEGORY_LABEL[item.subjectCategory] ?? item.subjectCategory)
              : '-'}
          </Badge>
        ),
      },
      {
        key: 'remark',
        header: '备注',
        width: 280,
        render: (item) => (
          <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {item.remark || '-'}
          </span>
        ),
      },
      {
        key: 'amount',
        header: '金额',
        width: 140,
        align: 'right',
        render: (item) => <LedgerAmountCell value={item.amount} />,
      },
      {
        key: 'direction',
        header: '方向',
        width: 100,
        render: (item) => (
          <Badge variant={item.direction === 'in' ? 'success' : 'warning'}>
            {FINANCE_DIRECTION_LABEL[item.direction] ?? item.direction}
          </Badge>
        ),
      },
      {
        key: 'runningBalance',
        header: '累计',
        width: 140,
        align: 'right',
        render: (item) => <LedgerAmountCell value={item.runningBalance} muted />,
      },
      {
        key: 'source',
        header: '来源',
        width: 100,
        render: (item) => (
          <Badge variant={item.source === 'dingtalk_import' ? 'info' : 'outline'}>
            {FINANCE_SOURCE_LABEL[item.source] ?? item.source}
          </Badge>
        ),
      },
    ],
    []
  );

  const renderMobileCard = (item: FinancePersonalLedgerResponseOutput) => (
    <GenericMobileCard
      title={`${formatLedgerDate(item.txDate)} · ${item.subjectName ?? '-'}`}
      status={
        <Badge variant={item.direction === 'in' ? 'success' : 'warning'}>
          {FINANCE_DIRECTION_LABEL[item.direction] ?? item.direction}
        </Badge>
      }
      fields={[
        { label: '账户', value: item.accountName ?? '-' },
        { label: '金额', value: formatLedgerAmount(item.amount) },
        { label: '累计', value: formatLedgerAmount(item.runningBalance) },
        { label: '备注', value: item.remark || '-', fullWidth: true },
      ]}
      testId={`finance-personal-ledger-${item.id}`}
    />
  );

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onSearch={filter.search}
          onReset={filter.reset}
          actions={
            <ColumnVisibilityDropdown
              columns={columnVisibility.columns}
              onToggle={columnVisibility.toggleColumn}
              onShowAll={columnVisibility.showAll}
              onResetVisibility={columnVisibility.resetToDefault}
              onReorder={columnVisibility.reorderColumns}
            />
          }
          filters={
            scheme.isLoading ? (
              <FilterBarSkeleton count={7} />
            ) : (
              <CrudFilterBar
                fields={filterFields}
                values={filter.tempFilters}
                onChange={filter.setFilter}
                personalFilter={
                  scheme.registry && scheme.config && scheme.defaultConfig
                    ? {
                        pageKey: scheme.registry.pageKey,
                        registry: scheme.registry,
                        config: scheme.config,
                        defaultConfig: scheme.defaultConfig,
                        onApply: filter.replaceFilters,
                      }
                    : undefined
                }
              />
            )
          }
        />
      }
      pagination={list.pagination}
    >
      <CrudTable
        error={list.error}
        onRetry={list.refresh}
        stale={list.stale}
        data={list.data}
        columns={columns}
        loading={list.loading}
        renderMobileCard={renderMobileCard}
        columnVisibility={{
          columns: columnVisibility.columns,
          onToggle: columnVisibility.toggleColumn,
          onShowAll: columnVisibility.showAll,
        }}
        hidePagination
        emptyState={{
          title: '暂无个人流水',
          description: '当前筛选条件下没有私账记录',
        }}
      />
    </StandardLayout>
  );
}
