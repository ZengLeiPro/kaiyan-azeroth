// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { APPROVAL_EVENT_TYPE, PAYMENT_DIRECTION } from '@ky-azeroth/shared/constants';
import { paymentResponseSchema } from '@ky-azeroth/shared/schemas/payment';
import type { IPaymentResponse } from '@ky-azeroth/shared/types/payment';
import { getEntityDisplayName } from '@ky-azeroth/shared/utils';
import { Ban, Plus, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { ApprovalDetailDrawer } from '@/components/patterns/approval-detail-drawer';
import { ApprovalStatusBadge } from '@/components/patterns/approval-status-badge';
import { ApprovalVoidRequestDialog } from '@/components/patterns/approval-void-request-dialog';
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
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBusinessApproval } from '@/hooks/use-business-approval';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, buildEntityVersionMap } from '@/lib/api';
import { canDeleteApprovalBusiness } from '@/lib/approval-permissions';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateDisplay, getTodayDateString } from '@/lib/date-utils';
import { getPaymentDisplayMeta } from '@/lib/payment-display';
import {
  getStatusColor,
  getStatusLabel,
  paymentDirectionMap,
  paymentStatusMap,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import { PaymentBulkApproveModal } from './components/PaymentBulkApproveModal';
import { PaymentBulkEditModal } from './components/PaymentBulkEditModal';
import { PaymentBulkTransferModal } from './components/PaymentBulkTransferModal';
import { PaymentMergeInvoiceModal } from './components/PaymentMergeInvoiceModal';
import {
  PaymentRefundCreateView,
  paymentTypeOptions,
  renderPaymentInFields,
} from './payment-fields';
import {
  type PaymentFormData,
  paymentFormSchema,
  type PaymentProfile,
  toPaymentFormData,
  toPaymentPayload,
  toPaymentProfile,
} from './types';

const PAYMENT_COLUMN_CONFIG = [
  { key: 'serialNumber', label: '编号', visible: true, canHide: false },
  { key: 'subject', label: '业务摘要', visible: true },
  { key: 'direction', label: '方向', visible: true },
  { key: 'customerName', label: '客户', visible: true },
  { key: 'orderSerialNumber', label: '关联合同', visible: true },
  { key: 'paymentAmount', label: '金额', visible: true },
  { key: 'paymentType', label: '付款方式', visible: true },
  { key: 'bankName', label: '收款账户', visible: true },
  { key: 'tradeSerialNumber', label: '交易流水号', visible: true },
  { key: 'businessDate', label: '业务日期', visible: true },
  { key: 'chargerName', label: '负责人', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'flowStatus', label: '审批状态', visible: true },
  { key: 'refundType', label: '退款类型', visible: false },
  { key: 'remark', label: '备注', visible: false },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

export function PaymentsPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasMenuPermission, hasViewScopeAll } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'payments', 'create');
  const canEdit = hasMenuPermission('crm', 'payments', 'edit');
  const canDelete = hasMenuPermission('crm', 'payments', 'delete');
  const canApprove = hasMenuPermission('approval', 'approval_list', 'approve');
  const canCreateInvoice = hasMenuPermission('crm', 'invoices', 'create');
  const canBulkTransfer = canEdit && hasViewScopeAll('crm', 'payments');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [mergeInvoiceOpen, setMergeInvoiceOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PaymentProfile | null>(null);
  // 退款抽屉：与回款 form-dialog 解耦，独立 open state 控制
  const [refundOpen, setRefundOpen] = useState(false);

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('crm.payments');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<PaymentProfile, PaymentFormData>({
    endpoint: '/payments',
    schema: paymentFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      saleOrderId: '',
      customerId: '',
      subject: '',
      paymentAmount: 0,
      paymentType: null,
      businessDate: getTodayDateString(),
      bankName: null,
      tradeSerialNumber: null,
      chargerId: null,
      remark: null,
      items: [],
    },
    entityToForm: toPaymentFormData,
    formToPayload: toPaymentPayload,
    customUpdate: async ({ entity, payload, endpoint }) => {
      // 2026-06 改造后所有角色（含 ADMIN）对 approved 单据都走变更审批。
      if (entity.flowStatus === 'approved') {
        await api.post(`${endpoint}/${entity.id}/change-request`, payload);
        return { message: '已提交变更审批' };
      }
      await api.put(`${endpoint}/${entity.id}`, payload);
    },
    transformData: (items) => items.map(toPaymentProfile),
    getEntityName: (entity) => getEntityDisplayName('payment', entity, 'short'),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const openCreateDialog = useCallback(() => {
    openCreateWithCustomerPreset(filter.activeFilters, crud.openCreateDialog, crud.setFormData);
  }, [crud.openCreateDialog, crud.setFormData, filter.activeFilters]);

  const approval = useBusinessApproval<PaymentProfile>({
    eventType: APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
    getEntityId: (entity) => entity.id,
    getFlowStatus: (entity) => entity.flowStatus,
    onSuccess: crud.refresh,
    onSubmitApproval: async (entity) => {
      const action =
        entity.direction === PAYMENT_DIRECTION.OUT ? 'submit-refund-approval' : 'submit-approval';
      await api.post(`/payments/${entity.id}/${action}`);
    },
  });

  const columnVisibility = useColumnVisibility(PAYMENT_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航：从 URL 参数中打开指定记录的详情
  useHighlightNavigation<PaymentProfile>('/payments', crud.openViewDialog, (data) =>
    toPaymentProfile(data as IPaymentResponse)
  );

  const getStatusBadge = (status: string) => {
    const label = getStatusLabel(status, paymentStatusMap);
    const color = getStatusColor(status, paymentStatusMap);
    return <Badge className={cn(color, `hover:${color}`)}>{label}</Badge>;
  };

  /**
   * 表格列：从 `paymentResponseSchema` 派生；overrides 保留业务渲染：
   * - serialNumber: 加粗（退款行加橙色）
   * - customerName / orderSerialNumber: 穿透按钮
   * - paymentAmount: font-mono（退款行橙色负数前缀）
   * - direction: paymentDirectionMap Badge（IN/OUT 不走 schema statusBadge）
   * - businessDate: 日期格式化兜底
   * - remark: 保留换行 + title tooltip
   * status / paymentType / refundType 已标 statusBadge，走自动渲染（无 override）
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<PaymentProfile>(paymentResponseSchema, {
        overrides: [
          {
            key: 'serialNumber',
            render: (item) => (
              <span
                className={cn(
                  'font-medium',
                  item.direction === PAYMENT_DIRECTION.OUT && 'text-orange-700'
                )}
              >
                {item.serialNumber}
              </span>
            ),
          },
          {
            key: 'direction',
            render: (item) => {
              const display = getPaymentDisplayMeta(item);
              const cfg =
                paymentDirectionMap[
                  item.legacyAdjustment ? PAYMENT_DIRECTION.OUT : (item.direction as 'IN' | 'OUT')
                ];
              if (!cfg) return display.directionLabel;
              return (
                <Badge className={cn(cfg.color, `hover:${cfg.color}`)}>
                  {display.directionLabel}
                </Badge>
              );
            },
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
            key: 'orderSerialNumber',
            render: (item) =>
              item.saleOrderId && item.saleOrder ? (
                <button
                  className="cursor-pointer text-left text-primary hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/crm/sale-orders?highlight=${item.saleOrderId}`);
                  }}
                  title={getEntityDisplayName('sale-order', item.saleOrder, 'withContext')}
                >
                  {getEntityDisplayName('sale-order', item.saleOrder, 'withContext')}
                </button>
              ) : (
                '-'
              ),
          },
          {
            key: 'paymentAmount',
            render: (item) => {
              const isRefund = item.direction === PAYMENT_DIRECTION.OUT;
              const prefix = isRefund ? '-' : '';
              return (
                <span className={cn('font-mono', isRefund && 'text-orange-700')}>
                  {prefix}
                  {Number(item.paymentAmount).toFixed(2)}
                </span>
              );
            },
          },
          {
            key: 'businessDate',
            render: (item) => formatDateDisplay(item.businessDate) || '-',
          },
          {
            key: 'flowStatus',
            render: (item) =>
              item.flowStatus ? <ApprovalStatusBadge status={item.flowStatus} /> : '-',
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

  const ensureNoLegacySelected = (actionLabel: string) => {
    const legacyCount = crud.data.filter(
      (item) => crud.selectedKeys.has(item.id) && item.legacyAdjustment
    ).length;
    if (legacyCount === 0) return true;
    toast.error(`所选记录含 ${legacyCount} 条历史冲正，只读治理记录不能${actionLabel}`);
    return false;
  };

  const openBulkDelete = () => {
    if (!ensureNoLegacySelected('批量删除')) return;
    const selected = crud.data.filter((item) => crud.selectedKeys.has(item.id));
    const locked = selected.filter((item) => !canDeleteApprovalBusiness(item.flowStatus));
    if (locked.length > 0) {
      toast.error('所选回款含审批中或已审批记录：审批中请先撤回，已审批请逐条发起“申请作废”');
      return;
    }
    crud.openBulkDeleteDialog();
  };

  const rowActions = useMemo(() => {
    const extras = approval.extraActions.map((action) =>
      action.key === 'view-approval'
        ? action
        : {
            ...action,
            hidden: (item: PaymentProfile) =>
              item.legacyAdjustment || Boolean(action.hidden?.(item)),
          }
    );
    if (canDelete) {
      extras.push({
        key: 'request-void',
        label: '申请作废',
        icon: <Ban className="h-4 w-4" />,
        onClick: setVoidTarget,
        hidden: (item) => item.legacyAdjustment || item.flowStatus !== 'approved',
        danger: true,
      });
    }
    return createStandardActions<PaymentProfile>({
      onView: crud.openViewDialog,
      onEdit: crud.openEditDialog,
      onDelete: crud.openDeleteDialog,
      canDelete: (item) => canDeleteApprovalBusiness(item.flowStatus),
      hideEdit: !canEdit,
      hideDelete: !canDelete,
      extraActions: canEdit || canDelete ? extras : [],
    }).map((action) =>
      action.key === 'edit' || action.key === 'delete'
        ? {
            ...action,
            hidden: (item: PaymentProfile) => item.legacyAdjustment,
          }
        : action
    );
  }, [
    crud.openViewDialog,
    crud.openEditDialog,
    crud.openDeleteDialog,
    canEdit,
    canDelete,
    approval.extraActions,
  ]);

  const renderMobileCard = (item: PaymentProfile) => {
    const display = getPaymentDisplayMeta(item);
    const dirCfg =
      paymentDirectionMap[
        item.legacyAdjustment ? PAYMENT_DIRECTION.OUT : (item.direction as 'IN' | 'OUT')
      ];
    return (
      <GenericMobileCard
        title={
          <span className="flex items-center gap-2">
            <span className={cn(display.isOut && 'text-orange-700')}>
              {getEntityDisplayName('payment', item, 'short')}
            </span>
            {dirCfg && (
              <Badge className={cn(dirCfg.color, `hover:${dirCfg.color}`)}>
                {display.directionLabel}
              </Badge>
            )}
          </span>
        }
        status={getStatusBadge(item.status)}
        fields={[
          {
            label: '编号',
            value: item.serialNumber,
          },
          {
            label: display.amountLabel,
            value: (
              <span className={cn(display.isOut && 'text-orange-700')}>
                {display.isOut ? '-' : ''}
                {Number(item.paymentAmount).toFixed(2)}
              </span>
            ),
          },
          {
            label: '付款方式',
            value:
              paymentTypeOptions.find((o) => o.value === item.paymentType)?.label ||
              item.paymentType ||
              '-',
          },
          { label: '收款账户', value: item.bankName || '-' },
          { label: '业务日期', value: formatDateDisplay(item.businessDate) || '-' },
          { label: '负责人', value: item.chargerName || '-' },
        ]}
        onClick={() => crud.openViewDialog(item)}
        testId={`payment-${item.id}`}
      />
    );
  };

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建回款"
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
              <>
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
                {canCreate && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRefundOpen(true)}
                    className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    退款
                  </Button>
                )}
              </>
            }
            bulkSelection={{
              selectedCount: crud.selectedKeys.size,
              onClearSelection: crud.clearSelection,
              onBulkEdit: canEdit
                ? () => {
                    if (ensureNoLegacySelected('批量编辑')) setBulkEditOpen(true);
                  }
                : undefined,
              onBulkDelete: canDelete ? openBulkDelete : undefined,
              actions: (
                <>
                  {canApprove && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (ensureNoLegacySelected('批量审批')) setBulkApproveOpen(true);
                      }}
                    >
                      批量审批
                    </Button>
                  )}
                  {canCreateInvoice && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (ensureNoLegacySelected('合并开票')) setMergeInvoiceOpen(true);
                      }}
                    >
                      合并开票
                    </Button>
                  )}
                  {canBulkTransfer && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (ensureNoLegacySelected('批量换负责人')) setBulkTransferOpen(true);
                      }}
                    >
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
            title: '暂无回款数据',
            description: '点击"新建回款"添加第一条记录',
          }}
        />

        <FormDialog
          {...crud.formDialogProps}
          onModeChange={
            canEdit && !crud.editingEntity?.legacyAdjustment
              ? crud.formDialogProps.onModeChange
              : undefined
          }
          onDelete={
            canDelete &&
            !crud.editingEntity?.legacyAdjustment &&
            canDeleteApprovalBusiness(crud.editingEntity?.flowStatus)
              ? crud.formDialogProps.onDelete
              : undefined
          }
          viewHeaderActions={
            canDelete &&
            !crud.editingEntity?.legacyAdjustment &&
            crud.editingEntity?.flowStatus === 'approved' ? (
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
          title={
            crud.editingEntity?.legacyAdjustment
              ? '历史冲正详情'
              : crud.isEditing
                ? '回款详情'
                : '新建回款'
          }
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'payments', target: crud.editingEntity?.id }}
        >
          <>
            <BusinessApprovalSection
              eventType={APPROVAL_EVENT_TYPE.PAYMENT_APPROVE}
              formId={crud.editingEntity?.id}
              flowStatus={crud.editingEntity?.flowStatus}
              onSuccess={crud.refresh}
              className="col-span-2"
            />
            {renderPaymentInFields({
              entity: crud.editingEntity,
              formData: crud.formData,
              updateFormField: crud.updateFormField,
              getFieldError: crud.getFieldError,
            })}
          </>
        </FormDialog>

        <ApprovalDetailDrawer {...approval.drawerProps} />
        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
        <ApprovalVoidRequestDialog
          open={Boolean(voidTarget)}
          onOpenChange={(open) => {
            if (!open) setVoidTarget(null);
          }}
          endpoint="/payments"
          recordId={voidTarget?.id}
          recordVersion={voidTarget?.version}
          recordLabel={
            voidTarget?.legacyAdjustment
              ? '历史冲正记录'
              : voidTarget?.direction === PAYMENT_DIRECTION.OUT
                ? '退款记录'
                : '回款记录'
          }
          recordName={voidTarget?.serialNumber}
          onSuccess={crud.refresh}
        />
        <PaymentBulkEditModal
          open={bulkEditOpen}
          onOpenChange={setBulkEditOpen}
          paymentIds={Array.from(crud.selectedKeys)}
          versions={buildEntityVersionMap(
            crud.data.filter((payment) => crud.selectedKeys.has(payment.id))
          )}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <PaymentBulkTransferModal
          open={bulkTransferOpen}
          onOpenChange={setBulkTransferOpen}
          paymentIds={Array.from(crud.selectedKeys)}
          versions={buildEntityVersionMap(
            crud.data.filter((payment) => crud.selectedKeys.has(payment.id))
          )}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <PaymentBulkApproveModal
          open={bulkApproveOpen}
          onOpenChange={setBulkApproveOpen}
          selectedPayments={crud.data
            .filter((p) => crud.selectedKeys.has(p.id))
            .map((p) => ({ id: p.id, flowStatus: p.flowStatus, direction: p.direction }))}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <PaymentMergeInvoiceModal
          open={mergeInvoiceOpen}
          onOpenChange={setMergeInvoiceOpen}
          selectedPayments={crud.data
            .filter((p) => crud.selectedKeys.has(p.id))
            .map((p) => ({
              id: p.id,
              serialNumber: p.serialNumber,
              customerId: p.customerId,
              customerName: p.customer?.customerName,
              saleOrderId: p.saleOrderId,
              saleOrderSerialNumber: p.saleOrder?.serialNumber,
              direction: p.direction,
              flowStatus: p.flowStatus,
              invoicedByInvoiceId: (p as { invoicedByInvoiceId?: string | null })
                .invoicedByInvoiceId,
              paymentAmount: p.paymentAmount,
            }))}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />

        {/* 退款创建抽屉。drawer-stack 内不挂 'payment-refund' entity，独立 open state 控制 */}
        <ResponsiveDialog
          open={refundOpen}
          onOpenChange={setRefundOpen}
          title="新建退款"
          variant="drawer"
          desktopMaxWidth="max-w-[920px]"
          hideCloseButton
        >
          {refundOpen && (
            <PaymentRefundCreateView
              onClose={() => setRefundOpen(false)}
              onSuccess={crud.refresh}
            />
          )}
        </ResponsiveDialog>
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建回款
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-orange-300 text-orange-700"
            onClick={() => setRefundOpen(true)}
          >
            <Undo2 className="mr-2 h-4 w-4" />
            退款
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
