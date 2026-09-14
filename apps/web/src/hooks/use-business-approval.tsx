import type { IApprovalInstanceResponse } from '@ky-azeroth/shared/types';
import { Eye, Send } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ApprovalQuickActions } from '@/components/patterns/approval-quick-actions';
import { RowAction } from '@/components/patterns/row-actions-menu';
import { api, getErrorMessage } from '@/lib/api';
import { computeApprovalPermissions } from '@/lib/approval-permissions';
import { logger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth';

interface UseBusinessApprovalOptions<T> {
  eventType: string;
  getEntityId: (entity: T) => string;
  getFlowStatus: (entity: T) => string | null | undefined;
  onSuccess: () => void | Promise<void>;
  /** 当前业务详情抽屉正在查看的实体（用于在顶栏渲染通过/驳回按钮）。传 `crud.editingEntity` 即可 */
  viewEntity?: T | null;
  /** 当前业务详情抽屉的模式。传 `crud.formDialogProps.mode` 即可 */
  viewMode?: 'view' | 'edit' | 'create';
  /** 草稿/驳回单据重新提交审批；创建仍保持创建即提交。 */
  onSubmitApproval?: (entity: T) => Promise<void>;
}

export function useBusinessApproval<T>({
  eventType,
  getEntityId,
  getFlowStatus,
  onSuccess,
  viewEntity,
  viewMode,
  onSubmitApproval,
}: UseBusinessApprovalOptions<T>) {
  const { user, getPermissions } = useAuthStore();
  const canAdminApprove = getPermissions().some(
    (permission) =>
      permission.module === 'approval' &&
      permission.menu === 'approval_list' &&
      permission.approve === true &&
      permission.viewScope === 'ALL'
  );
  const myEmployeeId = user?.employee?.id ?? user?.id;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);

  // 业务详情抽屉顶栏的"快速审批"实例（懒加载）
  const [quickInstance, setQuickInstance] = useState<IApprovalInstanceResponse | null>(null);

  const openApprovalDetail = useCallback(
    async (entity: T) => {
      try {
        const id = getEntityId(entity);
        const res = await api.get<IApprovalInstanceResponse | null>(
          `/approvals/form/${eventType}/${id}`
        );
        if (!res.data?.id) {
          toast.info('暂无审批记录');
          return;
        }
        setInstanceId(res.data.id);
        setDrawerOpen(true);
      } catch (error) {
        logger.error('useBusinessApproval', '加载审批详情失败:', error);
        toast.error('加载审批详情失败');
      }
    },
    [eventType, getEntityId]
  );

  // 派生稳定依赖（避免 viewEntity 引用变化触发重复拉取）
  const viewEntityId = viewEntity ? getEntityId(viewEntity) : null;
  const viewFlowStatus = viewEntity ? getFlowStatus(viewEntity) : null;

  // 业务详情抽屉打开且单据处于 pending 时，懒加载审批实例用于权限判断
  useEffect(() => {
    if (viewMode !== 'view' || !viewEntityId || viewFlowStatus !== 'pending') {
      setQuickInstance(null);
      return;
    }
    let cancelled = false;
    api
      .get<IApprovalInstanceResponse | null>(`/approvals/form/${eventType}/${viewEntityId}`)
      .then((res) => {
        if (cancelled) return;
        setQuickInstance(res.data?.id ? res.data : null);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('useBusinessApproval', '加载快速审批实例失败:', err);
        setQuickInstance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewMode, viewEntityId, viewFlowStatus, eventType]);

  const permissions = computeApprovalPermissions(quickInstance, myEmployeeId, canAdminApprove);

  const handleQuickAction = useCallback(
    async (action: 'approve' | 'reject', comment?: string) => {
      if (!quickInstance) return;
      const useAdmin = permissions.canApproveAsAdmin && !permissions.canApproveAsNormal;
      const endpoint = useAdmin
        ? `/approvals/${quickInstance.id}/admin-approve`
        : `/approvals/${quickInstance.id}/approve`;
      await api.post(endpoint, { action, comment });
      await Promise.resolve(onSuccess());
      // 操作成功后清空 instance，让顶栏按钮立即消失；抽屉保持打开
      setQuickInstance(null);
    },
    [quickInstance, permissions.canApproveAsAdmin, permissions.canApproveAsNormal, onSuccess]
  );

  const handleQuickApprove = useCallback(
    (comment?: string) => handleQuickAction('approve', comment),
    [handleQuickAction]
  );
  const handleQuickReject = useCallback(
    (comment?: string) => handleQuickAction('reject', comment),
    [handleQuickAction]
  );

  const viewHeaderActions: ReactNode = permissions.canApprove ? (
    <ApprovalQuickActions
      canApprove={permissions.canApprove}
      canApproveAsAdmin={permissions.canApproveAsAdmin}
      onApprove={handleQuickApprove}
      onReject={handleQuickReject}
    />
  ) : null;

  const extraActions: RowAction<T>[] = [
    ...(onSubmitApproval
      ? [
          {
            key: 'resubmit-approval',
            label: '重新提交审批',
            icon: <Send className="h-4 w-4" />,
            onClick: async (item: T) => {
              try {
                await onSubmitApproval(item);
                toast.success('已重新提交审批');
                await Promise.resolve(onSuccess());
              } catch (error) {
                logger.error('useBusinessApproval', '重新提交审批失败:', error);
                toast.error(getErrorMessage(error, '重新提交审批失败'));
              }
            },
            hidden: (item: T) => {
              const status = getFlowStatus(item);
              return status !== 'draft' && status !== 'rejected';
            },
          } satisfies RowAction<T>,
        ]
      : []),
    {
      key: 'view-approval',
      label: '查看审批',
      icon: <Eye className="h-4 w-4" />,
      onClick: openApprovalDetail,
      hidden: (item) => {
        const status = getFlowStatus(item);
        return status !== 'pending' && status !== 'approved' && status !== 'rejected';
      },
    },
  ];

  return {
    openApprovalDetail,
    extraActions,
    viewHeaderActions,
    drawerProps: {
      open: drawerOpen,
      onOpenChange: setDrawerOpen,
      instanceId,
      onSuccess,
    },
  };
}
