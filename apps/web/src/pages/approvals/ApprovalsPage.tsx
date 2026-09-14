// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import {
  APPROVAL_EVENT_TYPE_LABELS,
  APPROVAL_INSTANCE_STATUS_LABELS,
  APPROVAL_TASK_STATUS_LABELS,
} from '@ky-azeroth/shared/constants';
import {
  approvalInstanceResponseSchema,
  approvalTaskResponseSchema,
} from '@ky-azeroth/shared/schemas/approval';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { ApprovalDetailDrawer } from '@/components/patterns/approval-detail-drawer';
import { ColumnVisibilityDropdown } from '@/components/patterns/column-visibility';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { HeaderRight } from '@/components/patterns/header-right';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import type { DataTableColumn } from '@/components/ui/data-table';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { type ColumnConfig, useColumnVisibility } from '@/hooks/use-column-visibility';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { type FilterValue, useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { COL_DATE, COL_STATUS, COL_STATUS_SM } from '@/lib/column-widths';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import {
  APPROVAL_TABS,
  type ApprovalInstanceProfile,
  type ApprovalTabKey,
  type ApprovalTaskProfile,
} from './types';

// 列表项类型（任务或实例）
type ListItem = ApprovalTaskProfile | ApprovalInstanceProfile;

// 审批列表为只读页面，useCrud 仅用于复用列表/分页/筛选骨架，不参与表单
type ApprovalListFormData = Record<string, never>;

const APPROVAL_PAGE_KEY: Record<ApprovalTabKey, string> = {
  pending: 'approvals.pending',
  completed: 'approvals.completed',
  copyTo: 'approvals.copy_to',
  initiated: 'approvals.initiated',
  all: 'approvals.all',
};

const EVENT_TYPE_FILTER_KEY = 'filters[eventType][]';

function toLegacyApprovalFilterParams(
  filters: Record<string, FilterValue>
): Record<string, FilterValue | undefined> {
  return {
    keyword: filters.keyword,
    // 审批查询仍使用既有 eventType 参数；只在展示层接入 scheme，避免改变接口语义。
    eventType: filters[EVENT_TYPE_FILTER_KEY],
  };
}

const TAB_ENDPOINT: Record<ApprovalTabKey, string> = {
  pending: '/approvals/pending',
  completed: '/approvals/completed',
  copyTo: '/approvals/copy-to',
  initiated: '/approvals/initiated',
  all: '/approvals/all',
};

/**
 * 三套列可见性配置：
 * - task：pending/completed 共用
 * - instance：copyTo/initiated 共用
 * - all：管理员"全部审批"，多一列「当前审批人」
 *
 * 列 key 与 `deriveColumnsFromSchema` 输出的列 key 一一对应，并由 `useColumnVisibility`
 * 按 storageId（activeTab）独立持久化到 localStorage（`column-visibility:/approvals:<tab>`）。
 */
const TASK_COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'title', label: '审批标题', visible: true, canHide: false },
  { key: 'eventType', label: '类型', visible: true },
  { key: 'initiatorName', label: '发起人', visible: true },
  { key: 'nodeName', label: '当前节点', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'time', label: '时间', visible: true },
];

const INSTANCE_COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'code', label: '审批编号', visible: true },
  { key: 'title', label: '审批标题', visible: true, canHide: false },
  { key: 'eventType', label: '类型', visible: true },
  { key: 'initiatorName', label: '发起人', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'currentNode', label: '进度', visible: true },
  { key: 'createdAt', label: '提交时间', visible: true },
  { key: 'completedAt', label: '完成时间', visible: true },
  { key: 'copyToIds', label: '抄送人数', visible: false },
];

const ALL_COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'code', label: '审批编号', visible: true },
  { key: 'title', label: '审批标题', visible: true, canHide: false },
  { key: 'eventType', label: '类型', visible: true },
  { key: 'initiatorName', label: '发起人', visible: true },
  { key: 'currentApprover', label: '当前审批人', visible: true },
  { key: 'status', label: '状态', visible: true },
  { key: 'currentNode', label: '进度', visible: true },
  { key: 'createdAt', label: '提交时间', visible: true },
  { key: 'completedAt', label: '完成时间', visible: true },
  { key: 'copyToIds', label: '抄送人数', visible: false },
];

function getTaskStatusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'pending':
      return 'warning';
    default:
      return 'secondary';
  }
}

function getInstanceStatusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info' {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'destructive';
    case 'pending':
      return 'warning';
    default:
      return 'secondary';
  }
}

function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeDisplay(value) || '-';
}

export function ApprovalsPage() {
  const isMobile = useIsMobile();
  const getPermissions = useAuthStore((state) => state.getPermissions);
  const canViewAllApprovals = getPermissions().some(
    (permission) =>
      permission.module === 'approval' &&
      permission.menu === 'approval_list' &&
      permission.view === true &&
      permission.viewScope === 'ALL'
  );
  const [searchParams] = useSearchParams();

  // 根据 system/roles 中 approval_list 的数据范围过滤可见的 Tab
  const visibleTabs = useMemo(() => {
    return APPROVAL_TABS.filter((tab) => !tab.allScopeOnly || canViewAllApprovals);
  }, [canViewAllApprovals]);

  // URL ?tab=... 优先；拥有全部数据范围默认 all，其余默认 pending
  const getInitialTab = useCallback((): ApprovalTabKey => {
    const urlTab = searchParams.get('tab') as ApprovalTabKey | null;
    const validKeys = visibleTabs.map((t) => t.key);
    if (urlTab && validKeys.includes(urlTab)) return urlTab;
    return canViewAllApprovals ? 'all' : 'pending';
  }, [searchParams, visibleTabs, canViewAllApprovals]);

  const [activeTab, setActiveTab] = useState<ApprovalTabKey>(getInitialTab);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const scheme = useFilterScheme(APPROVAL_PAGE_KEY[activeTab]);
  const tabSchemeVersion =
    scheme.version * 10 + APPROVAL_TABS.findIndex((tab) => tab.key === activeTab);

  // 手动筛选：输入 → 点击搜索按钮才查询；各 Tab 独立 pageKey，切换后重置对应方案。
  const filter = useManualFilter(
    scheme.initialFilters,
    toLegacyApprovalFilterParams,
    tabSchemeVersion
  );

  // 审批列表为只读，useCrud 仅用于复用列表/分页/筛选骨架（已在 check-usecrud-schema.js 白名单内）
  const crud = useCrud<ListItem, ApprovalListFormData>({
    endpoint: TAB_ENDPOINT[activeTab],
    schema: z.object({}),
    initialFormData: {},
    paginationOptions: {
      initialPageSize: 100,
      // task / instance 列表默认排序字段不同（task→createdAt 或 actionTime，instance→createdAt）
      initialSortBy: activeTab === 'completed' ? 'actionTime' : 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
      sortingStorageId: activeTab,
    },
  });

  // Tab 切换、外部跳转携带 instanceId/approvalId 时打开详情抽屉
  useEffect(() => {
    setActiveTab(getInitialTab());

    const instanceId = searchParams.get('instanceId') ?? searchParams.get('approvalId');
    if (instanceId) {
      setSelectedId(instanceId);
      setDrawerOpen(true);
    }
  }, [searchParams, getInitialTab]);

  // 切换 Tab 时回到第一页（endpoint 变化触发重新加载，但 page 不会自动重置）
  const { pagination } = crud;
  const goToPage = pagination.goToPage;
  const handleTabChange = useCallback(
    (next: ApprovalTabKey) => {
      setActiveTab(next);
      goToPage(1);
    },
    [goToPage]
  );

  // 待审批数量（独立 API，与列表解耦）
  const loadPendingCount = useCallback(async () => {
    try {
      const res = await api.get('/approvals/pending/count');
      setPendingCount(res.data);
    } catch (error) {
      logger.error('ApprovalsPage', 'Failed to load pending count:', error);
    }
  }, []);

  useEffect(() => {
    loadPendingCount();
  }, [loadPendingCount]);

  const handleRefresh = useCallback(() => {
    crud.refresh();
    loadPendingCount();
  }, [crud, loadPendingCount]);

  const handleRowClick = useCallback((row: ListItem) => {
    // pending/completed 是 task，需要取 instance.id；copyTo/initiated/all 是 instance
    const taskRow = row as ApprovalTaskProfile;
    const instanceId = taskRow.instance?.id || (row as ApprovalInstanceProfile).id;
    setSelectedId(instanceId);
    setDrawerOpen(true);
  }, []);

  /**
   * Task 列（pending / completed）：从 `approvalTaskResponseSchema` 派生 `nodeName`/`status`，
   * 其余作为虚拟列：
   * - `title`/`eventType`/`initiatorName`：来自 nested `task.instance.*`，以 `before` 虚拟列插入
   * - `time`：根据 activeTab 切换 `createdAt` / `actionTime`，单独一列避免列宽/可见性串表
   *
   * `createdAt` / `actionTime` 在 schema 里有 meta，但在 task 行里被合并为虚拟 `time` 列，
   * 因此用 exclude 排除 schema 自动派生。
   */
  const taskColumns = useMemo<DataTableColumn<ListItem>[]>(() => {
    const sortKeyForTime = activeTab === 'completed' ? 'actionTime' : 'createdAt';
    return deriveColumnsFromSchema<ListItem>(approvalTaskResponseSchema, {
      exclude: ['createdAt', 'actionTime'],
      overrides: [
        // 三列 nested 字段：以 before 虚拟列形式插入
        {
          mode: 'before',
          key: 'title',
          header: '审批标题',
          minWidth: 180,
          render: (item) => {
            const task = item as ApprovalTaskProfile;
            return <span className="font-medium">{task.instance?.title || '-'}</span>;
          },
        },
        {
          mode: 'before',
          key: 'eventType',
          header: '类型',
          width: 120,
          render: (item) => {
            const task = item as ApprovalTaskProfile;
            return (
              <Badge variant="outline">
                {APPROVAL_EVENT_TYPE_LABELS[task.instance?.eventType || ''] || '-'}
              </Badge>
            );
          },
        },
        {
          mode: 'before',
          key: 'initiatorName',
          header: '发起人',
          width: 100,
          render: (item) => {
            const task = item as ApprovalTaskProfile;
            return task.instance?.initiatorName || '-';
          },
        },
        // schema 派生列的业务渲染覆盖
        {
          key: 'nodeName',
          sortable: true,
          accessor: (item) => (item as ApprovalTaskProfile).nodeName,
        },
        {
          key: 'status',
          sortable: true,
          render: (item) => {
            const task = item as ApprovalTaskProfile;
            return (
              <Badge variant={getTaskStatusVariant(task.status)}>
                {APPROVAL_TASK_STATUS_LABELS[task.status] || task.status}
              </Badge>
            );
          },
        },
        // 时间虚拟列（after，跟在 schema 派生列后面）
        {
          mode: 'after',
          key: 'time',
          header: activeTab === 'completed' ? '处理时间' : '创建时间',
          width: COL_DATE,
          sortable: true,
          sortKey: sortKeyForTime,
          render: (item) => {
            const task = item as ApprovalTaskProfile;
            return formatDateTime(activeTab === 'completed' ? task.actionTime : task.createdAt);
          },
        },
      ],
    });
  }, [activeTab]);

  /**
   * Instance 列（copyTo / initiated）：从 `approvalInstanceResponseSchema` 派生。
   * Badge / 拼接 / font-mono 渲染保留在 overrides。
   */
  const instanceColumns = useMemo(
    () =>
      deriveColumnsFromSchema<ListItem>(approvalInstanceResponseSchema, {
        include: [
          'code',
          'title',
          'eventType',
          'initiatorName',
          'status',
          'currentNode',
          'createdAt',
          'completedAt',
          'copyToIds',
        ],
        overrides: [
          {
            key: 'code',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return (
                <span className="font-mono text-xs text-muted-foreground">
                  {instance.code || '-'}
                </span>
              );
            },
          },
          {
            key: 'title',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return <span className="font-medium">{instance.title}</span>;
            },
          },
          {
            key: 'eventType',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return (
                <Badge variant="outline">
                  {APPROVAL_EVENT_TYPE_LABELS[instance.eventType] || '-'}
                </Badge>
              );
            },
          },
          {
            key: 'initiatorName',
            sortable: true,
            render: (item) => (item as ApprovalInstanceProfile).initiatorName || '-',
          },
          {
            key: 'status',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return (
                <Badge variant={getInstanceStatusVariant(instance.status)}>
                  {APPROVAL_INSTANCE_STATUS_LABELS[instance.status] || instance.status}
                </Badge>
              );
            },
          },
          {
            key: 'currentNode',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return `${instance.currentNode} / ${instance.totalNodes}`;
            },
          },
          {
            key: 'createdAt',
            sortable: true,
            render: (item) => formatDateTime((item as ApprovalInstanceProfile).createdAt),
          },
          {
            key: 'completedAt',
            sortable: true,
            render: (item) => formatDateTime((item as ApprovalInstanceProfile).completedAt),
          },
          {
            key: 'copyToIds',
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return <span>{instance.copyToIds?.length ?? 0}</span>;
            },
          },
        ],
      }),
    []
  );

  /**
   * 全部审批列（all）：复用 instance schema 派生 + before 虚拟列「当前审批人」。
   */
  const allApprovalColumns = useMemo(
    () =>
      deriveColumnsFromSchema<ListItem>(approvalInstanceResponseSchema, {
        include: [
          'code',
          'title',
          'eventType',
          'initiatorName',
          // currentApprover 虚拟列在此 include 后无法插入，所以用 before/after 虚拟列方式
          'status',
          'currentNode',
          'createdAt',
          'completedAt',
          'copyToIds',
        ],
        overrides: [
          {
            key: 'code',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return (
                <span className="font-mono text-xs text-muted-foreground">
                  {instance.code || '-'}
                </span>
              );
            },
          },
          {
            key: 'title',
            sortable: true,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return <span className="font-medium">{instance.title}</span>;
            },
          },
          {
            key: 'eventType',
            sortable: true,
            width: COL_STATUS,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return (
                <Badge variant="outline">
                  {APPROVAL_EVENT_TYPE_LABELS[instance.eventType] || '-'}
                </Badge>
              );
            },
          },
          {
            key: 'initiatorName',
            sortable: true,
            width: COL_STATUS_SM,
            accessor: (item) => (item as ApprovalInstanceProfile).initiatorName,
          },
          // 虚拟列：当前审批人（从 instance.tasks 拼接）。
          // 用 after 虚拟列追加在末尾会破坏阅读顺序，因此用 override+key 不在 schema 的方式
          // 不可行 —— 改用 schemaColumns 之后手动 splice 实现。
          {
            key: 'status',
            sortable: true,
            width: COL_STATUS_SM,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return (
                <Badge variant={getInstanceStatusVariant(instance.status)}>
                  {APPROVAL_INSTANCE_STATUS_LABELS[instance.status] || instance.status}
                </Badge>
              );
            },
          },
          {
            key: 'currentNode',
            sortable: true,
            width: 70,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return `${instance.currentNode}/${instance.totalNodes}`;
            },
          },
          {
            key: 'createdAt',
            sortable: true,
            width: 100,
            render: (item) => formatDateTime((item as ApprovalInstanceProfile).createdAt),
          },
          {
            key: 'completedAt',
            sortable: true,
            width: 100,
            render: (item) => formatDateTime((item as ApprovalInstanceProfile).completedAt),
          },
          {
            key: 'copyToIds',
            width: COL_STATUS_SM,
            render: (item) => {
              const instance = item as ApprovalInstanceProfile;
              return <span>{instance.copyToIds?.length ?? 0}</span>;
            },
          },
        ],
      }),
    []
  );

  // 将虚拟列「当前审批人」插入到 initiatorName 之后（schema 派生不支持中间插入）
  const allApprovalColumnsWithApprover = useMemo<DataTableColumn<ListItem>[]>(() => {
    const approverCol: DataTableColumn<ListItem> = {
      key: 'currentApprover',
      header: '当前审批人',
      width: 120,
      render: (item) => {
        const instance = item as ApprovalInstanceProfile & {
          tasks?: Array<{ approverName: string }>;
        };
        const pendingApprovers = instance.tasks?.map((t) => t.approverName).join('、');
        return pendingApprovers || '-';
      },
    };
    const out = [...allApprovalColumns];
    const idx = out.findIndex((c) => c.key === 'initiatorName');
    if (idx >= 0) {
      out.splice(idx + 1, 0, approverCol);
    } else {
      out.push(approverCol);
    }
    return out;
  }, [allApprovalColumns]);

  // 根据当前 Tab 选择列定义与可见性配置
  const isTaskTab = activeTab === 'pending' || activeTab === 'completed';
  const isAllTab = activeTab === 'all';
  const baseColumns = isTaskTab
    ? taskColumns
    : isAllTab
      ? allApprovalColumnsWithApprover
      : instanceColumns;
  const visibilityConfig = isTaskTab
    ? TASK_COLUMN_CONFIG
    : isAllTab
      ? ALL_COLUMN_CONFIG
      : INSTANCE_COLUMN_CONFIG;

  // 按 Tab 独立持久化列显隐 + 列顺序（storageId=activeTab）
  const columnVisibility = useColumnVisibility(visibilityConfig, {
    storageId: activeTab,
    onServerSortingApplied: crud.sorting.applyServerSorting,
  });

  // 移动端卡片渲染
  const renderMobileCard = useCallback(
    (item: ListItem) => {
      const isTask = activeTab === 'pending' || activeTab === 'completed';
      const task = item as ApprovalTaskProfile;
      const instance = item as ApprovalInstanceProfile;

      const title = isTask ? task.instance?.title : instance.title;
      const eventType = isTask ? task.instance?.eventType : instance.eventType;
      const initiatorName = isTask ? task.instance?.initiatorName : instance.initiatorName;
      const status = isTask ? task.status : instance.status;
      const statusLabel = isTask
        ? APPROVAL_TASK_STATUS_LABELS[status] || status
        : APPROVAL_INSTANCE_STATUS_LABELS[status] || status;
      const statusVariant = isTask
        ? getTaskStatusVariant(status)
        : getInstanceStatusVariant(status);
      const time = isTask
        ? activeTab === 'completed'
          ? task.actionTime
          : task.createdAt
        : instance.createdAt;

      return (
        <GenericMobileCard
          title={title || '-'}
          status={<Badge variant={statusVariant}>{statusLabel}</Badge>}
          onClick={() => handleRowClick(item)}
          fields={[
            { label: '类型', value: APPROVAL_EVENT_TYPE_LABELS[eventType || ''] || '-' },
            { label: '发起人', value: initiatorName || '-' },
            { label: '时间', value: formatDateTime(time) },
            ...(activeTab !== 'pending' && activeTab !== 'completed'
              ? [{ label: '进度', value: `${instance.currentNode}/${instance.totalNodes}` }]
              : []),
            ...(isTask && task.nodeName ? [{ label: '节点', value: task.nodeName }] : []),
          ]}
        />
      );
    },
    [activeTab, handleRowClick]
  );

  return (
    <StandardLayout
      toolbar={
        <div className="space-y-3 md:space-y-4">
          <HeaderRight>
            <div className={cn(isMobile && '-mx-4 overflow-x-auto px-4')}>
              <SegmentedToggle<ApprovalTabKey>
                value={activeTab}
                onChange={handleTabChange}
                options={visibleTabs.map((tab) => ({
                  value: tab.key,
                  label: tab.label,
                  badge: tab.showBadge ? pendingCount : undefined,
                }))}
                ariaLabel="审批视图"
              />
            </div>
          </HeaderRight>
          <StandardToolbar
            onSearch={filter.search}
            onReset={filter.reset}
            actions={
              <ColumnVisibilityDropdown
                columns={columnVisibility.columns}
                onToggle={columnVisibility.toggleColumn}
                onShowAll={columnVisibility.showAll}
                onResetVisibility={columnVisibility.resetToDefault}
                onReorder={columnVisibility.reorderColumns}
                storageId={activeTab}
                currentSortBy={crud.sorting.sortBy}
                currentSortOrder={crud.sorting.sortOrder}
                onServerSortingVersionApplied={crud.sorting.markServerSortingVersionApplied}
              />
            }
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={2} />
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
        </div>
      }
      pagination={crud.pagination}
    >
      <CrudTable
        {...crud.tableProps}
        data={crud.data}
        columns={baseColumns}
        loading={crud.loading}
        sorting={crud.sorting}
        onRowClick={handleRowClick}
        renderMobileCard={renderMobileCard}
        hidePagination
        // 同路径三张表（pending/completed → taskColumns、all → allApprovalColumns、其余 → instanceColumns）
        // 列宽必须按 tab 隔离，否则 localStorage 会串表
        storageId={activeTab}
        columnVisibility={{
          columns: columnVisibility.columns,
          onToggle: columnVisibility.toggleColumn,
          onShowAll: columnVisibility.showAll,
        }}
        emptyState={{ title: '暂无审批', description: '当前 Tab 下没有匹配的审批记录' }}
      />

      <ApprovalDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        instanceId={selectedId}
        onSuccess={handleRefresh}
      />
    </StandardLayout>
  );
}

export default ApprovalsPage;
