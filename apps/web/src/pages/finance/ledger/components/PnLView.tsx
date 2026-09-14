import type { FinancePnlResponse, FinancePnlRow } from '@ky-azeroth/shared/schemas';
import { Banknote, CircleDollarSign, Landmark, Percent, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { MetricCard } from '@/components/patterns/metric-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import type { DataTableColumn } from '@/components/ui/data-table';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

import {
  DRILLDOWN_PARAM_KEYS,
  FINANCE_LEDGER_YEAR,
  getMonthDateRange,
  getYearDateRange,
} from '../shared';

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

const PNL_COLUMN_CONFIG = [
  { key: 'subjectName', label: '科目', visible: true, canHide: false },
  ...MONTHS.map((month) => ({ key: `month-${month}`, label: `${month}月`, visible: true })),
  { key: 'total', label: '全年', visible: true },
];

const PNL_PAGE_KEY = 'finance.pnl' as const;
const YEAR_FILTER_KEY = 'filters[year]';

type PnlFlowTone = 'income' | 'expense' | 'neutral';

function toPnlQueryParams(
  filters: Record<string, FilterValue>
): Record<string, FilterValue | undefined> {
  return { year: filters[YEAR_FILTER_KEY] || undefined };
}

function isGroupRow(item: FinancePnlRow): boolean {
  return item.level === 1;
}

function getPnlFlowTone(item: FinancePnlRow): PnlFlowTone {
  if (item.category === 'revenue' || item.category === 'other_income') return 'income';
  if (item.category === 'cogs' || item.category === 'opex' || item.category === 'tax') {
    return 'expense';
  }
  return 'neutral';
}

function getPnlRowClassName(item: FinancePnlRow): string | undefined {
  if (!isGroupRow(item)) return undefined;
  const tone = getPnlFlowTone(item);
  if (tone === 'income') return 'bg-primary/5 hover:bg-primary/10';
  if (tone === 'expense') return 'bg-brandAccent-soft/70 hover:bg-brandAccent-soft';
  return 'bg-muted/40 hover:bg-muted/60';
}

function getPnlSubjectCellClassName(item: FinancePnlRow): string {
  const tone = getPnlFlowTone(item);
  return cn(
    'border-l-4',
    isGroupRow(item) && tone === 'income' && 'border-l-primary',
    isGroupRow(item) && tone === 'expense' && 'border-l-brandAccent',
    isGroupRow(item) && tone === 'neutral' && 'border-l-muted-foreground/40',
    !isGroupRow(item) && 'border-l-transparent'
  );
}

function getPnlAmountCellClassName(item: FinancePnlRow): string | undefined {
  if (!isGroupRow(item)) return undefined;
  const tone = getPnlFlowTone(item);
  if (tone === 'income') return 'border-primary/10';
  if (tone === 'expense') return 'border-brandAccent/20';
  return 'border-muted';
}

function getPnlSubjectTextClassName(item: FinancePnlRow): string | undefined {
  if (!isGroupRow(item)) return undefined;
  const tone = getPnlFlowTone(item);
  if (tone === 'income') return 'text-primary';
  if (tone === 'expense') return 'text-brandAccent-foreground dark:text-brandAccent';
  return 'text-foreground';
}

function getPnlAmountToneClassName(tone: PnlFlowTone): string {
  if (tone === 'income') return 'text-primary';
  if (tone === 'expense') return 'text-brandAccent-foreground dark:text-brandAccent';
  return 'text-foreground';
}

export function PnLView() {
  const scheme = useFilterScheme(PNL_PAGE_KEY);
  const initialFilters = useMemo(() => {
    const next = { ...scheme.initialFilters };
    if (YEAR_FILTER_KEY in next) next[YEAR_FILTER_KEY] = String(FINANCE_LEDGER_YEAR);
    return next;
  }, [scheme.initialFilters]);
  const filter = useManualFilter(initialFilters, toPnlQueryParams, scheme.version);
  const [data, setData] = useState<FinancePnlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [, setSearchParams] = useSearchParams();
  const activeYear = filter.apiParams.year || String(FINANCE_LEDGER_YEAR);
  const activeYearNum = Number(activeYear);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.get<FinancePnlResponse>('/finance-pnl', {
        params: { year: activeYear },
      });
      setData(response.data);
    } catch (error) {
      setLoadError(error);
      toast.error(getErrorMessage(error, '加载损益表失败'));
    } finally {
      setLoading(false);
    }
  }, [activeYear]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  /**
   * 钻取：跳转到公司流水 tab，并把 subjectId + 日期范围作为筛选条件挂在 URL。
   * CompanyLedgerView 通过监听 URL 应用筛选后立即清掉这些参数。
   * 只对叶子科目（非分组行）有效——分组行是聚合视图，没有具体 subjectId 维度可下钻。
   */
  const drilldown = useCallback(
    (subjectId: string, range: { start: string; end: string }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', 'company');
          next.set(DRILLDOWN_PARAM_KEYS.subjectId, subjectId);
          next.set(DRILLDOWN_PARAM_KEYS.startDate, range.start);
          next.set(DRILLDOWN_PARAM_KEYS.endDate, range.end);
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const columns = useMemo<DataTableColumn<FinancePnlRow>[]>(
    () => [
      {
        key: 'subjectName',
        header: '科目',
        width: 220,
        ellipsis: false,
        cellClassName: getPnlSubjectCellClassName,
        render: (item) => {
          const group = isGroupRow(item);
          return (
            <div
              className={cn(
                'flex min-w-0 items-center',
                group ? cn('font-semibold', getPnlSubjectTextClassName(item)) : 'pl-6'
              )}
            >
              {!group && <span className="mr-2 h-px w-3 shrink-0 bg-border" />}
              <span className="truncate">{item.subjectName}</span>
            </div>
          );
        },
      },
      ...MONTHS.map<DataTableColumn<FinancePnlRow>>((month) => ({
        key: `month-${month}`,
        header: `${month}月`,
        width: 110,
        align: 'right',
        cellClassName: getPnlAmountCellClassName,
        render: (item) => {
          const value = item.months[month as unknown as keyof FinancePnlRow['months']];
          const drillable = !isGroupRow(item) && value !== 0 && Boolean(item.subjectId);
          return (
            <DrillableCell
              drillable={drillable}
              title={drillable ? `查看 ${item.subjectName} ${month} 月明细` : undefined}
              onClick={
                drillable
                  ? () => drilldown(item.subjectId, getMonthDateRange(activeYearNum, month))
                  : undefined
              }
            >
              <AmountCell
                value={value}
                strong={isGroupRow(item)}
                tone={isGroupRow(item) ? getPnlFlowTone(item) : 'neutral'}
              />
            </DrillableCell>
          );
        },
      })),
      {
        key: 'total',
        header: '全年',
        width: 130,
        align: 'right',
        cellClassName: getPnlAmountCellClassName,
        render: (item) => {
          const drillable = !isGroupRow(item) && item.total !== 0 && Boolean(item.subjectId);
          return (
            <DrillableCell
              drillable={drillable}
              title={drillable ? `查看 ${item.subjectName} 全年明细` : undefined}
              onClick={
                drillable
                  ? () => drilldown(item.subjectId, getYearDateRange(activeYearNum))
                  : undefined
              }
            >
              <AmountCell
                value={item.total}
                strong
                tone={isGroupRow(item) ? getPnlFlowTone(item) : 'neutral'}
              />
            </DrillableCell>
          );
        },
      },
    ],
    [activeYearNum, drilldown]
  );

  const subjects = data?.subjects ?? [];

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onSearch={filter.search}
          onReset={filter.reset}
          filters={
            scheme.isLoading ? (
              <FilterBarSkeleton count={1} />
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
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="营业收入"
            value={formatAmount(data?.grandTotals.revenue)}
            icon={CircleDollarSign}
            iconColor="text-primary"
            iconBg="bg-primary/10"
            loading={loading}
          />
          <MetricCard
            label="毛利"
            value={formatAmount(data?.grandTotals.grossProfit)}
            hint={data ? `毛利率 ${data.grandTotals.grossMargin.toFixed(1)}%` : undefined}
            icon={Percent}
            iconColor="text-blue-600"
            iconBg="bg-blue-50 dark:bg-blue-950"
            loading={loading}
          />
          <MetricCard
            label="运营总费用"
            value={formatAmount(data?.grandTotals.opex)}
            icon={Landmark}
            iconColor="text-brandAccent-foreground dark:text-brandAccent"
            iconBg="bg-brandAccent-soft"
            loading={loading}
          />
          <MetricCard
            label="税前利润"
            value={formatAmount(data?.grandTotals.profitBeforeTax)}
            icon={TrendingUp}
            iconColor="text-indigo-600"
            iconBg="bg-indigo-50 dark:bg-indigo-950"
            loading={loading}
          />
          <MetricCard
            label="净利润"
            value={formatAmount(data?.grandTotals.netProfit)}
            hint={data ? `净利率 ${data.grandTotals.netMargin.toFixed(1)}%` : undefined}
            icon={Banknote}
            iconColor="text-rose-600"
            iconBg="bg-rose-50 dark:bg-rose-950"
            loading={loading}
          />
        </div>

        <CrudTable
          data={subjects}
          columns={columns}
          loading={loading}
          error={loadError}
          onRetry={() => void fetchData()}
          stale={Boolean(loadError && data)}
          columnVisibility={{
            columns: PNL_COLUMN_CONFIG,
            onToggle: () => undefined,
            onShowAll: () => undefined,
          }}
          hidePagination
          rowClassName={getPnlRowClassName}
          emptyState={{
            title: '暂无损益数据',
            description: `${activeYear} 年无流水聚合结果`,
          }}
          storageId="finance-pnl"
        />
      </div>
    </StandardLayout>
  );
}

/**
 * 钻取单元格包装：drillable=true 时整个格子可点击并带 hover 反馈，转到公司流水 tab。
 * 内部 button 用 type="button" 防止意外触发表单提交；不可钻取时退化为不可点击的 span。
 */
function DrillableCell({
  drillable,
  onClick,
  title,
  children,
}: {
  drillable: boolean;
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!drillable || !onClick) {
    return <span className="block">{children}</span>;
  }
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="block w-full rounded px-1 text-right transition-colors hover:bg-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {children}
    </button>
  );
}

/**
 * PnLView 专用金额单元：按科目 income/expense 业务 tone 着色（与流水视图按正负着色不同）。
 */
function AmountCell({
  value,
  strong,
  tone,
}: {
  value: number | undefined;
  strong?: boolean;
  tone: PnlFlowTone;
}) {
  const muted = value == null || value === 0;
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        strong && 'font-semibold',
        !muted && getPnlAmountToneClassName(tone),
        muted && 'text-muted-foreground/50'
      )}
    >
      {formatAmount(value)}
    </span>
  );
}

function formatAmount(value: number | null | undefined): string {
  if (value == null || value === 0) return '-';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
