// 触发内置渲染器注册（副作用 import）
import '@/lib/column-renderers';

import { APPROVAL_EVENT_TYPE_LABELS } from '@ky-azeroth/shared/constants';
import { approvalFlowResponseSchema } from '@ky-azeroth/shared/schemas/approval';
import { format } from 'date-fns';
import { GitBranch, History, Loader2, Play, Plus, PowerOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { MobileBottomBar, MobileBottomBarSpacer } from '@/components/mobile';
import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { BulkDeleteConfirm } from '@/components/patterns/bulk-delete-confirm';
import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { CrudTable } from '@/components/patterns/crud-table';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';
import { FilterBarSkeleton } from '@/components/patterns/filter-bar-skeleton';
import { GenericMobileCard } from '@/components/patterns/generic-mobile-card';
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCrud } from '@/hooks/use-crud';
import { useFilterScheme } from '@/hooks/use-filter-scheme';
import { useManualFilter } from '@/hooks/use-manual-filter';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';
import { COL_ACTION } from '@/lib/column-widths';
import { deriveColumnsFromSchema } from '@/lib/columns-from-schema';

import {
  type ApprovalFlowFormData,
  approvalFlowFormSchema,
  type ApprovalFlowProfile,
  createEmptyApprovalFlowFormData,
  formatVersion,
  toApprovalFlowProfile,
} from './types';

export function ApprovalFlowsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // 筛选字段 + 初始 state 全由服务端的 filter-scheme registry/config 驱动。
  // 后端 baseWhere 默认排除 deleted（active + inactive 都显示），
  // 停用的流程会带"已停用"Badge 留在列表里，可直接点行内"激活"按钮拉回。
  const scheme = useFilterScheme('approval_flows');
  const filter = useManualFilter(scheme.initialFilters, undefined, scheme.version);

  // 停用/激活单个流程的确认弹窗状态
  const [toggleTarget, setToggleTarget] = useState<ApprovalFlowProfile | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);

  // CRUD hook
  const crud = useCrud<ApprovalFlowProfile, ApprovalFlowFormData>({
    endpoint: '/approval-flows',
    schema: approvalFlowFormSchema,
    validateMode: 'onChange',
    initialFormData: createEmptyApprovalFlowFormData(),
    getEntityName: (flow) => flow.name,
    paginationOptions: {
      initialSortBy: 'createdAt',
      initialSortOrder: 'desc',
      extraParams: filter.apiParams,
    },
    transformData: (data) => data.map(toApprovalFlowProfile),
  });

  // Navigate to create page
  const handleCreate = useCallback(() => {
    navigate('/approval/flows/new');
  }, [navigate]);

  // Navigate to edit page
  const handleEdit = useCallback(
    (flow: ApprovalFlowProfile) => {
      navigate(`/approval/flows/${flow.id}`);
    },
    [navigate]
  );

  // Navigate to history page
  const handleViewHistory = useCallback(
    (flow: ApprovalFlowProfile, e: React.MouseEvent) => {
      e.stopPropagation();
      navigate(`/approval/flows/history/${flow.groupId}`);
    },
    [navigate]
  );

  // 打开停用/激活确认弹窗
  const handleOpenToggle = useCallback((flow: ApprovalFlowProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    setToggleTarget(flow);
  }, []);

  // 确认停用/激活
  const handleConfirmToggle = useCallback(async () => {
    if (!toggleTarget) return;
    const isActivate = toggleTarget.status !== 'active';
    const action = isActivate ? 'activate' : 'deactivate';
    setToggleLoading(true);
    try {
      await api.post(`/approval-flows/${toggleTarget.id}/${action}`);
      toast.success(`${toggleTarget.name} 已${isActivate ? '激活' : '停用'}`);
      setToggleTarget(null);
      crud.refresh();
    } catch (err) {
      toast.error(getErrorMessage(err, isActivate ? '激活失败' : '停用失败'));
    } finally {
      setToggleLoading(false);
    }
  }, [toggleTarget, crud]);

  /**
   * 表格列：从 `approvalFlowResponseSchema` 派生列头/宽度/datetime。
   * Badge/版本/截断等特殊渲染保留在 overrides；节点数/操作为虚拟列。
   */
  const columns = deriveColumnsFromSchema<ApprovalFlowProfile>(approvalFlowResponseSchema, {
    include: [
      'name',
      'code',
      'version',
      'eventType',
      'nodes',
      'status',
      'description',
      'copyToIds',
      'createdAt',
    ],
    overrides: [
      {
        key: 'code',
        render: (flow) => (
          <span className="font-mono text-xs text-muted-foreground">{flow.code || '-'}</span>
        ),
      },
      {
        key: 'version',
        render: (flow) => (
          <Badge variant="outline" className="font-mono">
            {formatVersion(flow.version)}
          </Badge>
        ),
      },
      {
        key: 'eventType',
        render: (flow) => (
          <Badge variant="info">
            {APPROVAL_EVENT_TYPE_LABELS[flow.eventType] || flow.eventType}
          </Badge>
        ),
      },
      {
        key: 'nodes',
        header: '节点数',
        width: 80,
        render: (flow) => <span>{flow.nodes?.length || 0}</span>,
      },
      {
        key: 'status',
        render: (flow) => {
          const label =
            flow.status === 'active'
              ? '已激活'
              : flow.status === 'inactive'
                ? '已停用'
                : flow.status;
          const variant = flow.status === 'active' ? 'success' : 'secondary';
          return <Badge variant={variant}>{label}</Badge>;
        },
      },
      {
        key: 'description',
        render: (flow) => {
          const text = flow.description;
          if (!text) return '-';
          return (
            <span className="line-clamp-1 text-muted-foreground" title={text}>
              {text.length > 30 ? `${text.slice(0, 30)}...` : text}
            </span>
          );
        },
      },
      {
        key: 'copyToIds',
        render: (flow) => <span>{flow.copyToIds?.length ?? 0}</span>,
      },
      {
        key: 'createdAt',
        render: (flow) => (
          <span className="text-muted-foreground">
            {flow.createdAt ? format(new Date(flow.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
          </span>
        ),
      },
      {
        key: 'actions',
        mode: 'after',
        header: '操作',
        width: COL_ACTION + 40,
        render: (flow) => {
          const canToggle = flow.status === 'active' || flow.status === 'inactive';
          const isActive = flow.status === 'active';
          return (
            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => handleViewHistory(flow, e)}
                title="版本历史"
              >
                <History className="h-4 w-4" />
              </Button>
              {canToggle && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => handleOpenToggle(flow, e)}
                  title={isActive ? '停用' : '激活'}
                >
                  {isActive ? (
                    <PowerOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Play className="h-4 w-4 text-primary" />
                  )}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
  });

  // Mobile card renderer
  const renderMobileCard = (flow: ApprovalFlowProfile) => (
    <GenericMobileCard
      title={flow.name}
      status={
        <Badge variant="outline" className="font-mono">
          {formatVersion(flow.version)}
        </Badge>
      }
      fields={[
        { label: '类型', value: APPROVAL_EVENT_TYPE_LABELS[flow.eventType] || flow.eventType },
        { label: '节点数', value: flow.nodes?.length || 0 },
      ]}
      footer={flow.createdAt ? format(new Date(flow.createdAt), 'yyyy-MM-dd HH:mm') : '-'}
      onClick={() => handleEdit(flow)}
      testId={`flow-${flow.id}`}
    />
  );

  return (
    <MobileBottomBarSpacer hasBottomBar={isMobile}>
      <StandardLayout
        toolbar={
          <StandardToolbar
            onCreate={handleCreate}
            createLabel="新建流程"
            bulkSelection={{
              selectedCount: crud.selectedKeys.size,
              onClearSelection: crud.clearSelection,
              onBulkDelete: crud.openBulkDeleteDialog,
            }}
            onSearch={() => {
              filter.search();
              setTimeout(() => crud.refresh(), 0);
            }}
            onReset={() => {
              filter.reset();
              setTimeout(() => crud.refresh(), 0);
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
          loading={crud.loading}
          sorting={crud.sorting}
          onRowClick={handleEdit}
          renderMobileCard={renderMobileCard}
          rowSelection={crud.rowSelectionProps}
          hidePagination
          emptyState={{
            title: '暂无审批流程',
            description: '点击"新建流程"按钮添加您的第一个审批流程',
            icon: <GitBranch className="h-12 w-12 text-muted-foreground/50" />,
          }}
        />

        <DeleteConfirm {...crud.deleteConfirmProps} />
        <BulkDeleteConfirm {...crud.bulkDeleteConfirmProps} />

        <ResponsiveDialog
          open={!!toggleTarget}
          onOpenChange={(open) => !open && setToggleTarget(null)}
          title={toggleTarget?.status === 'active' ? '停用审批流程' : '激活审批流程'}
          desktopMaxWidth="max-w-sm"
          modal
          footer={
            <>
              <Button variant="outline" onClick={() => setToggleTarget(null)}>
                取消
              </Button>
              <Button
                variant={toggleTarget?.status === 'active' ? 'destructive' : 'default'}
                onClick={handleConfirmToggle}
                disabled={toggleLoading}
              >
                {toggleLoading ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    处理中...
                  </>
                ) : toggleTarget?.status === 'active' ? (
                  '确认停用'
                ) : (
                  '确认激活'
                )}
              </Button>
            </>
          }
        >
          {toggleTarget && (
            <div className="py-4 text-sm text-muted-foreground">
              {toggleTarget.status === 'active' ? (
                <>
                  确定停用 <span className="font-medium text-foreground">{toggleTarget.name}</span>{' '}
                  吗？
                  <br />
                  停用后该{' '}
                  <span className="font-medium text-foreground">
                    {APPROVAL_EVENT_TYPE_LABELS[toggleTarget.eventType] || toggleTarget.eventType}
                  </span>{' '}
                  模块将暂无激活流程，新提交的审批事件不再走此流程；已在进行中的实例不受影响，继续按快照跑完。
                </>
              ) : (
                <>
                  确定激活 <span className="font-medium text-foreground">{toggleTarget.name}</span>{' '}
                  吗？
                  <br />
                  激活后会自动停用同事件类型下其它激活的流程（每个事件类型仅保留一个激活版本）。
                </>
              )}
            </div>
          )}
        </ResponsiveDialog>
      </StandardLayout>

      {isMobile && (
        <MobileBottomBar>
          <Button className="flex-1" onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建流程
          </Button>
        </MobileBottomBar>
      )}
    </MobileBottomBarSpacer>
  );
}

export default ApprovalFlowsPage;
