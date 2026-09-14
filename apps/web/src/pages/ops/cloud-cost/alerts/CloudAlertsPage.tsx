// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { cloudAlertResponseSchema } from '@ky-azeroth/shared/schemas/cloud-alert';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import type { DataTableColumn } from '@/components/ui/data-table';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { api, getErrorMessage } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';

import { ResolveAlertDialog } from './components/ResolveAlertDialog';
import {
  type CloudAlertFormData,
  cloudAlertFormSchema,
  type CloudAlertProfile,
  toCloudAlertFormData,
  toCloudAlertPayload,
  toCloudAlertProfile,
} from './types';

const toAlertApiParams = (filters: Record<string, FilterValue>) => ({
  keyword: filters['filters[keyword]'],
  vendor: filters['filters[vendor]'],
  level: filters['filters[level]'],
  category: filters['filters[category]'],
  status: filters['filters[status]'],
  startDate: filters['filters[triggeredAt][from]'],
  endDate: filters['filters[triggeredAt][to]'],
});

export function CloudAlertsPage() {
  const [resolveState, setResolveState] = useState<{
    open: boolean;
    action: 'resolve' | 'dismiss';
    target: CloudAlertProfile | null;
  }>({ open: false, action: 'resolve', target: null });
  const [submitting, setSubmitting] = useState(false);
  const scheme = useFilterScheme('ops.cloud_cost.alerts');
  const filter = useManualFilter(scheme.initialFilters, toAlertApiParams, scheme.version);

  const crud = useCrud<CloudAlertProfile, CloudAlertFormData>({
    endpoint: '/cloud-alerts',
    schema: cloudAlertFormSchema,
    initialFormData: {
      status: 'resolved',
      resolutionNote: null,
    },
    transformData: (data) => (data as CloudAlertProfile[]).map(toCloudAlertProfile),
    entityToForm: toCloudAlertFormData,
    formToPayload: toCloudAlertPayload,
    getEntityName: (entity) => entity.title,
    paginationOptions: {
      initialSortBy: 'triggeredAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const handleResolveClick = useCallback(
    (alert: CloudAlertProfile, action: 'resolve' | 'dismiss') => {
      if (alert.status !== 'active') {
        toast.warning('该预警已处理或已忽略');
        return;
      }
      setResolveState({ open: true, action, target: alert });
    },
    []
  );

  const handleConfirmResolve = useCallback(
    async (note: string | null) => {
      const target = resolveState.target;
      if (!target) return;
      setSubmitting(true);
      try {
        await api.patch(`/cloud-alerts/${target.id}`, {
          status: resolveState.action === 'resolve' ? 'resolved' : 'dismissed',
          resolutionNote: note,
          version: target.version,
        });
        toast.success(resolveState.action === 'resolve' ? '已标记为处理' : '已忽略');
        setResolveState({ open: false, action: 'resolve', target: null });
        crud.refresh();
      } catch (error) {
        toast.error(getErrorMessage(error, '操作失败'));
      } finally {
        setSubmitting(false);
      }
    },
    [resolveState, crud]
  );

  const baseColumns = useMemo(
    () =>
      deriveColumnsFromSchema<CloudAlertProfile>(cloudAlertResponseSchema, {
        overrides: [
          {
            key: 'title',
            render: (item) => <span className="font-medium">{item.title}</span>,
          },
          {
            key: 'message',
            render: (item) => (
              <span className="text-muted-foreground" title={item.message}>
                {item.message.length > 50 ? `${item.message.slice(0, 50)}...` : item.message}
              </span>
            ),
          },
        ],
      }),
    []
  );

  const actionColumn = useMemo<DataTableColumn<CloudAlertProfile>>(
    () => ({
      key: '_actions',
      header: '操作',
      width: '160px',
      align: 'center',
      ellipsis: false,
      render: (item) => {
        if (item.status !== 'active') {
          return <span className="text-xs text-muted-foreground">已处理</span>;
        }
        return (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleResolveClick(item, 'resolve');
              }}
            >
              <CheckCircle className="mr-1 h-3 w-3" />
              处理
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleResolveClick(item, 'dismiss');
              }}
            >
              <XCircle className="mr-1 h-3 w-3" />
              忽略
            </Button>
          </div>
        );
      },
    }),
    [handleResolveClick]
  );

  const columns = useMemo(() => [...baseColumns, actionColumn], [baseColumns, actionColumn]);

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
        onRowClick={crud.openViewDialog}
        hidePagination
        emptyState={{
          title: '暂无云预警',
          description: '系统未检测到余额、资源包或扣费异常',
          icon: <AlertTriangle className="h-12 w-12 text-muted-foreground/50" />,
        }}
      />

      <ResolveAlertDialog
        open={resolveState.open}
        action={resolveState.action}
        loading={submitting}
        onOpenChange={(open) => {
          if (!open) {
            setResolveState({ open: false, action: 'resolve', target: null });
          }
        }}
        onConfirm={handleConfirmResolve}
      />
    </StandardLayout>
  );
}
