// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { keepRecordResponseSchema } from '@ky-azeroth/shared/schemas/keep-record';
import type { IKeepRecordResponse } from '@ky-azeroth/shared/types/keep-record';
import { format } from 'date-fns';
import { Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { getNowDateTimeLocalString } from '@/lib/date-utils';
import { keepRecordStatusMap, keepRecordTypeMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import { renderKeepRecordFields } from './keep-record-fields';
import {
  type KeepRecordFormData,
  keepRecordFormSchema,
  type KeepRecordProfile,
  toKeepRecordFormData,
  toKeepRecordPayload,
  toKeepRecordProfile,
} from './types';

const KEEP_RECORD_COLUMN_CONFIG = [
  { key: 'customerName', label: '客户名称', visible: true, canHide: false },
  { key: 'contactName', label: '联系人', visible: true },
  { key: 'keepRecordType', label: '跟进类型', visible: true },
  { key: 'keepRecordTime', label: '跟进时间', visible: true },
  { key: 'keepRecordContent', label: '跟进内容', visible: true },
  { key: 'keepRecordStatus', label: '状态', visible: true },
  { key: 'chargerName', label: '负责人', visible: true },
  { key: 'attachments', label: '附件', visible: true },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

export function KeepRecordsPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission, hasViewScopeAll, user } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'keep_records', 'create');
  const canEdit = hasMenuPermission('crm', 'keep_records', 'edit');
  const canDelete = hasMenuPermission('crm', 'keep_records', 'delete');
  // 后端 RBAC 已放宽到双路径 OR；Web 默认仍按业绩归属过滤保持销售工作台体验。
  // ADMIN 不注入默认值，看全量。
  const currentEmployeeId = user?.employee?.id ?? user?.id;
  const defaultChargerId = hasViewScopeAll('crm', 'keep_records') ? undefined : currentEmployeeId;

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('crm.keep_records');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);
  const extraParams = useMemo(
    () =>
      defaultChargerId ? { chargerId: defaultChargerId, ...filter.apiParams } : filter.apiParams,
    [filter.apiParams, defaultChargerId]
  );

  const crud = useCrud<KeepRecordProfile, KeepRecordFormData>({
    endpoint: '/keep-records',
    schema: keepRecordFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      customerId: '',
      contactId: null,
      keepRecordType: '',
      keepRecordTime: getNowDateTimeLocalString(),
      keepRecordContent: '',
      keepRecordStatus: '',
      attachments: null,
      // 默认负责人 = 当前用户。后端兜底已统一处理，这里仅让 UI 层提示更友好。
      chargerId: currentEmployeeId ?? '',
    },
    entityToForm: toKeepRecordFormData,
    formToPayload: toKeepRecordPayload,
    transformData: (items) => items.map(toKeepRecordProfile),
    getEntityName: () => '跟进记录',
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams,
    },
  });

  const openCreateDialog = useCallback(() => {
    openCreateWithCustomerPreset(filter.activeFilters, crud.openCreateDialog, crud.setFormData);
  }, [crud.openCreateDialog, crud.setFormData, filter.activeFilters]);

  const { uploadFile } = useFileUpload();
  const columnVisibility = useColumnVisibility(KEEP_RECORD_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航：从 URL 参数中打开指定记录的详情
  useHighlightNavigation<KeepRecordProfile>('/keep-records', crud.openViewDialog, (data) =>
    toKeepRecordProfile(data as IKeepRecordResponse)
  );

  /**
   * 表格列：从 schema 派生；customerName / contactName 为 Profile 扁平化字段，
   * 通过 `mode:'before'` 作为虚拟列注入；keepRecordType/keepRecordStatus 已 schema 标注
   * statusBadge，自动渲染彩色 Badge，无需 overrides。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<KeepRecordProfile>(keepRecordResponseSchema, {
        overrides: [
          {
            key: 'customerName',
            mode: 'before',
            header: '客户名称',
            minWidth: 240,
            render: (item) =>
              item.customerId && item.customerName ? (
                <RelatedEntityLink
                  entityType="customer"
                  id={item.customerId}
                  label={item.customerName}
                  title={item.customerName}
                />
              ) : (
                '-'
              ),
          },
          {
            key: 'contactName',
            mode: 'before',
            header: '联系人',
            render: (item) => item.contactName || '-',
          },
          {
            key: 'keepRecordContent',
            render: (item) => {
              const content = item.keepRecordContent || '-';
              return (
                <span className="line-clamp-1" title={content}>
                  {content.length > 30 ? `${content.slice(0, 30)}...` : content}
                </span>
              );
            },
          },
          {
            key: 'attachments',
            render: (item) =>
              item.attachments && item.attachments.length > 0
                ? `${item.attachments.length} 个`
                : '-',
          },
        ],
      }),
    []
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<KeepRecordProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (item: KeepRecordProfile) => (
    <GenericMobileCard
      title={
        keepRecordTypeMap[item.keepRecordType ?? '']?.label || item.keepRecordType || '跟进记录'
      }
      status={
        item.keepRecordStatus ? (
          <StatusBadge status={item.keepRecordStatus} statusMap={keepRecordStatusMap} />
        ) : undefined
      }
      fields={[
        { label: '客户名称', value: item.customerName || '-' },
        {
          label: '跟进时间',
          value: item.keepRecordTime
            ? (() => {
                const dt = new Date(item.keepRecordTime);
                return Number.isNaN(dt.getTime()) ? '-' : format(dt, 'yyyy-MM-dd HH:mm');
              })()
            : '-',
        },
        {
          label: '跟进内容',
          value: item.keepRecordContent
            ? item.keepRecordContent.length > 20
              ? `${item.keepRecordContent.slice(0, 20)}...`
              : item.keepRecordContent
            : '-',
        },
        { label: '附件', value: item.attachments ? `${item.attachments.length} 个` : '无' },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`keep-record-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建跟进"
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
              <ColumnVisibilityDropdown
                columns={columnVisibility.columns}
                onToggle={columnVisibility.toggleColumn}
                onShowAll={columnVisibility.showAll}
                onResetVisibility={columnVisibility.resetToDefault}
                onReorder={columnVisibility.reorderColumns}
                currentSortBy={crud.sorting.sortBy}
                currentSortOrder={crud.sorting.sortOrder}
                onServerSortingVersionApplied={crud.sorting.markServerSortingVersionApplied}
              />
            }
            bulkSelection={{
              selectedCount: crud.selectedKeys.size,
              onClearSelection: crud.clearSelection,
              onBulkDelete: crud.openBulkDeleteDialog,
            }}
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
        pagination={crud.pagination}
      >
        <CrudTable
          {...crud.tableProps}
          data={crud.data}
          columns={columns}
          actions={rowActions}
          loading={crud.loading}
          sorting={crud.sorting}
          onRowClick={crud.openViewDialog}
          renderMobileCard={renderMobileCard}
          rowSelection={crud.rowSelectionProps}
          columnVisibility={{
            columns: columnVisibility.columns,
            onToggle: columnVisibility.toggleColumn,
            onShowAll: columnVisibility.showAll,
          }}
          hidePagination
          emptyState={{
            title: '暂无跟进记录',
            description: '点击"新建跟进"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '跟进详情' : '新建跟进'}
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'keep-records', target: crud.editingEntity?.id }}
        >
          {renderKeepRecordFields({
            entity: crud.editingEntity,
            formData: crud.formData,
            updateFormField: crud.updateFormField,
            getFieldError: crud.getFieldError,
            onUploadFile: uploadFile,
          })}
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建跟进
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
