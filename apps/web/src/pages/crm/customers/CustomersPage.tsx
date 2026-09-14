// 触发内置渲染器/导出格式化器注册（副作用 import）
import '@/lib/column-renderers';
import '@/lib/column-export-formatters';

import { customerResponseSchema } from '@ky-azeroth/shared/schemas/customer';
import type { ICustomerDuplicateMatch } from '@ky-azeroth/shared/types/customer';
import {
  CalendarClock,
  Globe2,
  LayoutGrid,
  List,
  Plus,
  Search,
  Target,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { createStandardActions } from '@/components/patterns/row-actions-helpers';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import type { DataTableColumn } from '@/components/ui/data-table';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHighlightNavigation } from '@/hooks/use-highlight-navigation';
import { useImportExport } from '@/hooks/use-import-export';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, buildEntityVersionMap, getErrorMessage } from '@/lib/api';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { deriveExcelColumnsFromSchema } from '@/lib/excel-from-schema';
import { contactStatusMap, customerLevelMap, dealStatusMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import { CustomerBulkCollaboratorsModal } from './components/CustomerBulkCollaboratorsModal';
import { CustomerBulkEditModal } from './components/CustomerBulkEditModal';
import { CustomerBulkTransferModal } from './components/CustomerBulkTransferModal';
import { CustomerDrawerBody } from './components/CustomerDrawerBody';
import {
  CustomerDuplicateCheckDialog,
  type CustomerDuplicateCreatePrefill,
} from './components/CustomerDuplicateCheckDialog';
import { CustomerDuplicateWarningDialog } from './components/CustomerDuplicateWarningDialog';
import { LeadsBoard } from './components/LeadsBoard';
import { renderCustomerFields } from './customer-fields';
import { isCustomerFollowUpOverdue } from './customer-follow-up';
import {
  type CustomerFormData,
  customerFormSchema,
  type CustomerProfile,
  toCustomerFormData,
  toCustomerPayload,
  toCustomerUpdatePayload,
} from './types';

// fields 渲染函数 + 表单选项已抽出至 ./customer-fields；本页只保留列表/卡片需要的副本。

/**
 * 列可见性配置。
 *
 * 保留手写数组是为了：
 * - 控制列顺序（与 schema 字段顺序略有差异）
 * - 维持用户友好的菜单 label（如 schema 字段 `province`，此处显示为"地区"）
 *
 * 列宽、header 文案、render 逻辑全部由 `customerResponseSchema` 的 withColumn meta 派生，
 * 无需在此重复维护。Excel 导出同理通过 `deriveExcelColumnsFromSchema` 派生。
 */
const CUSTOMER_COLUMN_CONFIG = [
  { key: 'serialNumber', label: '编号', visible: true, canHide: false },
  { key: 'customerName', label: '客户名称', visible: true, canHide: false },
  { key: 'industry', label: '行业', visible: true },
  { key: 'customerLevel', label: '客户等级', visible: true },
  { key: 'customerSource', label: '客户来源', visible: false },
  { key: 'contactStatus', label: '跟进状态', visible: true },
  { key: 'dealStatus', label: '成交状态', visible: true },
  { key: 'intentTemperature', label: '意向温度', visible: true },
  { key: 'nextFollowUpAt', label: '下次回访日期', visible: true },
  { key: 'leadValidity', label: '线索有效性', visible: true },
  { key: 'leadStage', label: '线索阶段', visible: true },
  { key: 'leadStageUpdatedAt', label: '线索阶段更新时间', visible: false },
  { key: 'leadStageQualifiedByName', label: '合格判定人', visible: false },
  { key: 'firstMqlAt', label: '首次MQL时间', visible: true },
  { key: 'firstSqlAt', label: '首次SQL时间', visible: true },
  { key: 'leadProgressStatus', label: '推进状态', visible: true },
  { key: 'leadAppointmentAt', label: '预约拜访时间', visible: true },
  { key: 'leadProgressReason', label: '推进原因', visible: false },
  { key: 'leadProgressUpdatedAt', label: '推进状态更新时间', visible: false },
  { key: 'lastKeepRecordTime', label: '最近跟进', visible: true },
  { key: 'lastKeepRecordContent', label: '最后跟进内容', visible: false },
  { key: 'province', label: '地区', visible: true },
  { key: 'city', label: '城市', visible: true },
  { key: 'chargerName', label: '负责人', visible: true },
  { key: 'collaboratorName', label: '协作人', visible: false },
  { key: 'accountsReceivable', label: '应收账款', visible: false },
  { key: 'address', label: '详细地址', visible: false },
  { key: 'district', label: '区县', visible: false },
  { key: 'country', label: '国家', visible: false },
  { key: 'customerRelationship', label: '客户关系', visible: false },
  { key: 'customerTags', label: '客户标签', visible: false },
  { key: 'organizationId', label: '组织ID', visible: false },
  { key: 'uncId', label: '统一信用代码', visible: false },
  { key: 'headcountRange', label: '员工数范围', visible: false },
  { key: 'remark', label: '备注', visible: false },
  { key: 'createdAt', label: '创建时间', visible: false },
  { key: 'updatedAt', label: '最近修改', visible: false },
  { key: 'status', label: '状态', visible: true },
];

const CUSTOMER_SCHEMA_EXCLUDED_COLUMNS = ['shortName'];

type CustomerPool = 'private' | 'public' | 'leads';
type CustomerView = 'list' | 'board';

const CUSTOMER_POOL_PARAM = 'pool';
const NEXT_FOLLOW_UP_FROM_KEY = 'filters[nextFollowUpAt][from]';
const NEXT_FOLLOW_UP_TO_KEY = 'filters[nextFollowUpAt][to]';

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function useCustomerPool(): {
  pool: CustomerPool;
  setPool: (next: CustomerPool) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPool = searchParams.get(CUSTOMER_POOL_PARAM);
  const pool: CustomerPool =
    rawPool === 'public' ? 'public' : rawPool === 'leads' ? 'leads' : 'private';

  const setPool = (next: CustomerPool) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'private') {
      nextParams.delete(CUSTOMER_POOL_PARAM);
    } else {
      nextParams.set(CUSTOMER_POOL_PARAM, next);
    }
    setSearchParams(nextParams, { replace: true });
  };

  return { pool, setPool };
}

function useCustomerView(): {
  view: CustomerView;
  setView: (next: CustomerView) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const view: CustomerView = searchParams.get('view') === 'list' ? 'list' : 'board';
  const setView = (next: CustomerView) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'board') nextParams.delete('view');
    else nextParams.set('view', next);
    setSearchParams(nextParams, { replace: true });
  };
  return { view, setView };
}

function omitChargerFilterParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === 'chargerId' || key === 'filters[chargerId]' || key === 'filters[chargerId][]') {
      continue;
    }
    result[key] = value;
  }
  return result;
}

export function CustomersPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission, user } = useAuthStore();
  const canEdit = hasMenuPermission('crm', 'customers', 'edit');
  const canDelete = hasMenuPermission('crm', 'customers', 'delete');
  const canCreate = hasMenuPermission('crm', 'customers', 'create');
  const canClaim = canEdit && Boolean(user?.employee?.id ?? user?.id);
  const { pool, setPool } = useCustomerPool();
  const { view, setView } = useCustomerView();
  const effectiveView: CustomerView = pool === 'leads' && !isMobile ? view : 'list';
  const [claimingCustomerId, setClaimingCustomerId] = useState<string | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  // 批量操作 modal 开关
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkAddCollabOpen, setBulkAddCollabOpen] = useState(false);
  const [bulkRemoveCollabOpen, setBulkRemoveCollabOpen] = useState(false);

  // 查重 409 命中时的预警卡片状态
  // resolver 用于 useCrud onConflict 回调与 dialog 用户决策之间通信
  // forceable: 软重复（可强制新建）= true；硬阻断（精准重复，不可强制）= false
  const [duplicateWarnState, setDuplicateWarnState] = useState<{
    duplicates: ICustomerDuplicateMatch[];
    forceable: boolean;
    resolver: (decision: { retry: boolean; payloadOverride?: Record<string, unknown> }) => void;
  } | null>(null);

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme('crm.customers');

  // state 使用 flat bracket-key 风格（由 useFilterScheme 保证），
  // 这样 useManualFilter 产出的 apiParams 就是 axios 默认可序列化为
  // `filters[customerLevel][]=A&filters[createdAt][from]=...` 的形状。
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);
  const showTodayFollowUps = useCallback(() => {
    const today = formatLocalDate(new Date());
    filter.applyFilters({
      [NEXT_FOLLOW_UP_FROM_KEY]: today,
      [NEXT_FOLLOW_UP_TO_KEY]: today,
    });
  }, [filter]);
  const extraParams = useMemo(
    () => ({
      ...(pool === 'public' ? omitChargerFilterParams(filter.apiParams) : filter.apiParams),
      pool,
    }),
    [filter.apiParams, pool]
  );

  const visibleFilterFields = useMemo(
    () =>
      pool === 'public'
        ? scheme.fields.filter((field) => {
            if (!('key' in field)) return true;
            const key = field.key;
            return (
              key !== 'chargerId' && key !== 'filters[chargerId]' && key !== 'filters[chargerId][]'
            );
          })
        : scheme.fields,
    [pool, scheme.fields]
  );

  const crud = useCrud<CustomerProfile, CustomerFormData>({
    endpoint: '/customers',
    schema: customerFormSchema,
    validateMode: 'onSubmit',
    requireVersion: true,
    initialFormData: {
      customerName: '',
      industry: null,
      customerLevel: null,
      customerSource: null,
      customerRelationship: null,
      customerTags: null,
      country: '中国',
      province: '福建省',
      city: '泉州市',
      district: null,
      address: null,
      remark: null,
      organizationId: null,
      uncId: null,
      headcountRange: null,
      // 默认负责人 = 当前登录账号绑定的员工（销售自录场景）；未绑定 employee 的账号回退为 null
      chargerId: user?.employee?.id ?? null,
      collaboratorName: null,
      collaboratorIds: null,
      contactStatus: null,
      dealStatus: null,
    },
    entityToForm: toCustomerFormData,
    formToPayload: toCustomerPayload,
    formToUpdatePayload: toCustomerUpdatePayload,
    getEntityName: (customer) => customer.customerName,
    disableEdit: !canEdit || pool === 'public',
    disableDelete: !canDelete || pool === 'public',
    // 查重 409 拦截：
    // - DUPLICATE_CUSTOMER（软，forceable=true）：弹卡让销售决定是建新还是放弃。
    // - DUPLICATE_CUSTOMER_BLOCKED（硬，forceable=false）：弹卡仅提示，无法强制创建。
    // 其它 code 返回 null 走默认乐观锁处理。
    onConflict: async (errorData) => {
      if (
        errorData.code !== 'DUPLICATE_CUSTOMER' &&
        errorData.code !== 'DUPLICATE_CUSTOMER_BLOCKED'
      ) {
        return null;
      }
      const duplicates = (errorData.duplicates as ICustomerDuplicateMatch[]) ?? [];
      const forceable = errorData.forceable === true;
      return new Promise((resolve) => {
        setDuplicateWarnState({
          duplicates,
          forceable,
          resolver: (decision) => {
            setDuplicateWarnState(null);
            resolve(decision);
          },
        });
      });
    },
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams,
      sortingStorageId: pool,
    },
  });

  const { clearSelection } = crud;
  useEffect(() => {
    clearSelection();
  }, [clearSelection, pool]);

  const selectedCustomerVersions = useMemo(
    () => buildEntityVersionMap(crud.data.filter((customer) => crud.selectedKeys.has(customer.id))),
    [crud.data, crud.selectedKeys]
  );

  // 穿透导航：从 URL 参数中打开指定记录的详情
  useHighlightNavigation<CustomerProfile>('/customers', crud.openViewDialog);

  const columnVisibility = useColumnVisibility(CUSTOMER_COLUMN_CONFIG, {
    storageId: pool,
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  const getExportData = useCallback(() => crud.data, [crud.data]);

  /**
   * Excel 导出列：从 schema 派生，列头/单位/格式化器全由 ColumnMeta 自动生成。
   * 保留 overrides 用于少数需要区分"表格 header"和"导出 header"的场景
   * （如 province 表格显示"地区"拼接，但导出保持"省份"独立列）。
   */
  const exportColumns = useMemo(
    () =>
      deriveExcelColumnsFromSchema<CustomerProfile>(customerResponseSchema, {
        exclude: CUSTOMER_SCHEMA_EXCLUDED_COLUMNS,
        overrides: [{ key: 'lastKeepRecordTime', header: '最近跟进时间' }],
      }),
    []
  );

  const { handleExport, exporting } = useImportExport<Record<string, unknown>, CustomerProfile>({
    entityName: '客户',
    importColumns: [],
    exportColumns,
    getExportData,
    exportSheetName: '客户列表',
  });

  /**
   * 表格列：绝大部分从 `customerResponseSchema` 派生（header/width/sortable/align/内置渲染器）。
   * 仅保留业务化渲染作为 overrides：
   * - customerName: 加粗文字
   * - province: 覆盖 header 为"地区"并拼接 province+city
   * - lastKeepRecordContent / remark: muted 文字 + 20 字截断 + title tooltip
   */
  const baseColumns = useMemo(
    () =>
      deriveColumnsFromSchema<CustomerProfile>(customerResponseSchema, {
        exclude: CUSTOMER_SCHEMA_EXCLUDED_COLUMNS,
        overrides: [
          {
            key: 'customerName',
            render: (item) => <span className="font-medium">{item.customerName}</span>,
          },
          {
            key: 'province',
            header: '地区',
            render: (item) => {
              const parts = [item.province, item.city].filter(Boolean);
              return parts.length > 0 ? parts.join(' ') : '-';
            },
          },
          {
            key: 'lastKeepRecordContent',
            render: (item) => {
              const content = item.lastKeepRecordContent;
              if (!content) return '-';
              return (
                <span className="text-muted-foreground" title={content}>
                  {content.length > 20 ? `${content.slice(0, 20)}...` : content}
                </span>
              );
            },
          },
          {
            key: 'remark',
            render: (item) => {
              const content = item.remark;
              if (!content) return '-';
              return (
                <span
                  className="whitespace-pre-wrap break-words text-muted-foreground"
                  title={content}
                >
                  {content}
                </span>
              );
            },
          },
        ],
      }),
    []
  );

  const handleClaim = useCallback(
    async (customer: CustomerProfile, options?: { closeDialog?: boolean }) => {
      if (!canClaim) return;
      const version = customer.version;
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
        toast.error('客户版本信息缺失，请刷新列表后重试');
        crud.refresh();
        return;
      }
      setClaimingCustomerId(customer.id);
      try {
        await api.post(`/customers/${customer.id}/claim`, { version });
        toast.success(`已认领客户：${customer.customerName}`);
        crud.refresh();
        if (options?.closeDialog) {
          crud.closeDialog();
        }
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setClaimingCustomerId(null);
      }
    },
    [canClaim, crud]
  );

  const claimColumn = useMemo<DataTableColumn<CustomerProfile>>(
    () => ({
      key: '_claim',
      header: '认领',
      width: '92px',
      minWidth: '92px',
      maxWidth: '92px',
      align: 'center',
      ellipsis: false,
      render: (item) =>
        item.chargerId ? (
          <span className="text-muted-foreground">已归属</span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            disabled={!canClaim || claimingCustomerId === item.id}
            onClick={(event) => {
              event.stopPropagation();
              void handleClaim(item);
            }}
          >
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            认领
          </Button>
        ),
    }),
    [canClaim, claimingCustomerId, handleClaim]
  );

  const columns = useMemo(
    () => (pool === 'public' || pool === 'leads' ? [...baseColumns, claimColumn] : baseColumns),
    [baseColumns, claimColumn, pool]
  );

  const handleCreateFromDuplicateCheck = useCallback(
    (prefill: CustomerDuplicateCreatePrefill) => {
      setDuplicateDialogOpen(false);
      crud.openCreateDialog();
      crud.setFormData((prev) => ({
        ...prev,
        customerName: prefill.customerName || prev.customerName,
        uncId: prefill.uncId || prev.uncId,
        organizationId: prefill.organizationId || prev.organizationId,
      }));
    },
    [crud]
  );

  const rowActions = useMemo(
    () =>
      createStandardActions<CustomerProfile>({
        onView: crud.openViewDialog,
        onEdit: crud.openEditDialog,
        onDelete: crud.openDeleteDialog,
        hideEdit: !canEdit || pool === 'public',
        hideDelete: !canDelete || pool === 'public',
      }),
    [crud.openViewDialog, crud.openEditDialog, crud.openDeleteDialog, canEdit, canDelete, pool]
  );

  const renderMobileCard = (item: CustomerProfile) => (
    <GenericMobileCard
      title={item.customerName}
      status={
        item.customerLevel ? (
          <StatusBadge status={item.customerLevel} statusMap={customerLevelMap} />
        ) : undefined
      }
      fields={[
        { label: '编号', value: item.serialNumber },
        {
          label: '跟进状态',
          value: item.contactStatus ? (
            <StatusBadge status={item.contactStatus} statusMap={contactStatusMap} />
          ) : (
            '-'
          ),
        },
        {
          label: '成交状态',
          value: item.dealStatus ? (
            <StatusBadge status={item.dealStatus} statusMap={dealStatusMap} />
          ) : (
            '-'
          ),
        },
        { label: '负责人', value: item.chargerName || '-' },
      ]}
      footer={
        (pool === 'public' || pool === 'leads') && !item.chargerId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            disabled={!canClaim || claimingCustomerId === item.id}
            onClick={(event) => {
              event.stopPropagation();
              void handleClaim(item);
            }}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            认领
          </Button>
        ) : undefined
      }
      onClick={() => crud.openViewDialog(item)}
      testId={`customer-${item.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <HeaderRight>
        <div className="flex items-center gap-2">
          <SegmentedToggle<CustomerPool>
            value={pool}
            onChange={setPool}
            options={[
              { value: 'private', label: '私海', icon: UserRound },
              { value: 'public', label: '公海', icon: Globe2 },
              { value: 'leads', label: 'Leads', icon: Target },
            ]}
            ariaLabel="客户池切换"
          />
          {pool === 'leads' && !isMobile && (
            <SegmentedToggle<CustomerView>
              value={effectiveView}
              onChange={setView}
              options={[
                { value: 'list', label: '列表', icon: List },
                { value: 'board', label: '看板', icon: LayoutGrid },
              ]}
              ariaLabel="Leads 视图切换"
            />
          )}
        </div>
      </HeaderRight>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建客户"
            onExport={handleExport}
            exportLoading={exporting}
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={showTodayFollowUps}
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  今日应回访
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setDuplicateDialogOpen(true)}
                >
                  <Search className="mr-2 h-4 w-4" />
                  查重
                </Button>
                {effectiveView === 'list' && (
                  <ColumnVisibilityDropdown
                    columns={columnVisibility.columns}
                    onToggle={columnVisibility.toggleColumn}
                    onShowAll={columnVisibility.showAll}
                    onResetVisibility={columnVisibility.resetToDefault}
                    onReorder={columnVisibility.reorderColumns}
                    storageId={pool}
                    currentSortBy={crud.sorting.sortBy}
                    currentSortOrder={crud.sorting.sortOrder}
                    onServerSortingVersionApplied={crud.sorting.markServerSortingVersionApplied}
                  />
                )}
              </>
            }
            bulkSelection={
              pool !== 'public' && effectiveView === 'list'
                ? {
                    selectedCount: crud.selectedKeys.size,
                    onClearSelection: crud.clearSelection,
                    onBulkEdit: canEdit ? () => setBulkEditOpen(true) : undefined,
                    onBulkDelete: canDelete ? crud.openBulkDeleteDialog : undefined,
                    actions: canEdit ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setBulkTransferOpen(true)}
                          className="border-primary/20 bg-background hover:bg-primary/10"
                        >
                          <UserRound className="mr-2 h-4 w-4" />
                          转交
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setBulkAddCollabOpen(true)}
                          className="border-primary/20 bg-background hover:bg-primary/10"
                        >
                          <Users className="mr-2 h-4 w-4" />
                          加协作人
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setBulkRemoveCollabOpen(true)}
                          className="border-primary/20 bg-background hover:bg-primary/10"
                        >
                          <UserMinus className="mr-2 h-4 w-4" />
                          移协作人
                        </Button>
                      </>
                    ) : undefined,
                  }
                : undefined
            }
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={4} />
              ) : (
                <CrudFilterBar
                  fields={visibleFilterFields}
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
          <LeadsBoard
            apiParams={extraParams}
            canEdit={canEdit}
            onCardClick={crud.openViewDialog}
            onChanged={crud.refresh}
          />
        ) : (
          <CrudTable
            {...crud.tableProps}
            data={crud.data}
            columns={columns}
            loading={crud.loading}
            sorting={crud.sorting}
            onRowClick={crud.openViewDialog}
            renderMobileCard={renderMobileCard}
            rowSelection={pool !== 'public' ? crud.rowSelectionProps : undefined}
            columnVisibility={{
              columns: columnVisibility.columns,
              onToggle: columnVisibility.toggleColumn,
              onShowAll: columnVisibility.showAll,
            }}
            hidePagination
            rowClassName={(item) =>
              isCustomerFollowUpOverdue(item) ? 'bg-destructive/10' : undefined
            }
            emptyState={{
              title:
                pool === 'public'
                  ? '暂无公海客户'
                  : pool === 'leads'
                    ? '暂无 Leads'
                    : '暂无客户数据',
              description:
                pool === 'public'
                  ? '无人归属的客户会进入公海'
                  : pool === 'leads'
                    ? '已被打上 MQL/SQL 标签的客户会进入这里'
                    : '点击"新建客户"添加第一条记录',
            }}
            actions={rowActions}
          />
        )}

        <FormDialog
          {...crud.formDialogProps}
          variant="drawer"
          title={crud.isEditing ? crud.editingEntity?.customerName || '客户详情' : '新建客户'}
          onSubmit={crud.handleSubmit}
          // 客户详情把"更改记录"放到 CustomerDrawerBody 的「基本信息」tab 内，
          // 而不是外层 FormDialog 底部——避免在联系人/商机/订单等 tab 里也显示。
          viewHeaderActions={
            (pool === 'public' || pool === 'leads') &&
            crud.isViewMode &&
            crud.editingEntity &&
            !crud.editingEntity.chargerId ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canClaim || claimingCustomerId === crud.editingEntity.id}
                onClick={() => {
                  if (crud.editingEntity) {
                    void handleClaim(crud.editingEntity, { closeDialog: true });
                  }
                }}
              >
                <UserPlus className="mr-1 h-3.5 w-3.5" />
                认领
              </Button>
            ) : undefined
          }
        >
          {(() => {
            const customerFields = renderCustomerFields({
              entity: crud.editingEntity,
              formData: crud.formData,
              updateFormField: crud.updateFormField,
              getFieldError: crud.getFieldError,
              onLeadStageChanged: () => crud.refresh(),
            });
            return crud.isViewMode && crud.editingEntity ? (
              <CustomerDrawerBody
                customerId={crud.editingEntity.id}
                customerName={crud.editingEntity.customerName}
                aiInfoSummary={crud.editingEntity.aiInfoSummary}
                aiInfoGeneratedAt={crud.editingEntity.aiInfoGeneratedAt}
                fieldsContent={customerFields}
                changeLogTarget={{ module: 'customers', target: crud.editingEntity.id }}
              />
            ) : (
              customerFields
            );
          })()}
        </FormDialog>

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />
        <CustomerBulkTransferModal
          open={bulkTransferOpen}
          onOpenChange={setBulkTransferOpen}
          customerIds={Array.from(crud.selectedKeys)}
          versions={selectedCustomerVersions}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <CustomerBulkEditModal
          open={bulkEditOpen}
          onOpenChange={setBulkEditOpen}
          customerIds={Array.from(crud.selectedKeys)}
          versions={selectedCustomerVersions}
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <CustomerBulkCollaboratorsModal
          open={bulkAddCollabOpen}
          onOpenChange={setBulkAddCollabOpen}
          customerIds={Array.from(crud.selectedKeys)}
          versions={selectedCustomerVersions}
          mode="add"
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <CustomerBulkCollaboratorsModal
          open={bulkRemoveCollabOpen}
          onOpenChange={setBulkRemoveCollabOpen}
          customerIds={Array.from(crud.selectedKeys)}
          versions={selectedCustomerVersions}
          mode="remove"
          onSuccess={() => {
            crud.clearSelection();
            crud.refresh();
          }}
        />
        <CustomerDuplicateCheckDialog
          open={duplicateDialogOpen}
          onOpenChange={setDuplicateDialogOpen}
          onCreateCustomer={handleCreateFromDuplicateCheck}
        />
        <CustomerDuplicateWarningDialog
          open={!!duplicateWarnState}
          duplicates={duplicateWarnState?.duplicates ?? []}
          forceable={duplicateWarnState?.forceable ?? false}
          onCancel={() => duplicateWarnState?.resolver({ retry: false })}
          onConfirmCreate={(reason) =>
            duplicateWarnState?.resolver({
              retry: true,
              payloadOverride: { forceCreate: true, forceCreateReason: reason },
            })
          }
        />
      </StandardLayout>
      {isMobile && (
        <MobileBottomBar>
          <Button variant="outline" className="flex-1" onClick={() => setDuplicateDialogOpen(true)}>
            <Search className="mr-2 h-4 w-4" />
            查重
          </Button>
          {canCreate && (
            <Button className="flex-1" onClick={crud.openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              新建客户
            </Button>
          )}
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}
