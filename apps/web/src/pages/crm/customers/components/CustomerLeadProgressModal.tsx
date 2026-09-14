import type { LeadProgressStatusValue } from '@ky-azeroth/shared/constants/status-values';
import { LEAD_PROGRESS_STATUS } from '@ky-azeroth/shared/constants/status-values';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';
import { isoToLocalInput, localInputToIso } from '@/lib/date-utils';

type ManualLeadProgressStatus = Extract<
  LeadProgressStatusValue,
  'ACTIVE' | 'NO_SHOW' | 'PENDING_VISIT' | 'LOST'
>;

const DIALOG_COPY: Record<
  ManualLeadProgressStatus,
  { title: string; description: string; submit: string }
> = {
  ACTIVE: {
    title: '重新激活线索',
    description: '线索将回到 M·活跃，重新进入电话跟进流程。',
    submit: '确认重新激活',
  },
  NO_SHOW: {
    title: '标记客户毁约',
    description: '线索将退回 M·毁约待重启，可重新预约或转为流失。',
    submit: '确认毁约',
  },
  PENDING_VISIT: {
    title: '安排预约拜访',
    description: '保存预约时间后，线索将自动升级为 S·待拜访。',
    submit: '保存预约',
  },
  LOST: {
    title: '标记线索流失',
    description: '线索将进入流失终态；以后仍可重新激活。',
    submit: '确认流失',
  },
};

interface CustomerLeadProgressModalProps {
  customerId: string;
  customerName: string;
  currentVersion: number;
  currentAppointmentAt?: string | null;
  targetStatus: ManualLeadProgressStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CustomerLeadProgressModal({
  customerId,
  customerName,
  currentVersion,
  currentAppointmentAt,
  targetStatus,
  open,
  onOpenChange,
  onSuccess,
}: CustomerLeadProgressModalProps) {
  const [appointmentAt, setAppointmentAt] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAppointmentAt(
      targetStatus === LEAD_PROGRESS_STATUS.PENDING_VISIT
        ? isoToLocalInput(currentAppointmentAt)
        : ''
    );
    setReason('');
  }, [currentAppointmentAt, open, targetStatus]);

  const needsReason =
    targetStatus === LEAD_PROGRESS_STATUS.NO_SHOW || targetStatus === LEAD_PROGRESS_STATUS.LOST;
  const copy = DIALOG_COPY[targetStatus];

  const handleSubmit = async () => {
    const appointmentIso = localInputToIso(appointmentAt);
    if (targetStatus === LEAD_PROGRESS_STATUS.PENDING_VISIT && !appointmentIso) {
      toast.error('请填写预约拜访时间');
      return;
    }
    if (needsReason && !reason.trim()) {
      toast.error(
        targetStatus === LEAD_PROGRESS_STATUS.NO_SHOW ? '请填写毁约原因' : '请填写流失原因'
      );
      return;
    }

    setSubmitting(true);
    try {
      await api.patch(`/customers/${customerId}/lead-progress`, {
        status: targetStatus,
        appointmentAt: appointmentIso,
        reason: reason.trim() || undefined,
        version: currentVersion,
      });
      toast.success(copy.submit.replace('确认', '已').replace('保存', '已保存'));
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            客户：<span className="font-medium">{customerName}</span>
            <br />
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {targetStatus === LEAD_PROGRESS_STATUS.PENDING_VISIT && (
            <div className="space-y-2">
              <Label htmlFor="lead-appointment-at">预约拜访时间</Label>
              <Input
                id="lead-appointment-at"
                type="datetime-local"
                value={appointmentAt}
                onChange={(event) => setAppointmentAt(event.target.value)}
              />
            </div>
          )}
          {needsReason && (
            <div className="space-y-2">
              <Label htmlFor="lead-progress-reason">
                {targetStatus === LEAD_PROGRESS_STATUS.NO_SHOW ? '毁约原因' : '流失原因'}
              </Label>
              <Textarea
                id="lead-progress-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                rows={5}
                placeholder="请填写具体原因，便于后续复盘"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '提交中…' : copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
