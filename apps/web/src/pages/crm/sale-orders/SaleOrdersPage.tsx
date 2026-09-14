// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import { saleOrderResponseSchema } from '@ky-azeroth/shared/schemas/sale-order';
import type { ISaleOrderResponse } from '@ky-azeroth/shared/types/sale-order';
import { getEntityDisplayName } from '@ky-azeroth/shared/utils';
import { Ban, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { ApprovalDetailDrawer } from '@/components/patterns/approval-detail-drawer';
import { ApprovalStatusBadge } from '@/components/patterns/approval-status-badge';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { BusinessApprovalSection } from '@/components/patterns/business-approval-section';
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
import { useBusinessApproval } from '@/hooks/use-business-approval';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, buildEntityVersionMap, getErrorMessage } from '@/lib/api';
import { canDeleteApprovalBusiness } from '@/lib/approval-permissions';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateDisplay, getDateAfterYearsString, getTodayDateString } from '@/lib/date-utils';
import { orderStatusMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import { SaleOrderBulkApproveModal } from './components/SaleOrderBulkApproveModal';
import { SaleOrderBulkEditModal } from './components/SaleOrderBulkEditModal';
import { SaleOrderBulkTransferModal } from './components/SaleOrderBulkTransferModal';
import { SaleOrderVoidRequestDialog } from './components/SaleOrderVoidRequestDialog';
import { SALE_ORDER_COLUMN_CONFIG } from './sale-order-column-config';
import { renderSaleOrderFields } from './sale-order-fields';
import {
  createEmptyOrderProductItem,
  type SaleOrderFormData,
  saleOrderFormSchema,
  type SaleOrderProfile,
  toSaleOrderFormData,
  toSaleOrderPayload,
  toSaleOrderProfile,
  toSaleOrderUpdatePayload,
} from './types';

export function createInitialSaleOrderFormData(
  currentEmployeeId: string | null | undefined
): SaleOrderFormData {
  return {
    orderTitle: null,
    customerId: '',
    opportunityId: null,
    orderAmount: null,
    otherFee: 0,
    badDebtAmount: 0,
    businessDate: getTodayDateString(),
    paymentDate: null,
    orderBeginDate: getTodayDateString(),
    orderEndDate: getDateAfterYearsString(1),
    chargerId: currentEmployeeId ?? null,
    remark: null,
    products: [createEmptyOrderProductItem()],
    productsTouched: false,
  };
}

export function SaleOrdersPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasMenuPermission, hasViewScopeAll, user } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'sale_orders', 'create');
  const canEdit = hasMenuPermission('crm', 'sale_orders', 'edit');
  const canDelete = hasMenuPermission('crm', 'sale_orders', 'delete');
  const canApprove = hasMenuPermission('approval', 'approval_list', 'approve');
  const canBulkTransfer = canEdit && hasViewScopeAll('crm', 'sale_orders');

  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<SaleOrderProfile | null>(null);
  // 后端 RBAC 已放宽到双路径 OR（chargerId IN me OR customer.chargerId IN me），
  // 让 CLI/分析层能拿到一致快照。Web 列表则默认按业绩归属过滤——保持改造前体验，
  // 销售看到的仍是"chargerId=自己"的范围。用户主动在筛选栏改 chargerId 仍可生效。
  // viewScope=ALL 不注入默认值，保持看全量。
  const currentEmployeeId = user?.employee?.id ?? user?.id;
  const defaultChargerId = hasViewScopeAll('crm', 'sale_orders') ? undefined : currentEmployeeId;

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  // customerId 字段走 entityMultiSelect 控件（v1.2），无需手写 CustomerMultiSelect。
  const scheme = useFilterScheme('crm.sale_orders');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);
  const extraParams = useMemo(
    // filter.apiParams 在后，允许用户主动改 chargerId 覆盖默认值。
    () =>
      defaultChargerId ? { chargerId: defaultChargerId, ...filter.apiParams } : filter.apiParams,
    [filter.apiParams, defaultChargerId]
  );

  const crud = useCrud<SaleOrderProfile, SaleOrderFormData>({
    endpoint: '/sale-orders',
    // @ts-expect-error: schema 校验 ICreateSaleOrder；products.tempId 是 UI-only 字段
    schema: saleOrderFormSchema,
    validateMode: 'onSubmit',
    initialFormData: createInitialSaleOrderFormData(currentEmployeeId),
    entityToForm: toSaleOrderFormData,
    formToPayload: toSaleOrderPayload,
    formToUpdatePayload: toSaleOrderUpdatePayload,
    customUpdate: async ({ entity, payload, endpoint }) => {
      // 2026-06 改造后所有角色（含 ADMIN）对 approved 单据都走变更审批；
      // 若申请人=审批人，引擎 autoPassSelfTasksAndAdvance 会自动通过。
      if (entity.flowStatus === 'approved') {
        await api.post(`${endpoint}/${entity.id}/change-request`, payload);
        return { message: '已提交变更审批' };
      }
      await api.put(`${endpoint}/${entity.id}`, payload);
    },
    getEntityName: (order) => getEntityDisplayName('sale-order', order, 'short'),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams,
    },
  });

  const openCreateDialog = useCallback(() => {
    openCreateWithCustomerPreset(filter.activeFilters, crud.openCreateDialog, crud.setFormData);
  }, [crud.openCreateDialog, crud.setFormData, filter.activeFilters]);

  const approval = useBusinessApproval<SaleOrderProfile>({
    eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
    getEntityId: (entity) => entity.id,
    getFlowStatus: (entity) => entity.flowStatus,
    onSuccess: crud.refresh,
    onSubmitApproval: async (entity) => {
      await api.post(`/sale-orders/${entity.id}/submit-approval`);
    },
  });

  const columnVisibility = useColumnVisibility(SALE_ORDER_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航：从 URL 参数中打开指定记录的详情
  useHighlightNavigation<SaleOrderProfile>('/sale-orders', crud.openViewDialog, (data) =>
    toSaleOrderProfile(data as ISaleOrderResponse)
  );

  // 获取详情数据（含产品明细）后再打开对话框
  const [, setDetailLoading] = useState(false);

  const fetchDetailAndOpen = useCallback(
    async (item: SaleOrderProfile, mode: 'view' | 'edit') => {
      setDetailLoading(true);
      try {
        const res = await api.get(`/sale-orders/${item.id}`);
        const fullEntity = toSaleOrderProfile(res.data) as SaleOrderProfile;
        if (mode === 'view') {
          crud.openViewDialog(fullEntity);
        } else {
          crud.openEditDialog(fullEntity);
        }
      } catch (error) {
        if (mode === 'edit') {
          toast.error(getErrorMessage(error, '详情加载失败，无法编辑'));
          return;
        }
        // 查看模式可回退列表数据；编辑模式必须有完整详情，避免 products 子表被误判为空。
        crud.openViewDialog(item);
      } finally {
        setDetailLoading(false);
      }
    },
    [crud]
  );

  const handleRowClick = useCallback(
    (item: SaleOrderProfile) => {
      fetchDetailAndOpen(item, 'view');
    },
    [fetchDetailAndOpen]
  );

  /**
   * 表格列：从 `saleOrderResponseSchema` 派生，overrides 仅保留业务渲染：
   * - orderTitle: 加粗
   * - customerName / opportunityName: 穿透按钮（虚拟列）
   * - orderBeginDate: 拼接 `orderBeginDate ~ orderEndDate`
   * - remark: 保留换行 + title tooltip
   * orderStatus / orderInvoiceStatus 已标 statusBadge，走自动渲染（无 override）
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<SaleOrderProfile>(saleOrderResponseSchema, {
        overrides: [
          {
            key: 'orderTitle',
            render: (item) => <span className="font-medium">{item.orderTitle || '-'}</span>,
          },
          {
            key: 'customerName',
            render: (item) =>
              item.customerId && item.customer?.customerName ? (
                <RelatedEntityLink
                  entityType="customer"
                  id={item.customerId}
                  label={item.customer.customerName}
                  title={item.customer.customerName}
                />
              ) : (
                '-'
              ),
          },
          {
            key: 'orderBeginDate',
            header: '合同周期',
            render: (item) => {
              if (!item.orderBeginDate && !item.orderEndDate) return '-';
              const begin = formatDateDisplay(item.orderBeginDate);
              const end = formatDateDisplay(item.orderEndDate);
              return `${begin} ~ ${end}`;
            },
          },
          {
            key: 'flowStatus',
            render: (item) =>
              item.flowStatus ? <ApprovalStatusBadge status={item.flowStatus} /> : '-',
          },
          {
            key: 'opportunityName',
            render: (item) =>
              item.opportunityId && item.opportunity ? (
                <button
                  className="cursor-pointer text-left text-primary hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/crm/opportunities?highlight=${item.opportunityId}`);
                  }}
                  title={getEntityDisplayName('opportunity', item.opportunity, 'withContext')}
                >
                  {getEntityDisplayName('opportunity', item.opportunity, 'withContext')}
                </button>
              ) : (
                '-'
              ),
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
    [navigate]
  );

  const openBulkDelete = () => {
    const selected = crud.data.filter((item) => crud.selectedKeys.has(item.id));
    const locked = selected.filter((item) => !canDeleteApprovalBusiness(item.flowStatus));
    if (locked.length > 0) {
      toast.error('所选订单含审批中或已审批记录：审批中请先撤回，已审批请逐条发起“申请作废”');
      return;
    }
    crud.openBulkDeleteDialog();
  };

  const rowActions = useMemo(() => {
    const extras = [...approval.extraActions];
    if (canDelete) {
      extras.push({
        key: 'request-void',
        label: '申请作废',
        icon: <Ban className="h-4 w-4" />,
        onClick: setVoidTarget,
        hidden: (item) => item.flowStatus !== 'approved',
        danger: true,
      });
    }
    return createStandardActions<SaleOrderProfile>({
      onView: (item) => {
        void fetchDetailAndOpen(item, 'view');
      },
      onEdit: (item) => {
        void fetchDetailAndOpen(item, 'edit');
      },
      onDelete: crud.openDeleteDialog,
      canDelete: (item) => canDeleteApprovalBusiness(item.flowStatus),
      hideEdit: !canEdit,
      hideDelete: !canDelete,
      extraActions: canEdit || canDelete ? extras : [],
    });
  }, [fetchDetailAndOpen, crud.openDeleteDialog, canEdit, canDelete, approval.extraActions]);

  const renderMobileCard = (item: SaleOrderProfile) => (
    <GenericMobileCard
      title={getEntityDisplayName('sale-order', item, 'short')}
      status={
        item.orderStatus ? (
          <StatusBadge status={item.orderStatus} statusMap={orderStatusMap} />
        ) : undefined
      }
      fields={[
        { label: '编号', value: item.serialNumber },
        { label: '客户', value: item.customer?.customerName || '-' },
        {
          label: '合同金额',
          value: item.orderAmount != null ? Number(item.orderAmount).toFixed(2) : '-',
        },
        { label: '负责人', value: item.chargerName || '-' },
      ]}
      onClick={() => handleRowClick(item)}
      testId={`sale-order-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建合同"
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
              onBulkEdit: canEdit ? () => setBulkEditOpen(true) : undefined,
              onBulkDelete: canDelete ? openBulkDelete : undefined,
              actions: (
                <>
                  {canApprove && (
                    <Button variant="outline" size="sm" onClick={() => setBulkApproveOpen(true)}>
                      批量审批
                    </Button>
                  )}
                  {canBulkTransfer && (
                    <Button variant="outline" size="sm" onClick={() => setBulkTransferOpen(true)}>
                      批量换负责人
                    </Button>
                  )}
                </>
              ),
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
          onRowClick={handleRowClick}
          renderMobileCard={renderMobileCard}
          rowSelection={crud.rowSelectionProps}
          columnVisibility={{
            columns: columnVisibility.columns,
            onToggle: columnVisibility.toggleColumn,
            onShowAll: columnVisibility.showAll,
          }}
          hidePagination
          emptyState={{
            title: '暂无合同订单数据',
            description: '点击"新建合同"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          onModeChange={canEdit ? crud.formDialogProps.onModeChange : undefined}
          onDelete={
            canDelete && canDeleteApprovalBusiness(crud.editingEntity?.flowStatus)
              ? crud.formDialogProps.onDelete
              : undefined
          }
          viewHeaderActions={
            canDelete && crud.editingEntity?.flowStatus === 'approved' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setVoidTarget(crud.editingEntity)}
              >
                <Ban className="mr-1 h-3.5 w-3.5" />
                申请作废
              </Button>
            ) : undefined
          }
          variant="drawer"
          title={crud.isEditing ? '合同详情' : '新建合同'}
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'sale-orders', target: crud.editingEntity?.id }}
        >
          <>
            <BusinessApprovalSection
              eventType={APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE}
              formId={crud.editingEntity?.id}
              flowStatus={crud.editingEntity?.flowStatus}
              onSuccess={crud.refresh}
              className="col-span-2"
            />
            {renderSaleOrderFields({
              entity: crud.editingEntity,
              formData: crud.formData,
              updateFormField: crud.updateFormField,
              getFieldError: crud.getFieldError,
              onProductsChange: (products) => {
                crud.updateFormField('products', products);
                crud.updateFormField('productsTouched', true);
              },
            })}
          </>
        </FormDialog>

        <ApprovalDetailDrawer {...approval.drawerProps} />
        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
        <SaleOrderVoidRequestDialog
          open={Boolean(voidTarget)}
          onOpenChange={(open) => {
            if (!open) setVoidTarget(null);
          }}
          recordId={voidTarget?.id}
          recordVersion={voidTarget?.version}
          recordName={voidTarget?.orderTitle ?? voidTarget?.serialNumber}
          onSuccess={crud.refresh}
        />
        <SaleOrderBulkEditModal
          open={bulkEditOpen}
          onOpenChange={setBulkEditOpen}
          orderIds={Array.from(crud.selectedKeys)}
          versions={buildEntityVersionMap(
            crud.data.filter((order) => crud.selectedKeys.has(order.id))
          )}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <SaleOrderBulkTransferModal
          open={bulkTransferOpen}
          onOpenChange={setBulkTransferOpen}
          orderIds={Array.from(crud.selectedKeys)}
          versions={buildEntityVersionMap(
            crud.data.filter((order) => crud.selectedKeys.has(order.id))
          )}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <SaleOrderBulkApproveModal
          open={bulkApproveOpen}
          onOpenChange={setBulkApproveOpen}
          selectedOrders={crud.data
            .filter((o) => crud.selectedKeys.has(o.id))
            .map((o) => ({ id: o.id, flowStatus: o.flowStatus, serialNumber: o.serialNumber }))}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建合同
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
