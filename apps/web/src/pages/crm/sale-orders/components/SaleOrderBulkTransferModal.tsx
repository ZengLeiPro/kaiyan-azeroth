import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { api, getErrorMessage } from '@/lib/api';

import { buildSaleOrderBulkTransferPayload } from './sale-order-bulk-payload';

interface SaleOrderBulkTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

/**
 * 批量更换订单负责人（需要 sale_orders.edit 且 viewScope=ALL，后端另要求 fresh JWT）。
 *
 * 与客户页批量转交的差异：
 * - 订单无协作人概念，纯粹改 chargerId
 * - 历史业绩归属保留：原 chargerId 已记录在审批记录与回款/发票的 chargerId 里
 *   （事件级负责人默认固化）
 */
export function SaleOrderBulkTransferModal({
  open,
  onOpenChange,
  orderIds,
  versions,
  onSuccess,
}: SaleOrderBulkTransferModalProps) {
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
        '/sale-orders/batch-transfer',
        buildSaleOrderBulkTransferPayload(orderIds, versions, chargerId)
      );
      const skippedCount = data.skipped?.length ?? 0;
      if (skippedCount > 0) {
        toast.success(`已转交 ${data.success} 项，跳过 ${skippedCount} 项`);
      } else {
        toast.success(`已转交 ${data.success} 项`);
      }
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
      title="批量更换订单负责人"
      description={`将选中的 ${orderIds.length} 个订单转交给新负责人（仅具备对应管理权限）`}
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
          <p className="text-xs text-muted-foreground">
            订单历史业绩归属（已通过的审批、回款、发票的 chargerId）保留不变。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
