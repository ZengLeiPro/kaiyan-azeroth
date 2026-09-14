import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import type { IApprovalInstanceResponse } from '@ky-azeroth/shared/types';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { type DrawerEntityType, useDrawerStackOptional } from '@/components/patterns/drawer-stack';
import { api } from '@/lib/api';
import { logger } from '@/lib/logger';

interface ApprovalDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string | null;
  onSuccess?: () => void;
}

const APPROVAL_ENTITY_MAP: Partial<Record<string, DrawerEntityType>> = {
  [APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE]: 'sale-order',
  [APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE]: 'sale-order',
  [APPROVAL_EVENT_TYPE.SALE_ORDER_VOID]: 'sale-order',
  [APPROVAL_EVENT_TYPE.INVOICE_APPROVE]: 'invoice',
  [APPROVAL_EVENT_TYPE.INVOICE_CHANGE]: 'invoice',
  [APPROVAL_EVENT_TYPE.PAYMENT_APPROVE]: 'payment',
  [APPROVAL_EVENT_TYPE.PAYMENT_CHANGE]: 'payment',
  // 退款也是 payment 实体（direction='OUT'），路由到同一 entity 详情抽屉，
  // 由 BusinessApprovalSection 根据 record.direction 自动展示"退款审批"语义
  [APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE]: 'payment',
  [APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE]: 'payment',
  [APPROVAL_EVENT_TYPE.VISIT_APPROVE]: 'visit-record',
  [APPROVAL_EVENT_TYPE.VISIT_CHANGE]: 'visit-record',
  // 客户线索阶段（MQL/SQL）变更走 change-request 模式，targetType=CUSTOMER，
  // formId=ApprovalChangeRequest.id，需查 change-requests 接口拿 targetId=customer.id
  [APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE]: 'customer',
};

const CHANGE_APPROVAL_EVENTS = new Set<string>([
  APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
  APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
  APPROVAL_EVENT_TYPE.INVOICE_CHANGE,
  APPROVAL_EVENT_TYPE.PAYMENT_CHANGE,
  APPROVAL_EVENT_TYPE.PAYMENT_REFUND_CHANGE,
  APPROVAL_EVENT_TYPE.VISIT_CHANGE,
  APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE,
]);

interface ApprovalChangeRequestResponse {
  targetId: string;
  patch?: unknown;
}

function getLatestApprovalInstanceId(changeRequest: ApprovalChangeRequestResponse): string | null {
  if (typeof changeRequest.patch !== 'object' || changeRequest.patch === null) return null;
  const instanceId = (changeRequest.patch as Record<string, unknown>).__latestApprovalInstanceId;
  return typeof instanceId === 'string' ? instanceId : null;
}

/**
 * 兼容旧入口的适配器。
 *
 * 审批中心、通知、业务列表仍以 approvalInstanceId 打开“审批详情”，但实际 UI 不再单独
 * 渲染一份单据 JSON，而是定位到对应业务详情抽屉，并把审批上下文交给业务详情里的
 * BusinessApprovalSection 渲染。
 */
export function ApprovalDetailDrawer({
  open,
  onOpenChange,
  instanceId,
  onSuccess,
}: ApprovalDetailDrawerProps) {
  const drawerStack = useDrawerStackOptional();
  const push = drawerStack?.push;
  const openingRef = useRef<string | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const onSuccessRef = useRef(onSuccess);

  onOpenChangeRef.current = onOpenChange;
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (!open) {
      openingRef.current = null;
      return;
    }
    if (!instanceId || openingRef.current === instanceId) return;

    openingRef.current = instanceId;
    let cancelled = false;

    api
      .get<IApprovalInstanceResponse>(`/approvals/${instanceId}`)
      .then(async (res) => {
        if (cancelled) return;
        const instance = res.data;
        const entityType = APPROVAL_ENTITY_MAP[instance.eventType];

        if (!entityType || !push) {
          toast.error('当前审批类型暂不支持在业务详情中打开');
          return;
        }

        let entityId = instance.formId;
        let approvalInstanceId = instance.id;
        if (CHANGE_APPROVAL_EVENTS.has(instance.eventType)) {
          try {
            const changeRes = await api.get<ApprovalChangeRequestResponse>(
              `/approvals/change-requests/${instance.formId}`
            );
            if (cancelled) return;
            entityId = changeRes.data.targetId;
            // 已被重新提交替代的订单审批，通知与历史入口都自动定位到最新审批。
            approvalInstanceId = getLatestApprovalInstanceId(changeRes.data) ?? instance.id;
          } catch (error) {
            // 变更申请不存在时仍打开实体详情。实体详情的审批降级视图会保留操作入口，
            // 不能让一个坏 formId 关闭整条审批。
            logger.error('ApprovalDetailDrawer', '加载变更申请失败:', error);
            toast.error('业务单加载失败，已保留审批操作');
          }
        }

        push({
          type: entityType,
          id: entityId,
          title: instance.title,
          context: {
            approvalInstanceId,
            approvalEventType: instance.eventType,
            onApprovalSuccess: () => onSuccessRef.current?.(),
          },
        });
      })
      .catch((error) => {
        logger.error('ApprovalDetailDrawer', '加载审批实例失败:', error);
        toast.error('加载审批详情失败');
      })
      .finally(() => {
        if (!cancelled) onOpenChangeRef.current(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId, open, push]);

  return null;
}
