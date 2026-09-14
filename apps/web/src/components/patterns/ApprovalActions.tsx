import { CheckCircle, RotateCcw, XCircle } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/api';

interface ApprovalActionsProps {
  instanceId: string;
  canApprove: boolean;
  canWithdraw: boolean;
  onApprove: (comment?: string) => Promise<void>;
  onReject: (comment?: string) => Promise<void>;
  onWithdraw: (comment?: string) => Promise<void>;
  onSuccess?: () => void;
  /** 仅禁用“通过”按钮，保留“驳回”入口。 */
  approveDisabled?: boolean;
  /**
   * 通过前的附加操作 slot（渲染在意见 textarea 上方）
   *
   * 通用组件不感知具体业务，由调用方（如 approval-panel）自行决定何时渲染。
   */
  extraApproveContent?: ReactNode;
}

type ActionType = 'approve' | 'reject' | 'withdraw';

interface ConfirmDialogState {
  open: boolean;
  type: ActionType;
  title: string;
  description: string;
}

export function ApprovalActions({
  canApprove,
  canWithdraw,
  onApprove,
  onReject,
  onWithdraw,
  onSuccess,
  approveDisabled = false,
  extraApproveContent,
}: ApprovalActionsProps) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    open: false,
    type: 'approve',
    title: '',
    description: '',
  });

  const handleAction = async () => {
    setLoading(true);
    try {
      switch (confirmDialog.type) {
        case 'approve':
          await onApprove(comment || undefined);
          toast.success('审批通过');
          break;
        case 'reject':
          await onReject(comment || undefined);
          toast.success('已驳回');
          break;
        case 'withdraw':
          await onWithdraw(comment || undefined);
          toast.success('已撤回');
          break;
      }
      setComment('');
      setConfirmDialog({ ...confirmDialog, open: false });
      onSuccess?.();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '操作失败'));
    } finally {
      setLoading(false);
    }
  };

  const openConfirm = (type: ActionType) => {
    const configs: Record<ActionType, { title: string; description: string }> = {
      approve: { title: '确认通过', description: '确定要通过此审批吗？' },
      reject: { title: '确认驳回', description: '确定要驳回此审批吗？驳回后流程将结束。' },
      withdraw: { title: '确认撤回', description: '确定要撤回此审批吗？' },
    };
    setConfirmDialog({
      open: true,
      type,
      ...configs[type],
    });
  };

  if (!canApprove && !canWithdraw) {
    return null;
  }

  return (
    <div className="space-y-4">
      {canApprove && extraApproveContent ? <div>{extraApproveContent}</div> : null}

      <div>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="请输入审批意见（选填）"
          rows={3}
        />
      </div>

      <div className="flex gap-2">
        {canApprove && (
          <>
            <Button
              onClick={() => openConfirm('approve')}
              className="flex-1"
              disabled={loading || approveDisabled}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              通过
            </Button>
            <Button
              variant="destructive"
              onClick={() => openConfirm('reject')}
              className="flex-1"
              disabled={loading}
            >
              <XCircle className="mr-2 h-4 w-4" />
              驳回
            </Button>
          </>
        )}
        {canWithdraw && (
          <Button
            variant="outline"
            onClick={() => openConfirm('withdraw')}
            className="flex-1"
            disabled={loading}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            撤回
          </Button>
        )}
      </div>

      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={loading}>
              {loading ? '处理中...' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
