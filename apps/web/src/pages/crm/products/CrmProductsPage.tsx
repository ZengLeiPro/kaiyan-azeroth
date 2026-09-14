// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_TYPE_LABELS,
  PRODUCT_UNIT_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import { crmProductResponseSchema } from '@ky-azeroth/shared/schemas/crm-product';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { FormField } from '@/components/patterns/form-field';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { productStatusMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { createCrmProductActions } from './product-actions';
import {
  type CrmProductFormData,
  crmProductFormSchema,
  type CrmProductProfile,
  toCrmProductFormData,
  toCrmProductPayload,
  toCrmProductUpdatePayload,
} from './types';

const CRM_PRODUCT_COLUMN_CONFIG = [
  { key: 'productName', label: '产品名称', visible: true, canHide: false },
  { key: 'productNumber', label: '产品编号', visible: false },
  { key: 'productTypes', label: '产品类型', visible: true },
  { key: 'productUnit', label: '单位', visible: true },
  { key: 'standardPrice', label: '标准价格', visible: true },
  { key: 'productStatus', label: '产品状态', visible: true },
  { key: 'remark', label: '备注', visible: false },
  { key: 'status', label: '记录状态', visible: false },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

/** 产品状态选项：从 shared PRODUCT_STATUS_LABELS 生成 */
const productStatusOptions = Object.entries(PRODUCT_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const productTypeOptions = Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const productUnitOptions = Object.entries(PRODUCT_UNIT_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function CrmProductsPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'products', 'create');
  const canEdit = hasMenuPermission('crm', 'products', 'edit');
  const canDelete = hasMenuPermission('crm', 'products', 'delete');

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('crm.products');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<CrmProductProfile, CrmProductFormData>({
    endpoint: '/crm-products',
    schema: crmProductFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      productName: '',
      productNumber: null,
      productTypes: null,
      productUnit: null,
      standardPrice: null,
      productStatus: null,
      remark: null,
    },
    entityToForm: toCrmProductFormData,
    formToPayload: toCrmProductPayload,
    formToUpdatePayload: toCrmProductUpdatePayload,
    getEntityName: (product) => product.productName,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const { update: updateProduct } = crud;

  const columnVisibility = useColumnVisibility(CRM_PRODUCT_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  /**
   * 表格列：绝大部分从 `crmProductResponseSchema` 派生；
   * productTypes/productStatus/productUnit 已 schema 标注 statusBadge，自动渲染彩色 Badge；
   * 仅以下 2 列通过 overrides 保留业务渲染：
   * - productName: 加粗
   * - remark: 保留换行 + title tooltip
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<CrmProductProfile>(crmProductResponseSchema, {
        overrides: [
          {
            key: 'productName',
            render: (item) => <span className="font-medium">{item.productName}</span>,
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
      createCrmProductActions({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        onOffSale: (product) => {
          void updateProduct(product.id, {
            productStatus: 'off_sale',
            version: product.version,
          });
        },
        canEdit,
        canDelete,
      }),
    [
      crud.openViewDialog,
      crud.openEditDialog,
      crud.openDeleteDialog,
      updateProduct,
      canEdit,
      canDelete,
    ]
  );

  const renderMobileCard = (item: CrmProductProfile) => (
    <GenericMobileCard
      title={item.productName}
      status={
        item.productStatus ? (
          <StatusBadge status={item.productStatus} statusMap={productStatusMap} />
        ) : undefined
      }
      fields={[
        { label: '编号', value: item.productNumber || '-' },
        { label: '单位', value: item.productUnit || '-' },
        {
          label: '标准价格',
          value: item.standardPrice != null ? Number(item.standardPrice).toFixed(2) : '-',
        },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`crm-product-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建产品"
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
            title: '暂无产品数据',
            description: '点击"新建产品"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '产品详情' : '新建产品'}
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'crm-products', target: crud.editingEntity?.id }}
        >
          <>
            <FormField
              name="productName"
              label="产品名称"
              required
              error={crud.getFieldError('productName')}
              viewContent={crud.formData.productName}
            >
              <Input
                id="productName"
                placeholder="请输入产品名称"
                value={crud.formData.productName}
                onChange={(e) => crud.updateFormField('productName', e.target.value)}
              />
            </FormField>

            <FormField
              name="productTypes"
              label="产品类型"
              error={crud.getFieldError('productTypes')}
              viewContent={
                productTypeOptions.find((o) => o.value === crud.formData.productTypes)?.label ||
                crud.formData.productTypes
              }
            >
              <Select
                options={[{ value: '', label: '请选择' }, ...productTypeOptions]}
                value={crud.formData.productTypes ?? ''}
                onValueChange={(v) => crud.updateFormField('productTypes', v || null)}
              />
            </FormField>

            <FormField
              name="productUnit"
              label="单位"
              error={crud.getFieldError('productUnit')}
              viewContent={
                productUnitOptions.find((o) => o.value === crud.formData.productUnit)?.label ||
                crud.formData.productUnit
              }
            >
              <Select
                options={[{ value: '', label: '请选择' }, ...productUnitOptions]}
                value={crud.formData.productUnit ?? ''}
                onValueChange={(v) => crud.updateFormField('productUnit', v || null)}
              />
            </FormField>

            <FormField
              name="standardPrice"
              label="标准价格"
              error={crud.getFieldError('standardPrice')}
              viewContent={
                crud.formData.standardPrice != null
                  ? Number(crud.formData.standardPrice).toFixed(2)
                  : '-'
              }
            >
              <Input
                id="standardPrice"
                type="number"
                step="0.01"
                placeholder="请输入标准价格"
                value={crud.formData.standardPrice ?? ''}
                onChange={(e) =>
                  crud.updateFormField(
                    'standardPrice',
                    e.target.value ? Number(e.target.value) : null
                  )
                }
              />
            </FormField>

            <FormField
              name="productStatus"
              label="产品状态"
              error={crud.getFieldError('productStatus')}
              viewContent={
                crud.formData.productStatus ? (
                  <StatusBadge status={crud.formData.productStatus} statusMap={productStatusMap} />
                ) : undefined
              }
            >
              <Select
                options={[{ value: '', label: '请选择' }, ...productStatusOptions]}
                value={crud.formData.productStatus ?? ''}
                onValueChange={(v) => crud.updateFormField('productStatus', v || null)}
              />
            </FormField>

            <FormField
              name="remark"
              label="备注"
              fullRow
              error={crud.getFieldError('remark')}
              viewContent={crud.formData.remark}
            >
              <Textarea
                id="remark"
                placeholder="请输入备注信息"
                value={crud.formData.remark ?? ''}
                onChange={(e) => crud.updateFormField('remark', e.target.value || null)}
                rows={3}
              />
            </FormField>
          </>
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={crud.openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建产品
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
