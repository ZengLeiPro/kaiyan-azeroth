// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import { visitRecordResponseSchema } from '@ky-azeroth/shared/schemas/visit-record';
import type { IVisitRecordResponse } from '@ky-azeroth/shared/types/visit-record';
import { Plus } from 'lucide-react';
import { useCallback, useMemo } from 'react';
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
import { Button } from '@/components/ui/button';
import { useBusinessApproval } from '@/hooks/use-business-approval';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { canDeleteApprovalBusiness } from '@/lib/approval-permissions';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { getNowDateTimeLocalString } from '@/lib/date-utils';
import { buildAmapMarkerUrl } from '@/lib/geocoding';
import { visitTypeMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import {
  toVisitRecordFormData,
  toVisitRecordPayload,
  toVisitRecordProfile,
  type VisitRecordFormData,
  visitRecordFormSchema,
  type VisitRecordProfile,
} from './types';
import { useVisitRecordGeocoding } from './use-visit-record-geocoding';
import { renderVisitRecordFields } from './visit-record-fields';

const VISIT_RECORD_COLUMN_CONFIG = [
  { key: 'customerName', label: '客户名称', visible: true, canHide: false },
  { key: 'contactName', label: '联系人', visible: true },
  { key: 'visitType', label: '拜访类型', visible: true },
  { key: 'signInTime', label: '签到时间', visible: true },
  { key: 'signAddress', label: '签到地址', visible: true },
  // 业务侧已不再展示「签退时间 / 时长 / 状态」，但保留可见性下拉以便管理员临时勾出
  { key: 'duration', label: '时长(分钟)', visible: false },
  { key: 'visitStatus', label: '状态', visible: false },
  { key: 'flowStatus', label: '审批状态', visible: true },
  { key: 'chargerName', label: '负责人', visible: true },
  { key: 'signOutTime', label: '签退时间', visible: false },
  { key: 'attachments', label: '附件', visible: true },
  { key: 'content', label: '拜访内容', visible: true },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

export function VisitRecordsPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission, hasViewScopeAll, user } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'visit_records', 'create');
  const canEdit = hasMenuPermission('crm', 'visit_records', 'edit');
  const canDelete = hasMenuPermission('crm', 'visit_records', 'delete');
  // 后端 RBAC 已放宽到双路径 OR；Web 默认仍按业绩归属过滤保持销售工作台体验。
  // ADMIN 不注入默认值，看全量。
  const currentEmployeeId = user?.employee?.id ?? user?.id;
  const defaultChargerId = hasViewScopeAll('crm', 'visit_records') ? undefined : currentEmployeeId;

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('crm.visit_records');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);
  const extraParams = useMemo(
    () =>
      defaultChargerId ? { chargerId: defaultChargerId, ...filter.apiParams } : filter.apiParams,
    [filter.apiParams, defaultChargerId]
  );

  const crud = useCrud<VisitRecordProfile, VisitRecordFormData>({
    endpoint: '/visit-records',
    schema: visitRecordFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      customerId: '',
      contactId: null,
      visitType: null,
      content: null,
      signInTime: getNowDateTimeLocalString(),
      signOutTime: null,
      signAddress: null,
      signLocation: null,
      duration: null,
      visitStatus: null,
      attachments: null,
      // 默认负责人 = 当前登录员工，避免提交时还要再选一次
      chargerId: currentEmployeeId ?? null,
    },
    entityToForm: toVisitRecordFormData,
    formToPayload: toVisitRecordPayload,
    customUpdate: async ({ entity, payload, endpoint }) => {
      // 2026-06 改造后所有角色（含 ADMIN）对 approved 单据都走变更审批。
      if (entity.flowStatus === 'approved') {
        await api.post(`${endpoint}/${entity.id}/change-request`, payload);
        return { message: '已提交变更审批' };
      }
      await api.put(`${endpoint}/${entity.id}`, payload);
    },
    transformData: (items) => items.map(toVisitRecordProfile),
    getEntityName: () => '拜访记录',
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
  const { isResolvingAddress, handleLocationDetected } = useVisitRecordGeocoding({
    dialogOpen: crud.dialogOpen,
    entityId: crud.editingEntity?.id ?? null,
    setFormData: crud.setFormData,
  });
  const approval = useBusinessApproval<VisitRecordProfile>({
    eventType: APPROVAL_EVENT_TYPE.VISIT_APPROVE,
    getEntityId: (entity) => entity.id,
    getFlowStatus: (entity) => entity.flowStatus,
    onSuccess: crud.refresh,
    onSubmitApproval: async (entity) => {
      await api.post(`/visit-records/${entity.id}/submit-approval`);
    },
  });
  const columnVisibility = useColumnVisibility(VISIT_RECORD_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航
  useHighlightNavigation<VisitRecordProfile>('/visit-records', crud.openViewDialog, (data) =>
    toVisitRecordProfile(data as IVisitRecordResponse)
  );

  const handleSubmit = useCallback(async () => {
    if (isResolvingAddress) {
      toast.info('定位地址解析中，请稍候');
      return false;
    }
    return crud.handleSubmit();
  }, [crud, isResolvingAddress]);

  /**
   * 表格列：从 schema 派生；customerName / contactName 为 Profile 层的扁平化字段，
   * 通过 `mode:'before'` 作为虚拟列注入。visitType/visitStatus 已 schema 标注 statusBadge，
   * 自动渲染彩色 Badge，无需 overrides。flowStatus 保留（ApprovalStatusBadge 非通用渲染器）。
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<VisitRecordProfile>(visitRecordResponseSchema, {
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
            key: 'duration',
            render: (item) => (item.duration !== null ? `${item.duration}` : '-'),
          },
          {
            key: 'flowStatus',
            render: (item) =>
              item.flowStatus ? <ApprovalStatusBadge status={item.flowStatus} /> : '-',
          },
          {
            key: 'attachments',
            render: (item) =>
              item.attachments && item.attachments.length > 0
                ? `${item.attachments.length} 个`
                : '-',
          },
          {
            key: 'signAddress',
            // 有 signLocation 时渲染为高德地图跳转链接（点击唤起 App / H5 定位到坐标）
            render: (item) => {
              if (!item.signAddress) return '-';
              const url = buildAmapMarkerUrl(item.signLocation, item.customerName);
              if (!url) {
                return <span title={item.signAddress}>{item.signAddress}</span>;
              }
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  title={`高德地图查看：${item.signAddress}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {item.signAddress}
                </a>
              );
            },
          },
          {
            key: 'content',
            render: (item) => {
              const content = item.content || '-';
              return (
                <span className="line-clamp-1" title={content}>
                  {content.length > 50 ? `${content.slice(0, 50)}...` : content}
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
      createStandardActions<VisitRecordProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        canDelete: (item) => canDeleteApprovalBusiness(item.flowStatus),
        hideEdit: !canEdit,
        hideDelete: !canDelete,
        extraActions: canEdit ? approval.extraActions : [],
      }),
    [
      crud.openViewDialog,
      crud.openEditDialog,
      crud.openDeleteDialog,
      canEdit,
      canDelete,
      approval.extraActions,
    ]
  );

  const renderMobileCard = (item: VisitRecordProfile) => (
    <GenericMobileCard
      title={visitTypeMap[item.visitType ?? '']?.label || item.visitType || '拜访记录'}
      fields={[
        { label: '客户名称', value: item.customerName || '-' },
        { label: '签到时间', value: item.signInTime || '-' },
        { label: '签到地址', value: item.signAddress || '-' },
        { label: '负责人', value: item.chargerName || '-' },
        {
          label: '拜访内容',
          value: item.content
            ? item.content.length > 30
              ? `${item.content.slice(0, 30)}...`
              : item.content
            : '-',
        },
      ]}
      onClick={() => crud.openViewDialog(item)}
      testId={`visit-record-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建拜访"
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
            title: '暂无拜访记录',
            description: '点击"新建拜访"添加第一条记录',
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
          title={crud.isEditing ? '拜访详情' : '新建拜访'}
          onSubmit={handleSubmit}
          loading={crud.formDialogProps.loading || isResolvingAddress}
          changeLogTarget={{ module: 'visit-records', target: crud.editingEntity?.id }}
        >
          <>
            <BusinessApprovalSection
              eventType={APPROVAL_EVENT_TYPE.VISIT_APPROVE}
              formId={crud.editingEntity?.id}
              flowStatus={crud.editingEntity?.flowStatus}
              onSuccess={crud.refresh}
              className="col-span-2"
            />
            {renderVisitRecordFields({
              entity: crud.editingEntity,
              formData: crud.formData,
              updateFormField: crud.updateFormField,
              getFieldError: crud.getFieldError,
              onLocationDetected: handleLocationDetected,
              onUploadFile: uploadFile,
            })}
          </>
        </FormDialog>

        <ApprovalDetailDrawer {...approval.drawerProps} />
        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建拜访
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
