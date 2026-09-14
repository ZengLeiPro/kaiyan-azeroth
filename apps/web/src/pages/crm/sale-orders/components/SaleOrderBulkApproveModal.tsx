import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

interface SelectedOrder {
  id: string;
  flowStatus: string | null | undefined;
  serialNumber?: string | null;
}

interface SaleOrderBulkApproveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOrders: SelectedOrder[];
  onSuccess: () => void;
}

/**
 * 批量审批订单（审批人视角）：
 * - 仅对 flowStatus='pending' 且当前用户是 currentApprover 的订单生效
 * - 前端先并发拉每个订单对应的 ApprovalInstance.id，再调 POST /sale-orders/batch-approve
 * - 后端循环调 ApprovalsService.doApproval，每条独立事务（保留 CAS+行锁+节点推进的并发安全语义）
 * - 跳过原因（不是审批人 / 被抢先决策 / 财务校验失败 / 非订单审批）聚合在 skipped 中
 */
export function SaleOrderBulkApproveModal({
  open,
  onOpenChange,
  selectedOrders,
  onSuccess,
}: SaleOrderBulkApproveModalProps) {
  const [comment, setComment] = useState<string>('');
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [instanceIds, setInstanceIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const pendingOrders = selectedOrders.filter((o) => o.flowStatus === 'pending');
  const nonPendingCount = selectedOrders.length - pendingOrders.length;

  // 打开时并发取 instance IDs
  useEffect(() => {
    if (!open) return;
    if (pendingOrders.length === 0) {
      setInstanceIds([]);
      return;
    }
    setLoadingInstances(true);
    Promise.allSettled(
      pendingOrders.map((o) =>
        api.get<{ id: string }>(`/approvals/form/sale_order_activate/${o.id}`)
      )
    )
      .then((results) => {
        const ids: string[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value.data?.id) {
            ids.push(r.value.data.id);
          }
        }
        setInstanceIds(ids);
      })
      .finally(() => setLoadingInstances(false));
  }, [open, pendingOrders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setComment('');
    setInstanceIds([]);
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const doSubmit = async (action: 'approve' | 'reject') => {
    // @validation-ok 业务规则检查：异步预拉的 instance 集合为空（非表单字段验证）
    if (instanceIds.length === 0) {
      toast.error('没有可批量决策的待审订单');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post<{
        success: number;
        skipped: Array<{ id: string; reason: string }>;
      }>('/sale-orders/batch-approve', {
        instanceIds,
        action,
        comment: comment || undefined,
      });
      const skippedCount = data.skipped?.length ?? 0;
      const actionLabel = action === 'approve' ? '通过' : '驳回';
      if (skippedCount > 0) {
        const sample = data.skipped
          .slice(0, 3)
          .map((s) => s.reason)
          .join('；');
        toast.success(
          `已${actionLabel} ${data.success} 条，跳过 ${skippedCount} 条（${sample}${
            skippedCount > 3 ? ' 等' : ''
          }）`
        );
      } else {
        toast.success(`已${actionLabel} ${data.success} 条审批`);
      }
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, '批量审批失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title="批量审批订单"
      description={`共选中 ${selectedOrders.length} 个订单${
        nonPendingCount > 0 ? `（其中 ${nonPendingCount} 个非待审状态将被跳过）` : ''
      }`}
      desktopMaxWidth="max-w-md"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => doSubmit('reject')}
            disabled={submitting || loadingInstances || instanceIds.length === 0}
          >
            {submitting
              ? '处理中...'
              : `批量驳回${instanceIds.length > 0 ? `（${instanceIds.length}）` : ''}`}
          </Button>
          <Button
            onClick={() => doSubmit('approve')}
            disabled={submitting || loadingInstances || instanceIds.length === 0}
          >
            {submitting
              ? '处理中...'
              : `批量通过${instanceIds.length > 0 ? `（${instanceIds.length}）` : ''}`}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="space-y-4 py-2">
          {loadingInstances ? (
            <p className="text-sm text-muted-foreground">正在加载审批实例...</p>
          ) : (
            <p className="text-sm">
              将对 <strong>{instanceIds.length}</strong>{' '}
              条待审订单执行批量审批；非待审或您不是审批人的订单将被自动跳过。
            </p>
          )}
          <FormField name="comment" label="审批意见（可选）">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="可填批准/驳回的理由，最多 500 字"
              maxLength={500}
              rows={3}
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            批量审批不支持管理员代审（如需代审请到审批中心逐条处理）。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
