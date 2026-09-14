import { CheckCircle, XCircle } from 'lucide-react';
import { useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getErrorMessage } from '@/lib/api';

type ActionType = 'approve' | 'reject';

interface ApprovalQuickActionsProps {
  canApprove: boolean;
  canApproveAsAdmin: boolean;
  onApprove: (comment?: string) => Promise<void>;
  onReject: (comment?: string) => Promise<void>;
}

const CONFIG: Record<ActionType, { title: string; description: string; successText: string }> = {
  approve: {
    title: '确认通过',
    description: '确定要通过此审批吗？',
    successText: '审批通过',
  },
  reject: {
    title: '确认驳回',
    description: '确定要驳回此审批吗？驳回后流程将结束。',
    successText: '已驳回',
  },
};

export function ApprovalQuickActions({
  canApprove,
  canApproveAsAdmin,
  onApprove,
  onReject,
}: ApprovalQuickActionsProps) {
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);

  if (!canApprove) return null;

  const handleConfirm = async () => {
    if (!pendingAction) return;
    setLoading(true);
    try {
      const fn = pendingAction === 'approve' ? onApprove : onReject;
      await fn(comment.trim() || undefined);
      toast.success(CONFIG[pendingAction].successText);
      setComment('');
      setPendingAction(null);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, '操作失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !loading) {
      setPendingAction(null);
      setComment('');
    }
  };

  return (
    <>
      {canApproveAsAdmin && (
        <Badge variant="info" className="text-xs">
          代审
        </Badge>
      )}
      <Button
        type="button"
        size="sm"
        onClick={() => setPendingAction('approve')}
        disabled={loading}
      >
        <CheckCircle className="mr-1 h-3.5 w-3.5" />
        通过
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => setPendingAction('reject')}
        disabled={loading}
      >
        <XCircle className="mr-1 h-3.5 w-3.5" />
        驳回
      </Button>

      <AlertDialog open={pendingAction !== null} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingAction ? CONFIG[pendingAction].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction ? CONFIG[pendingAction].description : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>审批意见</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="请输入审批意见（选填）"
              rows={3}
              disabled={loading}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={loading}>
              {loading ? '处理中...' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
