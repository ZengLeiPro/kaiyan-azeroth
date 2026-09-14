// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { cloudBillSnapshotResponseSchema } from '@ky-azeroth/shared/schemas/cloud-bill-snapshot';
import { Cloud } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';

import { type CloudBillSnapshotProfile, toCloudBillSnapshotProfile } from './types';

// 只读快照页面无表单数据，但 useCrud 仍要求 TFormData；用空对象类型保持类型完整。
type CloudBillSnapshotFormData = Record<string, never>;

const toBillApiParams = (filters: Record<string, FilterValue>) => ({
  keyword: filters['filters[keyword]'],
  vendor: filters['filters[vendor]'],
  billingCycle: filters['filters[billingCycle]'],
  startDate: filters['filters[snapshotDate][from]'],
  endDate: filters['filters[snapshotDate][to]'],
});

const fmtAmount = (v: number | string | null | undefined): string => {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function CloudBillsPage() {
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<CloudBillSnapshotProfile | null>(null);
  const scheme = useFilterScheme('ops.cloud_cost.bills');
  const filter = useManualFilter(scheme.initialFilters, toBillApiParams, scheme.version);

  const crud = useCrud<CloudBillSnapshotProfile, CloudBillSnapshotFormData>({
    endpoint: '/cloud-bill-snapshots',
    initialFormData: {} as CloudBillSnapshotFormData,
    schema: z.object({}) as z.ZodType<CloudBillSnapshotFormData>,
    transformData: (data) => (data as CloudBillSnapshotProfile[]).map(toCloudBillSnapshotProfile),
    paginationOptions: {
      initialSortBy: 'snapshotDate',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const handleViewDetail = (item: CloudBillSnapshotProfile) => {
    setDetailItem(item);
    setDetailOpen(true);
  };

  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<CloudBillSnapshotProfile>(cloudBillSnapshotResponseSchema, {
        overrides: [
          {
            key: 'productBills',
            mode: 'after',
            header: '产品数',
            width: '90px',
            render: (item) => (
              <Badge variant="outline" className="text-xs">
                {item.productBills?.length ?? 0}
              </Badge>
            ),
          },
        ],
      }),
    []
  );

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
      pagination={crud.pagination}
    >
      <CrudTable
        {...crud.tableProps}
        data={crud.data}
        columns={columns}
        loading={crud.loading}
        sorting={crud.sorting}
        onRowClick={handleViewDetail}
        hidePagination
        emptyState={{
          title: '暂无账单快照',
          description: '快照由 cloud-cost-sync 定时任务每日写入',
          icon: <Cloud className="h-12 w-12 text-muted-foreground/50" />,
        }}
      />

      <ResponsiveDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title={detailItem ? `账单详情 · ${detailItem.snapshotDate}` : '账单详情'}
        desktopMaxWidth="max-w-[920px]"
        footer={
          <Button variant="outline" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>
        }
      >
        {detailItem && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">账期：</span>
                {detailItem.billingCycle}
              </div>
              <div>
                <span className="text-muted-foreground">厂商：</span>
                {detailItem.vendor}
              </div>
              <div>
                <span className="text-muted-foreground">当月扣费：</span>
                <span className="font-mono">{fmtAmount(detailItem.mtdAmount)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">当月消耗：</span>
                <span className="font-mono">{fmtAmount(detailItem.mtdGrossAmount)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">可用余额：</span>
                <span className="font-mono">{fmtAmount(detailItem.balanceAvailable)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">现金余额：</span>
                <span className="font-mono">{fmtAmount(detailItem.balanceCash)}</span>
              </div>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">产品扣费明细（productBills）</h4>
              {!detailItem.productBills || detailItem.productBills.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无明细</p>
              ) : (
                <div className="overflow-x-auto rounded border">
                  <table className="min-w-full text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">产品代码</th>
                        <th className="px-3 py-2 text-left">产品名称</th>
                        <th className="px-3 py-2 text-right">扣费</th>
                        <th className="px-3 py-2 text-right">原价</th>
                        <th className="px-3 py-2 text-left">付费方式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailItem.productBills.map((b, idx) => (
                        <tr key={`${b.productCode}-${idx}`} className="border-b last:border-b-0">
                          <td className="px-3 py-2 font-mono text-xs">{b.productCode}</td>
                          <td className="px-3 py-2">{b.productName}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtAmount(b.paidAmount)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtAmount(b.grossAmount)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {b.subscriptionType || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">
                资源包 ({detailItem.resourcePackages?.length ?? 0})
              </h4>
              <p className="text-xs text-muted-foreground">详见「资源包」页面</p>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">
                订阅类资源 ({detailItem.subscriptions?.length ?? 0})
              </h4>
              <p className="text-xs text-muted-foreground">详见「续费日历」页面</p>
            </div>
          </div>
        )}
      </ResponsiveDialog>
    </StandardLayout>
  );
}
