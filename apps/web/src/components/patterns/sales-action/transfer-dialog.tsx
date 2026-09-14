/**
 * 销售待办转交弹窗：选择目标员工并填写转交原因。
 */
import type { ISalesActionItemResponse } from '@ky-azeroth/shared/types';
import { useEffect, useState } from 'react';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface TransferDialogProps {
  open: boolean;
  item: ISalesActionItemResponse | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetEmployeeId: string, reason: string) => Promise<void>;
  loading?: boolean;
}

export function TransferDialog({
  open,
  item,
  onOpenChange,
  onConfirm,
  loading = false,
}: TransferDialogProps) {
  const [targetEmployeeId, setTargetEmployeeId] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) {
      setTargetEmployeeId('');
      setReason('');
    }
  }, [open]);

  const handleClose = (next: boolean) => {
    if (!next && loading) return;
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!targetEmployeeId || !trimmed) return;
    await onConfirm(targetEmployeeId, trimmed);
  };

  const canConfirm = Boolean(targetEmployeeId) && Boolean(reason.trim());

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title="转交待办"
      description={item ? `将「${item.title}」转交给新的收件人` : '选择转交对象'}
      desktopMaxWidth="max-w-md"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !canConfirm}>
            {loading ? '转交中...' : '确认转交'}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="space-y-4 py-2">
          <FormField name="targetEmployeeId" label="转交给" required>
            <EmployeeSelect
              value={targetEmployeeId}
              onChange={setTargetEmployeeId}
              placeholder="搜索并选择员工"
              excludeIds={item?.employeeId ? [item.employeeId] : undefined}
            />
          </FormField>
          <FormField name="transferReason" label="转交原因" required>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：该客户已由郑销售接手，本条应由他继续处理"
              rows={4}
              disabled={loading}
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            仅转交本条待办，不会修改客户或商机负责人。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
