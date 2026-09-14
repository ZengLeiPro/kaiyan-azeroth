// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { cloudInstanceMetaResponseSchema } from '@ky-azeroth/shared/schemas/cloud-instance-meta';
import { Cpu } from 'lucide-react';
import { useMemo } from 'react';

import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';

import { CloudInstanceMetaFormFields } from './components/CloudInstanceMetaFormFields';
import {
  type CloudInstanceMetaFormData,
  cloudInstanceMetaFormSchema,
  type CloudInstanceMetaProfile,
  toCloudInstanceMetaFormData,
  toCloudInstanceMetaPayload,
} from './types';

const toInstanceApiParams = (filters: Record<string, FilterValue>) => ({
  keyword: filters['filters[keyword]'],
  vendor: filters['filters[vendor]'],
  productCode: filters['filters[productCode]'],
  ownerCategory: filters['filters[ownerCategory]'],
  renewalIntent: filters['filters[renewalIntent]'],
  archived: filters['filters[archived]'],
});

export function CloudInstancesPage() {
  const scheme = useFilterScheme('ops.cloud_cost.instances');
  const filter = useManualFilter(scheme.initialFilters, toInstanceApiParams, scheme.version);

  const crud = useCrud<CloudInstanceMetaProfile, CloudInstanceMetaFormData>({
    endpoint: '/cloud-instance-metas',
    schema: cloudInstanceMetaFormSchema,
    initialFormData: {
      vendor: 'aliyun',
      productCode: '',
      instanceId: '',
      alias: null,
      purpose: null,
      ownerCategory: null,
      ownerName: null,
      renewalIntent: null,
      notes: null,
      archived: false,
    },
    entityToForm: toCloudInstanceMetaFormData,
    formToPayload: toCloudInstanceMetaPayload,
    getEntityName: (entity) => entity.alias || entity.instanceId,
    paginationOptions: {
      extraParams: filter.apiParams,
    },
  });

  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<CloudInstanceMetaProfile>(cloudInstanceMetaResponseSchema, {
        overrides: [
          {
            key: 'instanceId',
            render: (item) => (
              <span className="font-mono text-xs" title={item.instanceId}>
                {item.instanceId}
              </span>
            ),
          },
          {
            key: 'alias',
            render: (item) => <span className="font-medium">{item.alias || '-'}</span>,
          },
          {
            key: 'purpose',
            render: (item) => {
              const content = item.purpose;
              if (!content) return '-';
              return (
                <span className="text-muted-foreground" title={content}>
                  {content.length > 30 ? `${content.slice(0, 30)}...` : content}
                </span>
              );
            },
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<CloudInstanceMetaProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog]
  );

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onCreate={crud.openCreateDialog}
          createLabel="新建实例"
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
          bulkSelection={{
            selectedCount: crud.selectedKeys.size,
            onClearSelection: crud.clearSelection,
            onBulkDelete: crud.openBulkDeleteDialog,
          }}
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
        rowSelection={crud.rowSelectionProps}
        hidePagination
        emptyState={{
          title: '暂无实例元数据',
          description: '点击"新建实例"为云资源添加可读语义',
          icon: <Cpu className="h-12 w-12 text-muted-foreground/50" />,
        }}
        actions={rowActions}
      />

      <FormDialog
        {...crud.formDialogProps}
        variant="drawer"
        title={crud.isEditing ? '实例元数据' : '新建实例'}
        onSubmit={crud.handleSubmit}
      >
        <CloudInstanceMetaFormFields crud={crud} />
      </FormDialog>

      <DeleteConfirm {...crud.deleteConfirmProps} />
      <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
    </StandardLayout>
  );
}
