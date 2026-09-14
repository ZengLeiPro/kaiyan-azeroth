// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { contactResponseSchema } from '@ky-azeroth/shared/schemas/contact';
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
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { recordStatusMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import { CONTACT_COLUMN_CONFIG, getContactMobileFields } from './contact-display';
import { renderContactFields } from './contact-fields';
import {
  type ContactFormData,
  contactFormSchema,
  type ContactProfile,
  toContactFormData,
  toContactPayload,
} from './types';

export function ContactsPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'contacts', 'create');
  const canEdit = hasMenuPermission('crm', 'contacts', 'edit');
  const canDelete = hasMenuPermission('crm', 'contacts', 'delete');

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  // customerId 字段走 entityMultiSelect 控件（v1.2），无需手写 CustomerMultiSelect。
  const scheme = useFilterScheme('crm.contacts');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<ContactProfile, ContactFormData>({
    endpoint: '/contacts',
    schema: contactFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      contactName: '',
      customerId: '',
      sex: null,
      mobile: null,
      phone: null,
      email: null,
      wechat: null,
      position: null,
      department: null,
      remark: null,
    },
    entityToForm: toContactFormData,
    formToPayload: toContactPayload,
    getEntityName: (contact) => contact.contactName,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const openCreateDialog = useCallback(() => {
    openCreateWithCustomerPreset(filter.activeFilters, crud.openCreateDialog, crud.setFormData);
  }, [crud.openCreateDialog, crud.setFormData, filter.activeFilters]);

  const columnVisibility = useColumnVisibility(CONTACT_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航
  useHighlightNavigation<ContactProfile>('/contacts', crud.openViewDialog);

  /**
   * 表格列：从 `contactResponseSchema` 派生，overrides 保留业务渲染：
   * - contactName: 加粗
   * - customerName: 读 `item.customer?.customerName`
   * - sex: 已 schema 标注 statusBadge/gender，自动渲染彩色 Badge，无需 override
   * - remark: 保留换行 + title tooltip
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<ContactProfile>(contactResponseSchema, {
        overrides: [
          {
            key: 'contactName',
            render: (item) => <span className="font-medium">{item.contactName}</span>,
          },
          {
            key: 'customerName',
            render: (item) => item.customer?.customerName || '-',
          },
          {
            key: 'remark',
            render: (item) => {
              const text = item.remark;
              if (!text) return '-';
              return (
                <span className="whitespace-pre-wrap break-words" title={text}>
                  {text}
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
      createStandardActions<ContactProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (item: ContactProfile) => (
    <GenericMobileCard
      title={item.contactName}
      status={<StatusBadge status={item.status} statusMap={recordStatusMap} />}
      fields={getContactMobileFields(item)}
      onClick={() => crud.openViewDialog(item)}
      testId={`contact-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建联系人"
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
        pagination={crud.pagination}
      >
        <CrudTable
          {...crud.tableProps}
          data={crud.data}
          columns={columns}
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
            title: '暂无联系人数据',
            description: '点击"新建联系人"添加第一条记录',
          }}
          actions={rowActions}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '联系人详情' : '新建联系人'}
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'contacts', target: crud.editingEntity?.id }}
        >
          {renderContactFields({
            entity: crud.editingEntity,
            formData: crud.formData,
            updateFormField: crud.updateFormField,
            getFieldError: crud.getFieldError,
          })}
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建联系人
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
