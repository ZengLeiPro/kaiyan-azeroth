import '@/lib/column-renderers';

import { type FinanceAccountResponseOutput } from '@ky-azeroth/shared/schemas';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';

import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
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

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  virtual: '虚拟',
  bank: '银行',
  alipay: '支付宝',
  wechat: '微信',
  cash: '现金',
};

const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: '启用',
  inactive: '停用',
};

const ACCOUNT_COLUMN_CONFIG = [
  { key: 'code', label: '代码', visible: true, canHide: false },
  { key: 'name', label: '账户名称', visible: true },
  { key: 'kind', label: '类型', visible: true },
  { key: 'currency', label: '币种', visible: false },
  { key: 'openingBalance', label: '期初余额', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'remark', label: '备注', visible: true },
];

const ACCOUNT_KIND_FILTER_KEY = 'filters[kind]';
const ACCOUNT_STATUS_FILTER_KEY = 'filters[status]';

function toAccountApiParams(filters: Record<string, FilterValue>) {
  return {
    keyword: filters.keyword || undefined,
    kind: filters[ACCOUNT_KIND_FILTER_KEY] || undefined,
    status: filters[ACCOUNT_STATUS_FILTER_KEY] || undefined,
  };
}

export function AccountsPage() {
  const scheme = useFilterScheme('finance.accounts');
  const filter = useManualFilter(scheme.initialFilters, toAccountApiParams, scheme.version);
  const list = useServerPagination<FinanceAccountResponseOutput>({
    endpoint: '/finance-accounts',
    extraParams: filter.apiParams,
    initialPageSize: 100,
  });
  const columnVisibility = useColumnVisibility(ACCOUNT_COLUMN_CONFIG);

  useEffect(() => {
    if (list.error) {
      toast.error(getErrorMessage(list.error, '加载账户字典失败'));
    }
  }, [list.error]);

  const columns = useMemo<DataTableColumn<FinanceAccountResponseOutput>[]>(
    () => [
      {
        key: 'code',
        header: '代码',
        width: 120,
        render: (item) => <span className="font-mono text-xs">{item.code}</span>,
      },
      {
        key: 'name',
        header: '账户名称',
        width: 160,
        render: (item) => <span className="font-medium">{item.name}</span>,
      },
      {
        key: 'kind',
        header: '类型',
        width: 120,
        render: (item) => (
          <Badge variant="outline">{ACCOUNT_KIND_LABEL[item.kind] ?? item.kind}</Badge>
        ),
      },
      {
        key: 'currency',
        header: '币种',
        width: 100,
      },
      {
        key: 'openingBalance',
        header: '期初余额',
        width: 140,
        align: 'right',
        render: (item) => <AmountCell value={item.openingBalance} />,
      },
      {
        key: 'status',
        header: '状态',
        width: 100,
        render: (item) => (
          <Badge variant={item.status === 'active' ? 'success' : 'outline'}>
            {ACCOUNT_STATUS_LABEL[item.status] ?? item.status}
          </Badge>
        ),
      },
      {
        key: 'remark',
        header: '备注',
        width: 240,
        render: (item) => (
          <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
            {item.remark || '-'}
          </span>
        ),
      },
    ],
    []
  );

  const renderMobileCard = (item: FinanceAccountResponseOutput) => (
    <GenericMobileCard
      title={item.name}
      status={<Badge variant="outline">{ACCOUNT_KIND_LABEL[item.kind] ?? item.kind}</Badge>}
      fields={[
        { label: '代码', value: item.code },
        { label: '币种', value: item.currency },
        { label: '期初余额', value: formatAmount(item.openingBalance) },
        { label: '状态', value: ACCOUNT_STATUS_LABEL[item.status] ?? item.status },
      ]}
      testId={`finance-account-${item.id}`}
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
              <FilterBarSkeleton count={3} />
            ) : (
              <CrudFilterBar
                fields={scheme.fields}
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
          title: '暂无账户字典',
          description: '未查询到账户配置',
        }}
      />
    </StandardLayout>
  );
}

function AmountCell({ value }: { value: number | null | undefined }) {
  return <span className="font-mono tabular-nums">{formatAmount(value)}</span>;
}

function formatAmount(value: number | null | undefined): string {
  if (value == null) return '-';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
