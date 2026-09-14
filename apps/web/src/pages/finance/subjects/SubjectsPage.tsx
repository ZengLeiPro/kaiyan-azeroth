import { type FinanceSubjectResponseOutput } from '@ky-azeroth/shared/schemas';
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

const CATEGORY_LABEL: Record<string, string> = {
  revenue: '营业收入',
  cogs: '营业成本',
  opex: '期间费用',
  tax: '税金',
  other_income: '营业外收入',
  non_pl: '非 P&L',
};

const STATUS_LABEL: Record<string, string> = {
  active: '启用',
  inactive: '停用',
};

const SUBJECT_COLUMN_CONFIG = [
  { key: 'code', label: '代码', visible: true, canHide: false },
  { key: 'name', label: '科目名称', visible: true },
  { key: 'category', label: '大类', visible: true },
  { key: 'level', label: '层级', visible: true },
  { key: 'parentName', label: '所属分组', visible: true },
  { key: 'displayOrder', label: '排序', visible: false },
  { key: 'status', label: '状态', visible: true },
];

const SUBJECT_CATEGORY_FILTER_KEY = 'filters[category][]';
const SUBJECT_LEVEL_FILTER_KEY = 'filters[level]';
const SUBJECT_STATUS_FILTER_KEY = 'filters[status]';

function toSubjectApiParams(filters: Record<string, FilterValue>) {
  return {
    keyword: filters.keyword || undefined,
    category: filters[SUBJECT_CATEGORY_FILTER_KEY] || undefined,
    level: filters[SUBJECT_LEVEL_FILTER_KEY] || undefined,
    status: filters[SUBJECT_STATUS_FILTER_KEY] || undefined,
  };
}

export function SubjectsPage() {
  const scheme = useFilterScheme('finance.subjects');
  const filter = useManualFilter(scheme.initialFilters, toSubjectApiParams, scheme.version);
  const list = useServerPagination<FinanceSubjectResponseOutput>({
    endpoint: '/finance-subjects',
    extraParams: filter.apiParams,
    initialPageSize: 100,
  });
  const columnVisibility = useColumnVisibility(SUBJECT_COLUMN_CONFIG);

  useEffect(() => {
    if (list.error) {
      toast.error(getErrorMessage(list.error, '加载科目字典失败'));
    }
  }, [list.error]);

  const columns = useMemo<DataTableColumn<FinanceSubjectResponseOutput>[]>(
    () => [
      {
        key: 'code',
        header: '代码',
        width: 140,
        render: (item) => <span className="font-mono text-xs">{item.code}</span>,
      },
      {
        key: 'name',
        header: '科目名称',
        width: 180,
        render: (item) => (
          <span className={item.level === 1 ? 'font-medium' : undefined}>
            {item.level === 2 && <span className="text-muted-foreground">·· </span>}
            {item.name}
          </span>
        ),
      },
      {
        key: 'category',
        header: '大类',
        width: 140,
        render: (item) => (
          <Badge variant="outline">{CATEGORY_LABEL[item.category] ?? item.category}</Badge>
        ),
      },
      {
        key: 'level',
        header: '层级',
        width: 100,
        render: (item) => (
          <Badge variant={item.level === 1 ? 'secondary' : 'outline'}>
            {item.level === 1 ? '分组' : '叶子'}
          </Badge>
        ),
      },
      {
        key: 'parentName',
        header: '所属分组',
        width: 160,
        render: (item) => (
          <span className="text-sm text-muted-foreground">{item.parentName ?? '-'}</span>
        ),
      },
      {
        key: 'displayOrder',
        header: '排序',
        width: 100,
        align: 'right',
        render: (item) => <span className="font-mono text-xs">{item.displayOrder}</span>,
      },
      {
        key: 'status',
        header: '状态',
        width: 100,
        render: (item) => (
          <Badge variant={item.status === 'active' ? 'success' : 'outline'}>
            {STATUS_LABEL[item.status] ?? item.status}
          </Badge>
        ),
      },
    ],
    []
  );

  const renderMobileCard = (item: FinanceSubjectResponseOutput) => (
    <GenericMobileCard
      title={item.name}
      status={<Badge variant="outline">{CATEGORY_LABEL[item.category] ?? item.category}</Badge>}
      fields={[
        { label: '代码', value: item.code },
        { label: '层级', value: item.level === 1 ? '分组' : '叶子' },
        { label: '所属分组', value: item.parentName ?? '-' },
        { label: '状态', value: STATUS_LABEL[item.status] ?? item.status },
      ]}
      testId={`finance-subject-${item.id}`}
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
              <FilterBarSkeleton count={4} />
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
          title: '暂无科目字典',
          description: '未查询到科目配置',
        }}
      />
    </StandardLayout>
  );
}
