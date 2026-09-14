import {
  PROJECT_TICKET_STATUS,
  PROJECT_TICKET_STATUS_LABELS,
  type ProjectTicketStatusValue,
} from '@ky-azeroth/shared/constants/project-ticket-constants';
import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
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
import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';
import { api, getErrorMessage } from '@/lib/api';

import type { ProjectTicketProfile } from '../types';

export interface TicketTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: ProjectTicketProfile | null;
  toStatus: ProjectTicketStatusValue | null;
  onSuccess: () => void;
}

interface TransitionCopy {
  title: string;
  description: string;
  noteField: 'completionNote' | 'closeNote' | 'cancelReason' | null;
  noteLabel: string;
  noteRequired: boolean;
  notePlaceholder: string;
}

function getTransitionCopy(toStatus: ProjectTicketStatusValue | null): TransitionCopy | null {
  if (!toStatus) return null;
  switch (toStatus) {
    case PROJECT_TICKET_STATUS.IN_PROGRESS:
      return {
        title: '开始处理',
        description: '确认接单后，工单将进入"处理中"状态。',
        noteField: null,
        noteLabel: '',
        noteRequired: false,
        notePlaceholder: '',
      };
    case PROJECT_TICKET_STATUS.COMPLETED:
      return {
        title: '完成工单',
        description: '请填写完成说明，提交后项目经理可验证并关闭。',
        noteField: 'completionNote',
        noteLabel: '完成说明',
        noteRequired: true,
        notePlaceholder: '请描述处理结果或解决方案',
      };
    case PROJECT_TICKET_STATUS.CLOSED:
      return {
        title: '关闭工单',
        description: '关闭后将进入终态，不可再流转。',
        noteField: 'closeNote',
        noteLabel: '关闭说明',
        noteRequired: false,
        notePlaceholder: '可选：补充关闭说明',
      };
    case PROJECT_TICKET_STATUS.CANCELLED:
      return {
        title: '取消工单',
        description: '取消后将进入终态，不可再流转。',
        noteField: 'cancelReason',
        noteLabel: '取消原因',
        noteRequired: true,
        notePlaceholder: '请说明取消原因',
      };
    default:
      return null;
  }
}

export function TicketTransitionDialog({
  open,
  onOpenChange,
  ticket,
  toStatus,
  onSuccess,
}: TicketTransitionDialogProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const copy = getTransitionCopy(toStatus);

  useEffect(() => {
    if (open) {
      setNote('');
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!ticket || !toStatus || !copy) return;
    if (copy.noteField && copy.noteRequired && !note.trim()) {
      toast.error(`请填写${copy.noteLabel}`);
      return;
    }
    if (!Number.isInteger(ticket.version) || (ticket.version ?? 0) < 1) {
      toast.error('工单数据版本缺失，请刷新后重试');
      onOpenChange(false);
      onSuccess();
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        toStatus,
        version: ticket.version,
      };
      if (copy.noteField) {
        payload[copy.noteField] = note.trim() || null;
      }

      await api.patch(`/project-tickets/${ticket.id}/status`, payload);
      await invalidateAnalyticsQueries(queryClient, '/project-tickets');
      toast.success(`已${copy.title}`);
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        toast.error('工单已被其他人修改，请刷新后重试');
        onOpenChange(false);
        onSuccess();
        return;
      }
      toast.error(getErrorMessage(error, '操作失败'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!ticket || !toStatus || !copy) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <div className="font-mono text-xs text-muted-foreground">{ticket.ticketNo}</div>
            <div className="mt-1 font-medium">{ticket.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              当前状态：
              {PROJECT_TICKET_STATUS_LABELS[ticket.status as ProjectTicketStatusValue] ??
                ticket.status}
              {' → '}目标状态：{PROJECT_TICKET_STATUS_LABELS[toStatus]}
            </div>
          </div>

          {copy.noteField && (
            <div className="space-y-2">
              <Label htmlFor="transition-note">
                {copy.noteLabel}
                {copy.noteRequired && <span className="ml-1 text-destructive">*</span>}
              </Label>
              <Textarea
                id="transition-note"
                placeholder={copy.notePlaceholder}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '处理中...' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
