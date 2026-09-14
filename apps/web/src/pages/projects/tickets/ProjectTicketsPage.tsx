// 触发内置渲染器/导出格式化器注册（副作用 import）
import '@/lib/column-renderers';
import '@/lib/column-export-formatters';

import {
  PROJECT_TICKET_STATUS,
  PROJECT_TICKET_TRANSITIONS,
  PROJECT_TICKET_VIEW,
  type ProjectTicketStatusValue,
  type ProjectTicketViewValue,
} from '@ky-azeroth/shared/constants/project-ticket-constants';
import { projectTicketResponseSchema } from '@ky-azeroth/shared/schemas/project-ticket';
import type { IProjectTicketResponse } from '@ky-azeroth/shared/types/project-ticket';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Pencil,
  PlayCircle,
  Trash2,
  UserCog,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { HeaderRight } from '@/components/patterns/header-right';
import { type RowAction } from '@/components/patterns/row-actions-menu';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Button } from '@/components/ui/button';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';
import { formatDateDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { TicketFormDialog } from './components/TicketFormDialog';
import { TicketReassignDialog } from './components/TicketReassignDialog';
import { TicketStatsBar } from './components/TicketStatsBar';
import { TicketTransitionDialog } from './components/TicketTransitionDialog';
import { useTicketStats } from './hooks/use-ticket-stats';
import {
  initialProjectTicketFormData,
  type ProjectTicketFormData,
  projectTicketFormSchema,
  type ProjectTicketProfile,
  toProjectTicketFormData,
  toProjectTicketPayload,
  toProjectTicketProfile,
} from './types';

const VIEW_OPTIONS: Array<{ value: ProjectTicketViewValue; label: string }> = [
  { value: PROJECT_TICKET_VIEW.ASSIGNED, label: '我的待办' },
  { value: PROJECT_TICKET_VIEW.DISPATCHED, label: '我派出的' },
  { value: PROJECT_TICKET_VIEW.ALL, label: '全部' },
];

const STATUS_TRANSITION_LABELS: Record<ProjectTicketStatusValue, string> = {
  PENDING: '开始处理',
  IN_PROGRESS: '开始处理',
  COMPLETED: '完成',
  CLOSED: '关闭',
  CANCELLED: '取消',
};

export function ProjectTicketsPage() {
  const { user, hasMenuPermission, hasViewScopeAll } = useAuthStore();
  const currentEmployeeId = user?.employee?.id ?? null;
  const canSeeAllTickets = hasViewScopeAll('projects', 'project_tickets');

  const canCreate = hasMenuPermission('projects', 'project_tickets', 'create');
  const canEdit = hasMenuPermission('projects', 'project_tickets', 'edit');
  const canDelete = hasMenuPermission('projects', 'project_tickets', 'delete');

  const [view, setView] = useState<ProjectTicketViewValue>(PROJECT_TICKET_VIEW.ASSIGNED);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  // 注意：view tab（我的待办/我派出的/全部）和 TicketStatsBar 的状态卡片点击（含
  // isOverdue 派生条件）是业务硬规则，保留在本页独立 UI，不走 CrudFilterBar。
  const scheme = useFilterScheme('projects.tickets');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  const extraParams = useMemo(() => {
    const params: Record<string, unknown> = {
      view,
      ...filter.apiParams,
    };
    // 顶部状态卡片点击：覆盖 status 筛选或传递 isOverdue 布尔标记。
    // 使用 flat bracket-key 与 filter-scheme 保持一致。
    if (statusFilter === 'OVERDUE') {
      params.isOverdue = true;
    } else if (statusFilter) {
      params['filters[status][]'] = [statusFilter];
    }
    return params;
  }, [view, filter.apiParams, statusFilter]);

  const crud = useCrud<ProjectTicketProfile, ProjectTicketFormData, IProjectTicketResponse>({
    endpoint: '/project-tickets',
    requireVersion: true,
    schema: projectTicketFormSchema,
    validateMode: 'onSubmit',
    initialFormData: initialProjectTicketFormData,
    entityToForm: toProjectTicketFormData,
    formToPayload: toProjectTicketPayload,
    getEntityName: (ticket) => ticket.title,
    transformData: (data) => data.map(toProjectTicketProfile),
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams,
    },
  });

  const { stats, refresh: refreshStats } = useTicketStats();

  const refreshAll = useCallback(() => {
    crud.refresh();
    refreshStats();
  }, [crud, refreshStats]);

  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, filter.apiParams, statusFilter]);

  // 状态流转 / 改派 对话框
  const [transitionTicket, setTransitionTicket] = useState<ProjectTicketProfile | null>(null);
  const [transitionTo, setTransitionTo] = useState<ProjectTicketStatusValue | null>(null);
  const [reassignTicket, setReassignTicket] = useState<ProjectTicketProfile | null>(null);

  const openTransition = useCallback(
    (ticket: ProjectTicketProfile, toStatus: ProjectTicketStatusValue) => {
      setTransitionTicket(ticket);
      setTransitionTo(toStatus);
    },
    []
  );

  const closeTransition = useCallback(() => {
    setTransitionTicket(null);
    setTransitionTo(null);
  }, []);

  const openReassign = useCallback((ticket: ProjectTicketProfile) => {
    setReassignTicket(ticket);
  }, []);

  const closeReassign = useCallback(() => {
    setReassignTicket(null);
  }, []);

  // ========== 权限判断 ==========

  const isDispatcher = useCallback(
    (ticket: ProjectTicketProfile): boolean => {
      if (canSeeAllTickets) return true;
      if (!currentEmployeeId) return false;
      return ticket.dispatcherId === currentEmployeeId;
    },
    [currentEmployeeId, canSeeAllTickets]
  );

  const isAssignee = useCallback(
    (ticket: ProjectTicketProfile): boolean => {
      if (canSeeAllTickets) return true;
      if (!currentEmployeeId) return false;
      return ticket.assigneeId === currentEmployeeId;
    },
    [currentEmployeeId, canSeeAllTickets]
  );

  const canTransitionTo = useCallback(
    (ticket: ProjectTicketProfile, toStatus: ProjectTicketStatusValue): boolean => {
      if (canSeeAllTickets) return true;
      const dispatcher = isDispatcher(ticket);
      const assignee = isAssignee(ticket);
      switch (toStatus) {
        case PROJECT_TICKET_STATUS.IN_PROGRESS:
          return assignee;
        case PROJECT_TICKET_STATUS.COMPLETED:
          return assignee;
        case PROJECT_TICKET_STATUS.CLOSED:
          return dispatcher;
        case PROJECT_TICKET_STATUS.CANCELLED:
          return assignee || dispatcher;
        default:
          return false;
      }
    },
    [canSeeAllTickets, isAssignee, isDispatcher]
  );

  // ========== 表格列 ==========
  // 从 `projectTicketResponseSchema` 派生列 header/width/sortable；业务化 Badge / 复合渲染
  // （标题+项目副标、dueDate 逾期高亮）保留在 overrides 中。
  const columns = useMemo(
    () =>
      deriveColumnsFromSchema<ProjectTicketProfile>(projectTicketResponseSchema, {
        overrides: [
          {
            key: 'title',
            render: (item) => (
              <div className="flex flex-col">
                <span className="font-medium">{item.title}</span>
                {item.project && (
                  <span className="text-xs text-muted-foreground">{item.project.name}</span>
                )}
              </div>
            ),
          },
          {
            key: 'customerName',
            render: (item) => (
              <span className="text-muted-foreground">{item.customerName || '-'}</span>
            ),
          },
          {
            key: 'assignee',
            render: (item) => item.assignee?.name ?? '-',
          },
          {
            key: 'dispatcher',
            render: (item) => item.dispatcher?.name ?? '-',
          },
          {
            key: 'dueDate',
            render: (item) => {
              if (!item.dueDate) return '-';
              const label = formatDateDisplay(item.dueDate) || '-';
              return (
                <span
                  className={cn(
                    'text-muted-foreground',
                    item.isOverdue && 'font-medium text-red-600'
                  )}
                >
                  {item.isOverdue ? (
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {label}
                    </span>
                  ) : (
                    label
                  )}
                </span>
              );
            },
          },
        ],
      }),
    []
  );

  // ========== 行操作 ==========

  const rowActions: RowAction<ProjectTicketProfile>[] = useMemo(() => {
    const actions: RowAction<ProjectTicketProfile>[] = [];

    actions.push({
      key: 'view',
      label: '查看',
      icon: <Eye className="h-4 w-4" />,
      onClick: crud.openViewDialog,
    });

    if (canEdit) {
      actions.push({
        key: 'edit',
        label: '编辑',
        icon: <Pencil className="h-4 w-4" />,
        onClick: crud.openEditDialog,
        hidden: (item) => !isDispatcher(item),
      });
    }

    // 状态流转按钮：基于 PROJECT_TICKET_TRANSITIONS 动态展示
    const transitionStatuses: ProjectTicketStatusValue[] = [
      PROJECT_TICKET_STATUS.IN_PROGRESS,
      PROJECT_TICKET_STATUS.COMPLETED,
      PROJECT_TICKET_STATUS.CLOSED,
      PROJECT_TICKET_STATUS.CANCELLED,
    ];

    transitionStatuses.forEach((toStatus, index) => {
      actions.push({
        key: `transition-${toStatus}`,
        label: STATUS_TRANSITION_LABELS[toStatus],
        icon: <PlayCircle className="h-4 w-4" />,
        onClick: (item) => openTransition(item, toStatus),
        separator: index === 0,
        hidden: (item) => {
          const allowed = PROJECT_TICKET_TRANSITIONS[item.status as ProjectTicketStatusValue];
          if (!allowed || !allowed.includes(toStatus)) return true;
          return !canTransitionTo(item, toStatus);
        },
      });
    });

    if (canEdit) {
      actions.push({
        key: 'reassign',
        label: '改派',
        icon: <UserCog className="h-4 w-4" />,
        onClick: openReassign,
        separator: true,
        hidden: (item) => {
          if (!isDispatcher(item)) return true;
          return (
            item.status !== PROJECT_TICKET_STATUS.PENDING &&
            item.status !== PROJECT_TICKET_STATUS.IN_PROGRESS
          );
        },
      });
    }

    if (canDelete) {
      actions.push({
        key: 'delete',
        label: '删除',
        icon: <Trash2 className="h-4 w-4" />,
        onClick: crud.openDeleteDialog,
        danger: true,
        separator: true,
        hidden: (item) => !isDispatcher(item),
      });
    }

    return actions;
  }, [
    crud.openViewDialog,
    crud.openEditDialog,
    crud.openDeleteDialog,
    canEdit,
    canDelete,
    isDispatcher,
    openTransition,
    openReassign,
    canTransitionTo,
  ]);

  const formDialogTitle = crud.isEditing ? '项目工单详情' : '新建项目工单';
  const detailTicket = crud.editingEntity;

  const canCompleteInDetail = !!(
    detailTicket &&
    canTransitionTo(detailTicket, PROJECT_TICKET_STATUS.COMPLETED) &&
    (PROJECT_TICKET_TRANSITIONS[detailTicket.status as ProjectTicketStatusValue] ?? []).includes(
      PROJECT_TICKET_STATUS.COMPLETED
    )
  );

  // 列表自动跟随状态统计点击与 view 变化自动刷新
  useEffect(() => {
    crud.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <StandardLayout
      toolbar={
        <div className="space-y-4">
          <HeaderRight>
            <SegmentedToggle<ProjectTicketViewValue>
              value={view}
              onChange={(v) => setView(v)}
              options={VIEW_OPTIONS}
              ariaLabel="工单视图"
            />
          </HeaderRight>

          <TicketStatsBar
            stats={stats}
            activeStatus={statusFilter}
            onStatusClick={setStatusFilter}
          />

          <StandardToolbar
            onCreate={canCreate ? crud.openCreateDialog : undefined}
            createLabel="新建工单"
            onSearch={filter.search}
            onReset={() => {
              filter.reset();
              setStatusFilter(null);
            }}
            filters={
              scheme.isLoading ? (
                <FilterBarSkeleton count={5} />
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
        columns={columns}
        loading={crud.loading}
        sorting={crud.sorting}
        onRowClick={crud.openViewDialog}
        hidePagination
        emptyState={{
          title: '暂无项目工单',
          description: canCreate ? '点击"新建工单"创建第一条记录' : undefined,
        }}
        actions={rowActions}
      />

      <TicketFormDialog
        open={crud.formDialogProps.open}
        onOpenChange={crud.formDialogProps.onOpenChange}
        mode={crud.formDialogProps.mode}
        title={formDialogTitle}
        loading={crud.formDialogProps.loading}
        formData={crud.formData}
        editingEntity={crud.editingEntity}
        onModeChange={
          crud.formDialogProps.onModeChange &&
          crud.editingEntity &&
          isDispatcher(crud.editingEntity)
            ? crud.formDialogProps.onModeChange
            : undefined
        }
        onSubmit={crud.handleSubmit}
        onDelete={
          detailTicket && isDispatcher(detailTicket) && canDelete
            ? crud.formDialogProps.onDelete
            : undefined
        }
        viewHeaderActions={
          crud.formDialogProps.mode === 'view' && canCompleteInDetail && detailTicket ? (
            <Button
              type="button"
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => openTransition(detailTicket, PROJECT_TICKET_STATUS.COMPLETED)}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              完成
            </Button>
          ) : undefined
        }
        updateField={crud.updateFormField}
        getFieldError={crud.getFieldError}
      />

      <DeleteConfirm {...crud.deleteConfirmProps} />

      <TicketTransitionDialog
        open={!!transitionTicket && !!transitionTo}
        onOpenChange={(open) => {
          if (!open) closeTransition();
        }}
        ticket={transitionTicket}
        toStatus={transitionTo}
        onSuccess={refreshAll}
      />

      <TicketReassignDialog
        open={!!reassignTicket}
        onOpenChange={(open) => {
          if (!open) closeReassign();
        }}
        ticket={reassignTicket}
        onSuccess={refreshAll}
      />
    </StandardLayout>
  );
}
