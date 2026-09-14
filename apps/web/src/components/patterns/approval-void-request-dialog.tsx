import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

interface ApprovalVoidRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  recordId?: string | null;
  recordVersion?: number | null;
  recordLabel: string;
  recordName?: string | null;
  onSuccess?: () => void;
}

export function ApprovalVoidRequestDialog({
  open,
  onOpenChange,
  endpoint,
  recordId,
  recordVersion,
  recordLabel,
  recordName,
  onSuccess,
}: ApprovalVoidRequestDialogProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  const handleSubmit = async () => {
    const trimmedReason = reason.trim();
    if (!recordId || recordVersion == null || !trimmedReason) return;

    setSubmitting(true);
    try {
      await api.post(`${endpoint}/${recordId}/void-request`, {
        reason: trimmedReason,
        version: recordVersion,
      });
      toast.success('作废申请已提交，审批通过后生效');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(getErrorMessage(error, '提交作废申请失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>申请作废{recordLabel}</DialogTitle>
          <DialogDescription>
            {recordName ? `单据：${recordName}。` : ''}
            审批通过后记录会从业务列表隐藏；审批完成前不会改变原数据。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="approval-void-reason">
            作废原因 <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="approval-void-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="请说明为何作废，便于审批与后续审计"
            rows={4}
            maxLength={500}
            disabled={submitting}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={submitting || !reason.trim() || !recordId || recordVersion == null}
          >
            {submitting ? '提交中…' : '提交作废审批'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
