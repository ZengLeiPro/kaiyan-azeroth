/**
 * 销售数据待办 · 独立列表页（除工作台两卡外）。
 *
 * - 「我的」视图：GET /sales-action-items/my，销售处置自己的待办。
 * - 「全员」视图（ADMIN / 林审批 CRM_MANAGER）：GET /sales-action-items，
 *   按标准 CRM 筛选方案筛，看全员 + 采纳率。
 * - 二次操作（行内菜单）：详情 / 采纳（FILL_CONFIRM+keep_record，pending）/ 忽略（pending）/
 *   标记已办（pending）/ 改回待办（done）/ 撤销采纳（adopted, undo）。
 * - priority 列右对齐、DESC 排序（高=优先）。
 *
 * 复用 CRM 标准列表组合 + components/patterns/sales-action 的 hooks / SalesActionDrawer / IgnoreDialog。
 */
// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { SALES_ACTION_ITEM_STATUS } from '@ky-azeroth/shared/constants/status-values';
import { salesActionItemResponseSchema } from '@ky-azeroth/shared/schemas/sales-action-item';
import type {
  IDoneSalesActionItemKeepRecord,
  ISalesActionItemResponse,
} from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import {
  CheckCircle2,
  ClipboardCheck,
  Eye,
  RotateCcw,
  Send,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar, type FilterFieldConfig } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { HeaderRight } from '@/components/patterns/header-right';
import type { RowAction } from '@/components/patterns/row-actions-menu';
import {
  ADOPTABLE_CATEGORY,
  DONE_TYPE_OPTIONS,
  IgnoreDialog,
  isAdoptableActionItem,
  SalesActionDrawer,
  type SalesActionItemsQuery,
  TransferDialog,
  useAdminActionItems,
  useAdoptActionItem,
  useDoneActionItem,
  useIgnoreActionItem,
  useMyActionItems,
  useReopenActionItem,
  useTransferActionItem,
  useUndoActionItem,
} from '@/components/patterns/sales-action';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StatusBadge } from '@/components/patterns/status-badge';
import { StandardLayout } from '@/components/templates/standard-layout';
import type { DataTableColumn } from '@/components/ui/data-table';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { type ColumnConfig, useColumnVisibility } from '@/hooks/use-column-visibility';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useHasPermission } from '@/hooks/use-has-permission';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import {
  loadPersistedSorting,
  SORTING_STORAGE_VERSION,
  writePersistedSorting,
} from '@/hooks/use-server-pagination';
import { getErrorMessage } from '@/lib/api';
import { deriveColumnsFromSchema, deriveColumnVisibilityConfig } from '@/lib/columns-from-schema';
import {
  salesActionItemCategoryMap,
  salesActionItemConfidenceMap,
  salesActionItemDoneTypeMap,
  salesActionItemStatusMap,
} from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

const DEFAULT_PAGE_SIZE = 100;
const SALES_ACTION_ITEMS_PAGE_KEY = 'crm.sales_action_items';
const ALL_ONLY_FILTER_FIELD_KEYS = new Set(['employeeId', 'sourceRunId']);
const QUICK_FILTER_FIELD_KEYS = new Set(['status']);
const RESOLVED_STATUS_VALUES = [
  SALES_ACTION_ITEM_STATUS.ADOPTED,
  SALES_ACTION_ITEM_STATUS.DONE,
  SALES_ACTION_ITEM_STATUS.IGNORED,
  SALES_ACTION_ITEM_STATUS.SNOOZED,
  SALES_ACTION_ITEM_STATUS.TRANSFERRED,
  SALES_ACTION_ITEM_STATUS.AUTO_EXPIRED,
] as const;

const BASE_COLUMN_CONFIG = deriveColumnVisibilityConfig(salesActionItemResponseSchema);
const EMPLOYEE_NAME_COLUMN_CONFIG: ColumnConfig = {
  key: 'employeeName',
  label: '收件销售',
  visible: true,
};

const EMPLOYEE_NAME_COLUMN: DataTableColumn<ISalesActionItemResponse> = {
  key: 'employeeName',
  header: '收件销售',
  width: 110,
  render: (item) => item.employee?.name ?? '-',
};

type ViewMode = 'mine' | 'all';
type ResolutionFilterMode = 'all' | 'done' | 'pending';

function getInitialViewMode(): ViewMode {
  const user = useAuthStore.getState().user;
  if (!user) return 'mine';
  return user.roles.some((role) =>
    role.permissions?.some(
      (permission) =>
        permission.module === 'crm' &&
        permission.menu === 'sales_action_items' &&
        permission.view === true &&
        permission.viewScope === 'ALL'
    )
  )
    ? 'all'
    : 'mine';
}
type SalesActionFilterField = FilterFieldConfig<Record<string, FilterValue>>;

function safeFormat(iso: string | undefined | null, pattern: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, pattern);
}

function insertAfter<T extends { key: string }>(items: T[], targetKey: string, item: T): T[] {
  if (items.some((existing) => existing.key === item.key)) return items;
  const index = items.findIndex((existing) => existing.key === targetKey);
  if (index < 0) return [...items, item];
  return [...items.slice(0, index + 1), item, ...items.slice(index + 1)];
}

function getFilterStateKeys(field: SalesActionFilterField): string[] {
  if ('key' in field) return [String(field.key)];
  return [String(field.fromKey), String(field.toKey)];
}

function fieldUsesFilterKey(field: SalesActionFilterField, fieldKey: string): boolean {
  return getFilterStateKeys(field).some(
    (key) =>
      key === `filters[${fieldKey}]` ||
      key === `filters[${fieldKey}][]` ||
      key.startsWith(`filters[${fieldKey}][`)
  );
}

function isAllOnlyFilterField(field: SalesActionFilterField): boolean {
  for (const fieldKey of ALL_ONLY_FILTER_FIELD_KEYS) {
    if (fieldUsesFilterKey(field, fieldKey)) return true;
  }
  return false;
}

function isQuickFilterField(field: SalesActionFilterField): boolean {
  for (const fieldKey of QUICK_FILTER_FIELD_KEYS) {
    if (fieldUsesFilterKey(field, fieldKey)) return true;
  }
  return false;
}

function getResolutionStatusParam(mode: ResolutionFilterMode): string[] | undefined {
  if (mode === 'pending') return [SALES_ACTION_ITEM_STATUS.PENDING];
  if (mode === 'done') return [...RESOLVED_STATUS_VALUES];
  return undefined;
}

function isResolvedStatus(status: string): boolean {
  return (RESOLVED_STATUS_VALUES as readonly string[]).includes(status);
}

function isHandledStatus(status: string): boolean {
  return ['adopted', 'done', 'ignored', 'transferred'].includes(status);
}

function isTransferableStatus(status: string): boolean {
  return status === SALES_ACTION_ITEM_STATUS.PENDING || status === SALES_ACTION_ITEM_STATUS.SNOOZED;
}

function getResolveNoteDisplay(item: ISalesActionItemResponse): string {
  if (item.resolveNote) return item.resolveNote;
  if (item.status === SALES_ACTION_ITEM_STATUS.ADOPTED) return '已采纳并生成跟进记录';
  if (item.status === SALES_ACTION_ITEM_STATUS.AUTO_EXPIRED) return '缺口已被后续动作自动回收';
  return '-';
}

function getDoneTypeDisplay(item: ISalesActionItemResponse): string {
  if (item.status !== SALES_ACTION_ITEM_STATUS.DONE || !item.doneType) return '-';
  return salesActionItemDoneTypeMap[item.doneType]?.label ?? item.doneType;
}

export function SalesActionItemsPage() {
  const canSeeAll = useHasPermission('crm', 'sales_action_items', 'view', 'ALL');
  const canEdit = useHasPermission('crm', 'sales_action_items', 'edit');

  const [view, setView] = useState<ViewMode>(getInitialViewMode);
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilterMode>('pending');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const isAllView = view === 'all';
  const tableStorageId = isAllView ? 'sales-action-items-all' : 'sales-action-items-mine';

  // 表头排序状态：sortBy 为空字符串时走后端默认 [priority desc, createdAt desc]；
  // 点击表头切到白名单字段（createdAt / updatedAt / resolvedAt）走单字段 + createdAt tiebreaker。
  // 与其他列表页一致：冷启动优先 localStorage（按 tableStorageId 隔离 mine/all 视图），
  // 接受 server 全员默认推送（applyServerSorting），admin 推送时同步本地 version。
  const initialPersistedSortingRef = React.useRef<ReturnType<typeof loadPersistedSorting> | null>(
    null
  );
  if (initialPersistedSortingRef.current === null) {
    initialPersistedSortingRef.current = loadPersistedSorting(tableStorageId);
  }
  const [sortBy, setSortBy] = useState<string>(initialPersistedSortingRef.current?.sortBy ?? '');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    initialPersistedSortingRef.current?.sortOrder ?? 'desc'
  );
  const appliedServerSortingVersionRef = React.useRef<number>(
    initialPersistedSortingRef.current?.appliedServerVersion ?? 0
  );

  // tableStorageId 切换（mine ↔ all）：重读对应视图的 localStorage，避免 sortBy 串视图
  const prevTableStorageIdRef = React.useRef(tableStorageId);
  React.useLayoutEffect(() => {
    if (prevTableStorageIdRef.current === tableStorageId) return;
    prevTableStorageIdRef.current = tableStorageId;
    const next = loadPersistedSorting(tableStorageId);
    appliedServerSortingVersionRef.current = next?.appliedServerVersion ?? 0;
    setSortBy(next?.sortBy ?? '');
    setSortOrder(next?.sortOrder ?? 'desc');
    setPage(1);
  }, [tableStorageId]);

  const changeSort = useCallback(
    (nextSortBy: string, nextOrder?: 'asc' | 'desc') => {
      const finalOrder = nextOrder ?? 'desc';
      setSortBy(nextSortBy);
      setSortOrder(finalOrder);
      setPage(1);
      writePersistedSorting(
        {
          v: SORTING_STORAGE_VERSION,
          sortBy: nextSortBy || undefined,
          sortOrder: finalOrder,
          appliedServerVersion: appliedServerSortingVersionRef.current,
        },
        tableStorageId
      );
    },
    [tableStorageId]
  );

  // 接受 server 全员默认推送（由 useColumnVisibility 在 fetch 成功时调用，B 模式覆盖）
  const applyServerSorting = useCallback(
    (
      nextSortBy: string | undefined,
      nextSortOrder: 'asc' | 'desc' | undefined,
      version: number
    ) => {
      if (version <= appliedServerSortingVersionRef.current) return;
      appliedServerSortingVersionRef.current = version;
      setSortBy(nextSortBy ?? '');
      setSortOrder(nextSortOrder ?? 'desc');
      writePersistedSorting(
        {
          v: SORTING_STORAGE_VERSION,
          sortBy: nextSortBy,
          sortOrder: nextSortOrder,
          appliedServerVersion: version,
        },
        tableStorageId
      );
    },
    [tableStorageId]
  );

  // admin「保存为全员默认」成功后同步本地 appliedServerVersion，避免自己页面再覆盖一次
  const markServerSortingVersionApplied = useCallback(
    (version: number) => {
      appliedServerSortingVersionRef.current = version;
      writePersistedSorting(
        {
          v: SORTING_STORAGE_VERSION,
          sortBy: sortBy || undefined,
          sortOrder,
          appliedServerVersion: version,
        },
        tableStorageId
      );
    },
    [sortBy, sortOrder, tableStorageId]
  );

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  const scheme = useFilterScheme(SALES_ACTION_ITEMS_PAGE_KEY);
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const visibleFilterFields = useMemo(
    () =>
      scheme.fields.filter(
        (field) => !isQuickFilterField(field) && (isAllView || !isAllOnlyFilterField(field))
      ),
    [isAllView, scheme.fields]
  );

  const viewOptions = useMemo(
    () =>
      canSeeAll
        ? [
            { value: 'mine' as const, label: '我的', icon: UserRound },
            { value: 'all' as const, label: '全员', icon: Users },
          ]
        : [{ value: 'mine' as const, label: '我的', icon: UserRound }],
    [canSeeAll]
  );

  const resolutionOptions = useMemo(
    () => [
      { value: 'all' as const, label: '全部' },
      { value: 'done' as const, label: '已办' },
      { value: 'pending' as const, label: '未办' },
    ],
    []
  );

  // 抽屉 + 处置对话框
  const [selected, setSelected] = useState<ISalesActionItemResponse | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [ignoreTarget, setIgnoreTarget] = useState<ISalesActionItemResponse | null>(null);
  const [doneTarget, setDoneTarget] = useState<ISalesActionItemResponse | null>(null);
  const [transferTarget, setTransferTarget] = useState<ISalesActionItemResponse | null>(null);

  const adopt = useAdoptActionItem();
  const ignore = useIgnoreActionItem();
  const done = useDoneActionItem();
  const transfer = useTransferActionItem();
  const reopen = useReopenActionItem();
  const undo = useUndoActionItem();

  const query = useMemo<SalesActionItemsQuery>(
    () => ({
      page,
      pageSize,
      // 用户未点表头切排序时不传 sortBy，后端走默认 [priority desc, createdAt desc]；
      // 点了表头切到具体白名单字段后，后端走单字段排序 + createdAt tiebreaker。
      ...(sortBy ? { sortBy, sortOrder } : {}),
      ...filter.apiParams,
      status: getResolutionStatusParam(resolutionFilter),
    }),
    [filter.apiParams, page, pageSize, resolutionFilter, sortBy, sortOrder]
  );

  const mineQuery = useMyActionItems(query, !isAllView);
  const allQuery = useAdminActionItems(query, isAllView);
  const active = isAllView ? allQuery : mineQuery;

  const activeItems = active.data?.items;
  const items = useMemo(() => activeItems ?? [], [activeItems]);
  const total = active.data?.total ?? 0;
  const loading = active.isLoading;

  // 采纳率（全员视图，基于当前页已处置项的指示性统计）
  const adoptionStat = useMemo(() => {
    // 总处置量（所有 category）：总览用。
    const resolved = items.filter((it) => isHandledStatus(it.status)).length;
    // 采纳率只针对可采纳项（FILL_CONFIRM）：进攻类只能办结/忽略、无采纳动作，
    // 若混入分母会稀释采纳率。分母 = 已处置的可采纳项，分子 = 其中被采纳的。
    const adoptableResolved = items.filter(
      (it) => it.category === ADOPTABLE_CATEGORY && isHandledStatus(it.status)
    ).length;
    const adopted = items.filter((it) => it.status === 'adopted').length;
    return {
      resolved,
      adopted,
      adoptableResolved,
      rate: adoptableResolved > 0 ? Math.round((adopted / adoptableResolved) * 100) : 0,
    };
  }, [items]);

  const handleSearch = () => {
    setPage(1);
    filter.search();
  };

  const handleReset = () => {
    setPage(1);
    setResolutionFilter('pending');
    filter.reset();
  };

  const handleViewChange = (nextView: ViewMode) => {
    if (nextView === view) return;
    setView(nextView);
    setPage(1);
    filter.reset();
  };

  const handleResolutionFilterChange = (nextFilter: ResolutionFilterMode) => {
    if (nextFilter === resolutionFilter) return;
    setResolutionFilter(nextFilter);
    setPage(1);
  };

  const openDetail = (item: ISalesActionItemResponse) => {
    setSelected(item);
    setDrawerOpen(true);
  };

  const handleAdopt = async (item: ISalesActionItemResponse) => {
    try {
      await adopt.mutateAsync(item.id);
      toast.success('已采纳，跟进记录已写入');
    } catch (error) {
      toast.error(getErrorMessage(error, '采纳失败'));
    }
  };

  const handleUndo = async (item: ISalesActionItemResponse) => {
    try {
      await undo.mutateAsync(item.id);
      toast.success('已撤销，跟进记录已回收');
    } catch (error) {
      toast.error(getErrorMessage(error, '撤销失败（仅限当日或管理员）'));
    }
  };

  const handleReopen = async (item: ISalesActionItemResponse) => {
    try {
      await reopen.mutateAsync(item.id);
      toast.success('已改回待办');
    } catch (error) {
      toast.error(getErrorMessage(error, '改回待办失败'));
    }
  };

  const handleConfirmDone = async (
    resolveNote: string,
    doneType?: string,
    keepRecord?: IDoneSalesActionItemKeepRecord
  ) => {
    if (!doneTarget || !doneType) return;
    try {
      await done.mutateAsync({ id: doneTarget.id, doneType, resolveNote, keepRecord });
      toast.success('已办结');
      setDoneTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, '办结失败'));
    }
  };

  const handleConfirmIgnore = async (resolveNote: string) => {
    if (!ignoreTarget) return;
    try {
      await ignore.mutateAsync({ id: ignoreTarget.id, resolveNote });
      toast.success('已忽略');
      setIgnoreTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, '忽略失败'));
    }
  };

  const handleConfirmTransfer = async (targetEmployeeId: string, reason: string) => {
    if (!transferTarget) return;
    try {
      await transfer.mutateAsync({ id: transferTarget.id, targetEmployeeId, reason });
      toast.success('已转交');
      if (selected?.id === transferTarget.id) {
        setDrawerOpen(false);
        setSelected(null);
      }
      setTransferTarget(null);
    } catch (error) {
      toast.error(getErrorMessage(error, '转交失败'));
    }
  };

  const rowActions = useMemo<RowAction<ISalesActionItemResponse>[]>(
    () => [
      {
        key: 'detail',
        label: '详情',
        icon: <Eye className="h-4 w-4" />,
        onClick: openDetail,
      },
      {
        key: 'adopt',
        label: '采纳',
        icon: <ClipboardCheck className="h-4 w-4" />,
        onClick: handleAdopt,
        hidden: (item) => !canEdit || !(item.status === 'pending' && isAdoptableActionItem(item)),
      },
      {
        key: 'transfer',
        label: '转交',
        icon: <Send className="h-4 w-4" />,
        onClick: (item) => setTransferTarget(item),
        hidden: (item) => !canEdit || !isAllView || !isTransferableStatus(item.status),
      },
      {
        // 标记已办：pending 且不可一键采纳的项（进攻类 + 非完整草稿的防御类）。
        // 与采纳互斥（可采纳的走「采纳」），对齐抽屉 footer 的 canAdopt ? 采纳 : 标记已办。
        key: 'done',
        label: '标记已办',
        icon: <CheckCircle2 className="h-4 w-4" />,
        onClick: (item) => setDoneTarget(item),
        hidden: (item) => !canEdit || item.status !== 'pending' || isAdoptableActionItem(item),
      },
      {
        key: 'ignore',
        label: '忽略',
        icon: <XCircle className="h-4 w-4" />,
        onClick: (item) => setIgnoreTarget(item),
        hidden: (item) => !canEdit || item.status !== 'pending',
      },
      {
        key: 'reopen',
        label: '改回待办',
        icon: <RotateCcw className="h-4 w-4" />,
        onClick: handleReopen,
        hidden: (item) => !canEdit || item.status !== 'done',
      },
      {
        key: 'undo',
        label: '撤销采纳',
        icon: <RotateCcw className="h-4 w-4" />,
        onClick: handleUndo,
        danger: true,
        separator: true,
        hidden: (item) => !canEdit || item.status !== 'adopted',
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, isAllView]
  );

  const columnConfig = useMemo(
    () =>
      isAllView
        ? insertAfter(BASE_COLUMN_CONFIG, 'status', EMPLOYEE_NAME_COLUMN_CONFIG)
        : BASE_COLUMN_CONFIG,
    [isAllView]
  );
  const columnVisibility = useColumnVisibility(columnConfig, {
    storageId: tableStorageId,
    onServerSortingApplied: applyServerSorting,
  });

  // 列定义：从 shared schema 派生；全员视图额外插入 employeeName 虚拟列。
  const columns = useMemo<DataTableColumn<ISalesActionItemResponse>[]>(() => {
    const derived = deriveColumnsFromSchema<ISalesActionItemResponse>(
      salesActionItemResponseSchema,
      {
        overrides: [
          {
            key: 'title',
            minWidth: 220,
            render: (item) => <span className="font-medium">{item.title}</span>,
          },
          {
            key: 'reason',
            minWidth: 240,
            render: (item) => {
              const reason = item.reason || '-';
              return (
                <span className="line-clamp-1" title={reason}>
                  {reason.length > 40 ? `${reason.slice(0, 40)}...` : reason}
                </span>
              );
            },
          },
          {
            key: 'priority',
            render: (item) => <span className="tabular-nums">{item.priority}</span>,
          },
          {
            key: 'resolveNote',
            render: (item) => {
              const note = getResolveNoteDisplay(item);
              return (
                <span className="line-clamp-1" title={note}>
                  {note.length > 32 ? `${note.slice(0, 32)}...` : note}
                </span>
              );
            },
          },
        ],
      }
    );
    return isAllView ? insertAfter(derived, 'status', EMPLOYEE_NAME_COLUMN) : derived;
  }, [isAllView]);

  const renderMobileCard = (item: ISalesActionItemResponse) => (
    <GenericMobileCard
      title={item.title}
      status={<StatusBadge status={item.status} statusMap={salesActionItemStatusMap} />}
      fields={[
        {
          label: '类型',
          value: <StatusBadge status={item.category} statusMap={salesActionItemCategoryMap} />,
        },
        {
          label: '置信度',
          value: <StatusBadge status={item.confidence} statusMap={salesActionItemConfidenceMap} />,
        },
        { label: '客户', value: item.customerName ?? '-' },
        ...(isAllView ? [{ label: '收件销售', value: item.employee?.name ?? '-' }] : []),
        { label: '优先级', value: item.priority },
        { label: '创建时间', value: safeFormat(item.createdAt, 'yyyy-MM-dd HH:mm') },
        ...(isResolvedStatus(item.status)
          ? [
              { label: '处置人', value: item.resolvedByName ?? item.resolvedBy?.name ?? '-' },
              { label: '处置时间', value: safeFormat(item.resolvedAt, 'yyyy-MM-dd HH:mm') },
              ...(item.status === SALES_ACTION_ITEM_STATUS.DONE
                ? [{ label: '办结类型', value: getDoneTypeDisplay(item) }]
                : []),
              { label: '处置结果', value: getResolveNoteDisplay(item) },
            ]
          : []),
      ]}
      onClick={() => openDetail(item)}
      testId={`sales-action-${item.id}`}
    />
  );

  const pagination = {
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
    goToPage: setPage,
    changePageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
  };

  return (
    <>
      <HeaderRight>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {viewOptions.length > 1 && (
            <SegmentedToggle<ViewMode>
              value={view}
              onChange={handleViewChange}
              options={viewOptions}
              ariaLabel="待办视图切换"
            />
          )}
          <SegmentedToggle<ResolutionFilterMode>
            value={resolutionFilter}
            onChange={handleResolutionFilterChange}
            options={resolutionOptions}
            ariaLabel="办理状态筛选"
          />
        </div>
      </HeaderRight>
      <StandardLayout
        pagination={pagination}
        toolbar={
          <StandardToolbar
            onSearch={handleSearch}
            onReset={handleReset}
            actions={
              <ColumnVisibilityDropdown
                columns={columnVisibility.columns}
                onToggle={columnVisibility.toggleColumn}
                onShowAll={columnVisibility.showAll}
                onResetVisibility={columnVisibility.resetToDefault}
                onReorder={columnVisibility.reorderColumns}
                storageId={tableStorageId}
                onServerVersionApplied={columnVisibility.markServerVersionApplied}
                currentSortBy={sortBy}
                currentSortOrder={sortOrder}
                onServerSortingVersionApplied={markServerSortingVersionApplied}
              />
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
      >
        {isAllView && (
          <div className="mb-3 flex flex-wrap gap-4 rounded-lg border bg-muted/30 px-4 py-2 text-sm">
            <span className="text-muted-foreground">
              本页已处置{' '}
              <span className="font-medium text-foreground">{adoptionStat.resolved}</span> 条
            </span>
            <span className="text-muted-foreground">
              可采纳项采纳{' '}
              <span className="font-medium text-foreground">{adoptionStat.adopted}</span>/
              <span className="font-medium text-foreground">{adoptionStat.adoptableResolved}</span>{' '}
              条
            </span>
            <span className="text-muted-foreground">
              采纳率 <span className="font-medium text-foreground">{adoptionStat.rate}%</span>
              <span className="ml-1 text-xs">（仅可采纳项 · 当前页指示值）</span>
            </span>
          </div>
        )}

        <CrudTable
          error={active.error}
          onRetry={() => void active.refetch()}
          stale={active.isError && items.length > 0}
          data={items}
          columns={columns}
          loading={loading}
          onRowClick={openDetail}
          renderMobileCard={renderMobileCard}
          actions={rowActions}
          columnVisibility={{
            columns: columnVisibility.columns,
            onToggle: columnVisibility.toggleColumn,
            onShowAll: columnVisibility.showAll,
          }}
          sorting={{ sortBy, sortOrder, changeSort }}
          hidePagination
          storageId={tableStorageId}
          emptyState={{
            title: '数据已对齐，今日无待办',
            description: '没有符合条件的待办项',
          }}
        />

        <SalesActionDrawer
          open={drawerOpen}
          onOpenChange={(open) => {
            setDrawerOpen(open);
            if (!open) setSelected(null);
          }}
          item={selected}
          canUndo={canSeeAll || isAllView}
          canTransfer={canEdit && isAllView}
          onTransfer={setTransferTarget}
        />

        <IgnoreDialog
          open={!!ignoreTarget}
          onOpenChange={(open) => {
            if (!open) setIgnoreTarget(null);
          }}
          onConfirm={handleConfirmIgnore}
          loading={ignore.isPending}
        />

        <IgnoreDialog
          open={!!doneTarget}
          onOpenChange={(open) => {
            if (!open) setDoneTarget(null);
          }}
          onConfirm={handleConfirmDone}
          loading={done.isPending}
          title="标记已办"
          description="请填写本次实际处置结果。该信息会留存在待办记录中，便于复盘和管理端审计。"
          label="处置结果"
          placeholder="例如：已联系客户确认下周三演示；或已补齐跟进记录并同步商机阶段"
          confirmText="确认办结"
          doneTypeOptions={DONE_TYPE_OPTIONS}
          requireDoneType
        />

        <TransferDialog
          open={!!transferTarget}
          item={transferTarget}
          onOpenChange={(open) => {
            if (!open) setTransferTarget(null);
          }}
          onConfirm={handleConfirmTransfer}
          loading={transfer.isPending}
        />
      </StandardLayout>
    </>
  );
}
