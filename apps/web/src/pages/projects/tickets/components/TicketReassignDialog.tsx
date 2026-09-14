import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { EmployeeSelect } from '@/components/patterns/employee-select';
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
import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';
import { api, getErrorMessage } from '@/lib/api';

import type { ProjectTicketProfile } from '../types';

export interface TicketReassignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: ProjectTicketProfile | null;
  onSuccess: () => void;
}

export function TicketReassignDialog({
  open,
  onOpenChange,
  ticket,
  onSuccess,
}: TicketReassignDialogProps) {
  const queryClient = useQueryClient();
  const [assigneeId, setAssigneeId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && ticket) {
      setAssigneeId(ticket.assigneeId);
    } else if (!open) {
      setAssigneeId('');
    }
  }, [open, ticket]);

  const handleSubmit = async () => {
    if (!ticket) return;
    // @validation-ok: 对话框级业务规则检查，非表单字段验证
    if (!assigneeId) {
      toast.error('请选择新的接单人');
      return;
    }
    // @validation-ok: 对话框级业务规则检查，非表单字段验证
    if (assigneeId === ticket.assigneeId) {
      toast.error('新接单人与当前接单人相同');
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
      await api.patch(`/project-tickets/${ticket.id}/assignee`, {
        assigneeId,
        version: ticket.version,
      });
      await invalidateAnalyticsQueries(queryClient, '/project-tickets');
      toast.success('改派成功');
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        toast.error('工单已被其他人修改，请刷新后重试');
        onOpenChange(false);
        onSuccess();
        return;
      }
      toast.error(getErrorMessage(error, '改派失败'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>改派工单</DialogTitle>
          <DialogDescription>选择新的接单人后，系统会通知新接单人。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <div className="font-mono text-xs text-muted-foreground">{ticket.ticketNo}</div>
            <div className="mt-1 font-medium">{ticket.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              当前接单人：{ticket.assignee?.name ?? '-'}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reassign-employee">
              新接单人<span className="ml-1 text-destructive">*</span>
            </Label>
            <EmployeeSelect
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder="搜索并选择新接单人"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '处理中...' : '确认改派'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
