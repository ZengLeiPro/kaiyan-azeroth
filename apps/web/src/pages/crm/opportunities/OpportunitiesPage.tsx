// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { opportunityResponseSchema } from '@ky-azeroth/shared/schemas/opportunity';
import type { IOpportunityResponse } from '@ky-azeroth/shared/types/opportunity';
import { getEntityDisplayName } from '@ky-azeroth/shared/utils';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { FormDialog } from '@/components/patterns/form-dialog';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { HeaderRight } from '@/components/patterns/header-right';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { loseReasonMap, opportunityStageMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { openCreateWithCustomerPreset } from '../utils/customer-create-preset';
import { BoardView } from './components/BoardView';
import { type OpportunityView, useOpportunityView } from './components/use-opportunity-view';
import { renderOpportunityFields } from './opportunity-fields';
import {
  type OpportunityFormData,
  opportunityFormSchema,
  type OpportunityProductFormItem,
  type OpportunityProfile,
  toOpportunityFormData,
  toOpportunityPayload,
  toOpportunityProfile,
  toOpportunityUpdatePayload,
} from './types';

const OPPORTUNITY_COLUMN_CONFIG = [
  { key: 'serialNumber', label: '编号', visible: true, canHide: false },
  { key: 'opportunityName', label: '商机名称', visible: true, canHide: false },
  { key: 'customerName', label: '客户', visible: true },
  { key: 'contactName', label: '联系人', visible: true },
  { key: 'opportunityStage', label: '阶段', visible: true },
  { key: 'opportunityAmount', label: '商机金额', visible: true },
  { key: 'winRate', label: '赢单率', visible: true },
  { key: 'chargerName', label: '负责人', visible: true },
  { key: 'expectedDealDate', label: '预计成交日期', visible: true },
  { key: 'realDealDate', label: '实际成交日期', visible: true },
  { key: 'loseReason', label: '失单原因', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'remark', label: '备注', visible: false },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
];

export function OpportunitiesPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { hasMenuPermission, hasViewScopeAll, user } = useAuthStore();
  const canCreate = hasMenuPermission('crm', 'opportunities', 'create');
  const canEdit = hasMenuPermission('crm', 'opportunities', 'edit');
  const canDelete = hasMenuPermission('crm', 'opportunities', 'delete');
  const { view, setView } = useOpportunityView();
  // 移动端不支持看板视图（横向滚动 + 拖拽体验差），强制列表
  const effectiveView = isMobile ? 'list' : view;
  // 后端 RBAC 已放宽到双路径 OR；Web 默认仍按业绩归属过滤保持销售工作台体验。
  // ADMIN 不注入默认值，看全量。
  const currentEmployeeId = user?.employee?.id ?? user?.id;
  const defaultChargerId = hasViewScopeAll('crm', 'opportunities') ? undefined : currentEmployeeId;

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  // customerId 字段走 entityMultiSelect 控件（v1.2），无需手写 CustomerMultiSelect。
  const scheme = useFilterScheme('crm.opportunities');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);
  const extraParams = useMemo(
    () =>
      defaultChargerId ? { chargerId: defaultChargerId, ...filter.apiParams } : filter.apiParams,
    [filter.apiParams, defaultChargerId]
  );

  const crud = useCrud<OpportunityProfile, OpportunityFormData>({
    endpoint: '/opportunities',
    // @ts-expect-error: Schema validates ICreateOpportunity; products.tempId is UI-only field added after validation
    schema: opportunityFormSchema,
    validateMode: 'onSubmit',
    initialFormData: {
      opportunityName: '',
      customerId: '',
      contactId: null,
      opportunityStage: null,
      opportunityAmount: null,
      winRate: null,
      expectedDealDate: null,
      chargerId: currentEmployeeId ?? null,
      loseReason: null,
      loseReasonDetail: null,
      remark: null,
      products: [],
      productsTouched: false,
    },
    entityToForm: toOpportunityFormData,
    formToPayload: toOpportunityPayload,
    formToUpdatePayload: toOpportunityUpdatePayload,
    getEntityName: (opportunity) => getEntityDisplayName('opportunity', opportunity, 'short'),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams,
    },
  });

  const openCreateDialog = useCallback(() => {
    openCreateWithCustomerPreset(filter.activeFilters, crud.openCreateDialog, crud.setFormData);
  }, [crud.openCreateDialog, crud.setFormData, filter.activeFilters]);

  const handleProductsChange = useCallback(
    (products: OpportunityProductFormItem[]) => {
      crud.updateFormField('products', products);
      crud.updateFormField('productsTouched', true);
      if (products.length > 0) {
        const total =
          Math.round(
            products.reduce((sum, product) => sum + Number(product.subtotalAmount ?? 0), 0) * 100
          ) / 100;
        crud.updateFormField('opportunityAmount', total);
      }
    },
    [crud]
  );

  const columnVisibility = useColumnVisibility(OPPORTUNITY_COLUMN_CONFIG, {
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 穿透导航：从 URL 参数中打开指定记录的详情
  useHighlightNavigation<OpportunityProfile>('/opportunities', crud.openViewDialog, (data) =>
    toOpportunityProfile(data as IOpportunityResponse)
  );

  // 获取详情数据（含产品明细）后再打开对话框
  const [, setDetailLoading] = useState(false);

  const fetchDetailAndOpen = useCallback(
    async (item: OpportunityProfile, mode: 'view' | 'edit') => {
      setDetailLoading(true);
      try {
        const res = await api.get(`/opportunities/${item.id}`);
        const fullEntity = toOpportunityProfile(res.data) as OpportunityProfile;
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
    (item: OpportunityProfile) => {
      fetchDetailAndOpen(item, 'view');
    },
    [fetchDetailAndOpen]
  );

  /**
   * 表格列：大部分从 `opportunityResponseSchema` 派生；
   * 保留 overrides：
   * - opportunityName: 加粗
   * - customerName / contactName: 虚拟列（非 schema 字段），客户/联系人穿透按钮
   * - loseReason: StatusBadge 上色 + detail tooltip 拼接
   * - remark: 保留换行 + title tooltip
   * opportunityStage 已标 statusBadge，走自动渲染（无 override）
   */
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<OpportunityProfile>(opportunityResponseSchema, {
        overrides: [
          {
            key: 'opportunityName',
            render: (item) => <span className="font-medium">{item.opportunityName}</span>,
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
            key: 'contactName',
            render: (item) =>
              item.contactId && item.contact?.contactName ? (
                <button
                  className="cursor-pointer text-left text-primary hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/crm/contacts?highlight=${item.contactId}`);
                  }}
                >
                  {item.contact.contactName}
                </button>
              ) : (
                '-'
              ),
          },
          {
            key: 'loseReason',
            render: (item) => {
              if (!item.loseReason) return '-';
              // loseReason='其他' 时用 detail 作 tooltip 补充信息量
              const tooltip =
                item.loseReason === '其他' && item.loseReasonDetail
                  ? `其他：${item.loseReasonDetail}`
                  : item.loseReason;
              return (
                <span title={tooltip}>
                  <StatusBadge status={item.loseReason} statusMap={loseReasonMap} />
                </span>
              );
            },
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

  const rowActions = useMemo(
    () =>
      createStandardActions<OpportunityProfile>({
        onView: (item) => {
          void fetchDetailAndOpen(item, 'view');
        },
        onEdit: (item) => {
          void fetchDetailAndOpen(item, 'edit');
        },
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit,
        hideDelete: !canDelete,
      }),
    [fetchDetailAndOpen, crud.openDeleteDialog, canEdit, canDelete]
  );

  const renderMobileCard = (item: OpportunityProfile) => (
    <GenericMobileCard
      title={item.opportunityName}
      status={
        item.opportunityStage ? (
          <StatusBadge status={item.opportunityStage} statusMap={opportunityStageMap} />
        ) : undefined
      }
      fields={[
        { label: '编号', value: item.serialNumber },
        { label: '客户', value: item.customer?.customerName || '-' },
        {
          label: '商机金额',
          value: item.opportunityAmount != null ? Number(item.opportunityAmount).toFixed(2) : '-',
        },
        {
          label: '赢单率',
          value: item.winRate != null ? `${Number(item.winRate)}%` : '-',
        },
        { label: '负责人', value: item.chargerName || '-' },
      ]}
      onClick={() => handleRowClick(item)}
      testId={`opportunity-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      {!isMobile && (
        <HeaderRight>
          <SegmentedToggle<OpportunityView>
            value={effectiveView}
            onChange={setView}
            options={[
              { value: 'list', label: '列表', icon: List },
              { value: 'board', label: '看板', icon: LayoutGrid },
            ]}
            ariaLabel="视图切换"
          />
        </HeaderRight>
      )}
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? openCreateDialog : undefined}
            createLabel="新建商机"
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
              effectiveView === 'list' ? (
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
              ) : undefined
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
                  fields={
                    // 看板视图按 stage 分列，stage 筛选无意义，隐藏（兼容 flat bracket key）
                    effectiveView === 'board'
                      ? scheme.fields.filter((f) => {
                          // dateRange 字段没有 key（用 fromKey/toKey），不会是 stage 字段，直接保留
                          if (!('key' in f)) return true;
                          const key = f.key;
                          return (
                            key !== 'opportunityStage' &&
                            key !== 'filters[opportunityStage]' &&
                            key !== 'filters[opportunityStage][]'
                          );
                        })
                      : scheme.fields
                  }
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
        pagination={effectiveView === 'list' ? crud.pagination : undefined}
      >
        {effectiveView === 'board' ? (
          <BoardView
            apiParams={extraParams}
            canEdit={canEdit}
            onCardClick={(item) => fetchDetailAndOpen(item, 'view')}
          />
        ) : (
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
              title: '暂无商机数据',
              description: '点击"新建商机"添加第一条记录',
            }}
          />
        )}

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? '商机详情' : '新建商机'}
          onSubmit={crud.handleSubmit}
          changeLogTarget={{ module: 'opportunities', target: crud.editingEntity?.id }}
        >
          {renderOpportunityFields({
            entity: crud.editingEntity,
            formData: crud.formData,
            updateFormField: crud.updateFormField,
            getFieldError: crud.getFieldError,
            onProductsChange: handleProductsChange,
          })}
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
      </StandardLayout>
      {isMobile && canCreate && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            新建商机
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
