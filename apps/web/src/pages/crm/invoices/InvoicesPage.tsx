// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { APPROVAL_EVENT_TYPE, INVOICE_STATUS } from '@ky-azeroth/shared/constants';
import { INVOICE_TYPE_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { invoiceResponseSchema } from '@ky-azeroth/shared/schemas/invoice';
import type { IInvoiceResponse } from '@ky-azeroth/shared/types/invoice';
import { getEntityDisplayName } from '@ky-azeroth/shared/utils';
import { Plus, Undo2 } from 'lucide-react';
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
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
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
import { formatDateDisplay, getTodayDateString } from '@/lib/date-utils';
import { getStatusColor, getStatusLabel, invoiceStatusMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import { InvoiceBulkApproveModal } from './components/InvoiceBulkApproveModal';
import { InvoiceBulkEditModal } from './components/InvoiceBulkEditModal';
import { InvoiceBulkTransferModal } from './components/InvoiceBulkTransferModal';
import { renderInvoiceFields } from './invoice-fields';
import {
  type InvoiceFormData,
  invoiceFormSchema,
  type InvoiceProfile,
  toInvoiceFormData,
  toInvoicePayload,
  toInvoiceProfile,
} from './types';

const INVOICE_COLUMN_CONFIG = [
  { key: 'serialNumber', label: '编号', visible: true, canHide: false },
  { key: 'subject', label: '业务摘要', visible: true },
  { key: 'customerName', label: '客户', visible: true },
  { key: 'orderSerialNumber', label: '关联合同', visible: true },
  { key: 'invoiceAmount', label: '发票金额', visible: true },
  { key: 'invoiceNumber', label: '发票号码', visible: true },
  { key: 'invoiceType', label: '发票类型', visible: true },
  { key: 'invoiceDate', label: '开票日期', visible: true },
  { key: 'invoiceStatus', label: '开票状态', visible: true },
  { key: 'flowStatus', label: '审批状态', visible: true },
  { key: 'title', label: '抬头', visible: true },
  { key: 'taxIdentifyNum', label: '纳税识别号', visible: true },
  { key: 'remark', label: '备注', visible: false },
  { key: 'itemType', label: '发票项目', visible: false },
  { key: 'bankName', label: '开户银行', visible: false },
  { key: 'bankAccount', label: '银行账号', visible: false },
  { key: 'registeredAddress', label: '注册地址', visible: false },
  { key: 'registeredPhone', label: '注册电话', visible: false },
  { key: 'status', label: '记录状态', visible: false },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

/**
 * 列表/卡片里仍要展示「发票类型 label」，保留本地副本。
 */
const invoiceTypeOptions = Object.entries(INVOICE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function InvoicesPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasMenuPermission, hasViewScopeAll } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'invoices', 'create');
  const canEdit = hasMenuPermission('crm', 'invoices', 'edit');
  const canDelete = hasMenuPermission('crm', 'invoices', 'delete');
  const canApprove = hasMenuPermission('approval', 'approval_list', 'approve');
  const canBulkTransfer = canEdit && hasViewScopeAll('crm', 'invoices');
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);

  // 冲红对话框状态
  const [redVoidTarget, setRedVoidTarget] = useState<InvoiceProfile | null>(null);
  const [redVoidReason, setRedVoidReason] = useState('');
  const [redVoidSubmitting, setRedVoidSubmitting] = useState(false);

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('crm.invoices');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const crud = useCrud<InvoiceProfile, InvoiceFormData>({
    endpoint: '/invoices',
    schema: invoiceFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      saleOrderId: '',
      customerId: '',
      subject: '',
      invoiceAmount: 0,
      invoiceType: null,
      invoiceDate: getTodayDateString(),
      invoiceNumber: null,
      title: null,
      taxIdentifyNum: null,
      invoiceStatus: null,
      itemType: null,
      bankName: null,
      bankAccount: null,
      registeredAddress: null,
      registeredPhone: null,
      remark: null,
    },
    entityToForm: toInvoiceFormData,
    formToPayload: toInvoicePayload,
    customUpdate: async ({ entity, payload, endpoint }) => {
      // 2026-06 改造后所有角色（含 ADMIN）对 approved 单据都走变更审批。
      if (entity.flowStatus === 'approved') {
        await api.post(`${endpoint}/${entity.id}/change-request`, payload);
        return { message: '已提交变更审批' };
      }
      await api.put(`${endpoint}/${entity.id}`, payload);
    },
    transformData: (items) => items.map(toInvoiceProfile),
    getEntityName: (entity) => getEntityDisplayName('invoice', entity, 'short'),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
  });

  const openCreateDialog = useCallback(() => {
    openCreateWithCustomerPreset(filter.activeFilters, crud.openCreateDialog, crud.setFormData);
  }, [crud.openCreateDialog, crud.setFormData, filter.activeFilters]);

  const approval = useBusinessApproval<InvoiceProfile>({
    eventType: APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
    getEntityId: (entity) => entity.id,
    getFlowStatus: (entity) => entity.flowStatus,
    onSuccess: crud.refresh,
    onSubmitApproval: async (entity) => {
      await api.post(`/invoices/${entity.id}/submit-approval`);
    },
  });

  const columnVisibility = useColumnVisibility(INVOICE_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航：从 URL 参数中打开指定记录的详情
  useHighlightNavigation<InvoiceProfile>('/invoices', crud.openViewDialog, (data) =>
    toInvoiceProfile(data as IInvoiceResponse)
  );

  const getStatusBadge = (status: string | null) => {
    if (!status) return <span className="text-muted-foreground">-</span>;
    const label = getStatusLabel(status, invoiceStatusMap);
    const color = getStatusColor(status, invoiceStatusMap);
    return <Badge className={cn(color, `hover:${color}`)}>{label}</Badge>;
  };

  /**
   * 表格列：从 `invoiceResponseSchema` 派生；overrides 保留业务渲染：
   * - serialNumber: 加粗
   * - customerName / orderSerialNumber: 穿透按钮
   * - invoiceAmount: font-mono
   * - taxIdentifyNum: font-mono text-xs
   * - remark: 保留换行 + title tooltip
   * invoiceStatus / invoiceType / itemType 已标 statusBadge，走自动渲染（无 override）
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<InvoiceProfile>(invoiceResponseSchema, {
        overrides: [
          {
            key: 'serialNumber',
            render: (item) => <span className="font-medium">{item.serialNumber}</span>,
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
            key: 'invoiceAmount',
            render: (item) => (
              <span className="font-mono">{Number(item.invoiceAmount).toFixed(2)}</span>
            ),
          },
          {
            key: 'invoiceDate',
            render: (item) => formatDateDisplay(item.invoiceDate) || '-',
          },
          {
            key: 'flowStatus',
            render: (item) =>
              item.flowStatus ? <ApprovalStatusBadge status={item.flowStatus} /> : '-',
          },
          {
            key: 'taxIdentifyNum',
            render: (item) => (
              <span className="font-mono text-xs">{item.taxIdentifyNum || '-'}</span>
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

  const rowActions = useMemo(() => {
    const extras = canEdit ? [...approval.extraActions] : [];
    // 冲红按钮：仅 NORMAL + approved 的发票可见。点击后弹出原因输入对话框。
    if (canEdit) {
      extras.push({
        key: 'red-void',
        label: '冲红',
        icon: <Undo2 className="h-3.5 w-3.5" />,
        hidden: (item) =>
          item.invoiceStatus !== INVOICE_STATUS.NORMAL || item.flowStatus !== 'approved',
        danger: true,
        separator: true,
        onClick: (item) => {
          setRedVoidTarget(item);
          setRedVoidReason('');
        },
      });
    }
    return createStandardActions<InvoiceProfile>({
      onView: crud.openViewDialog,
      onEdit: crud.openEditDialog,
      onDelete: crud.openDeleteDialog,
      canDelete: (item) => canDeleteApprovalBusiness(item.flowStatus),
      hideEdit: !canEdit,
      hideDelete: !canDelete,
      extraActions: extras,
    });
  }, [
    crud.openViewDialog,
    crud.openEditDialog,
    crud.openDeleteDialog,
    canEdit,
    canDelete,
    approval.extraActions,
  ]);

  const handleConfirmRedVoid = useCallback(async () => {
    if (!redVoidTarget) return;
    // @validation-ok: 业务规则前置检查（非 form 字段校验，正式 schema 在后端 RedVoidInvoiceDto 处理）
    if (!redVoidReason.trim()) {
      toast.error('请填写冲红原因');
      return;
    }
    setRedVoidSubmitting(true);
    try {
      await api.post(`/invoices/${redVoidTarget.id}/red-void`, {
        version: redVoidTarget.version ?? 1,
        reason: redVoidReason.trim(),
      });
      toast.success('发票已冲红');
      setRedVoidTarget(null);
      setRedVoidReason('');
      crud.refresh();
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setRedVoidSubmitting(false);
    }
  }, [redVoidTarget, redVoidReason, crud]);

  const renderMobileCard = (item: InvoiceProfile) => (
    <GenericMobileCard
      title={getEntityDisplayName('invoice', item, 'short')}
      status={getStatusBadge(item.invoiceStatus)}
      fields={[
        { label: '编号', value: item.serialNumber },
        { label: '发票金额', value: Number(item.invoiceAmount).toFixed(2) },
        {
          label: '发票类型',
          value:
            invoiceTypeOptions.find((o) => o.value === item.invoiceType)?.label ||
            item.invoiceType ||
            '-',
        },
        { label: '开票日期', value: formatDateDisplay(item.invoiceDate) || '-' },
        { label: '抬头', value: item.title || '-' },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`invoice-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建开票"
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
              onBulkDelete: canDelete ? crud.openBulkDeleteDialog : undefined,
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
            title: '暂无开票数据',
            description: '点击"新建开票"添加第一条记录',
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
          variant="drawer"
          title={crud.isEditing ? '开票详情' : '新建开票'}
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'invoices', target: crud.editingEntity?.id }}
        >
          <>
            <BusinessApprovalSection
              eventType={APPROVAL_EVENT_TYPE.INVOICE_APPROVE}
              formId={crud.editingEntity?.id}
              flowStatus={crud.editingEntity?.flowStatus}
              onSuccess={crud.refresh}
              className="col-span-2"
            />
            {renderInvoiceFields({
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
        <InvoiceBulkEditModal
          open={bulkEditOpen}
          onOpenChange={setBulkEditOpen}
          invoiceIds={Array.from(crud.selectedKeys)}
          versions={buildEntityVersionMap(
            crud.data.filter((invoice) => crud.selectedKeys.has(invoice.id))
          )}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <InvoiceBulkTransferModal
          open={bulkTransferOpen}
          onOpenChange={setBulkTransferOpen}
          invoiceIds={Array.from(crud.selectedKeys)}
          versions={buildEntityVersionMap(
            crud.data.filter((invoice) => crud.selectedKeys.has(invoice.id))
          )}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <InvoiceBulkApproveModal
          open={bulkApproveOpen}
          onOpenChange={setBulkApproveOpen}
          selectedInvoices={crud.data
            .filter((p) => crud.selectedKeys.has(p.id))
            .map((p) => ({ id: p.id, flowStatus: p.flowStatus }))}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />

        {/* 冲红原因 Dialog */}
        <Dialog
          open={!!redVoidTarget}
          onOpenChange={(o) => {
            if (!o && !redVoidSubmitting) {
              setRedVoidTarget(null);
              setRedVoidReason('');
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>冲红发票 {redVoidTarget?.serialNumber}</DialogTitle>
              <DialogDescription>
                冲红后原票状态将变为「已冲红」，订单净开票额会下调；该操作仅支持全额冲红，部分冲红
                请先全冲再重开。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <label className="text-sm font-medium">冲红原因 *</label>
              <Textarea
                placeholder="请输入冲红原因（如：发票信息错误、客户取消等）"
                value={redVoidReason}
                onChange={(e) => setRedVoidReason(e.target.value)}
                className="min-h-20"
                maxLength={500}
                disabled={redVoidSubmitting}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRedVoidTarget(null);
                  setRedVoidReason('');
                }}
                disabled={redVoidSubmitting}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmRedVoid}
                disabled={redVoidSubmitting || !redVoidReason.trim()}
              >
                {redVoidSubmitting ? '冲红中...' : '确认冲红'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建开票
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
