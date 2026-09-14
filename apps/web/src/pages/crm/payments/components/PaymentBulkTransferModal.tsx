import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { api, getErrorMessage } from '@/lib/api';

interface PaymentBulkTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

/**
 * 批量更换回款负责人（仅具备对应管理权限 可用）。
 * 历史业绩归属在审批/发票/订单维度的 chargerId 保留不变。
 */
export function PaymentBulkTransferModal({
  open,
  onOpenChange,
  paymentIds,
  versions,
  onSuccess,
}: PaymentBulkTransferModalProps) {
  const [chargerId, setChargerId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setChargerId('');
    setSubmitting(false);
  };
  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        '/payments/batch-transfer',
        { ids: paymentIds, versions, chargerId }
      );
      const skippedCount = data.skipped?.length ?? 0;
      toast.success(
        skippedCount > 0
          ? `已转交 ${data.success} 项，跳过 ${skippedCount} 项`
          : `已转交 ${data.success} 项`
      );
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, '批量转交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title="批量更换回款负责人"
      description={`将选中的 ${paymentIds.length} 个回款转交给新负责人（仅具备对应管理权限）`}
      desktopMaxWidth="max-w-md"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !chargerId}>
            {submitting ? '转交中...' : '确认转交'}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="space-y-4 py-2">
          <FormField name="chargerId" label="新负责人" required>
            <EmployeeSelect
              value={chargerId}
              onChange={setChargerId}
              placeholder="搜索并选择新负责人"
            />
          </FormField>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
