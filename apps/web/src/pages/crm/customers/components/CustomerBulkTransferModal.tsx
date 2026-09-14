import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { api, getErrorMessage } from '@/lib/api';

interface CustomerBulkTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

function buildCustomerBulkTransferPayload(
  customerIds: string[],
  versions: Record<string, number>,
  chargerId: string
) {
  return { ids: customerIds, versions, chargerId };
}

/**
 * 批量转交客户负责人
 *
 * 转交逻辑（2026-05-18 决策）：
 * - 协作人保留不变
 * - 但若新负责人原本在协作人列表里，自动将其从协作人移除（避免「既是负责人又是协作人」）
 * - 由后端 batchTransfer service 一次性处理
 */
export function CustomerBulkTransferModal({
  open,
  onOpenChange,
  customerIds,
  versions,
  onSuccess,
}: CustomerBulkTransferModalProps) {
  const [chargerId, setChargerId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const hasExactVersions =
    customerIds.length > 0 &&
    Object.keys(versions).length === customerIds.length &&
    customerIds.every((id) => Number.isInteger(versions[id]) && (versions[id] ?? 0) >= 1);

  const reset = () => {
    setChargerId('');
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    // @validation-ok: 这是所选实体的并发快照完整性检查，不是表单字段校验。
    if (!hasExactVersions) {
      toast.error('所选客户版本信息不完整，请刷新列表后重试');
      return;
    }
    // UI 防呆已由按钮 disabled 兜底；零值仍能进来时由后端 zod schema 拦截并 toast 错误信息
    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        '/customers/batch-transfer',
        buildCustomerBulkTransferPayload(customerIds, versions, chargerId)
      );
      const skippedCount = data.skipped?.length ?? 0;
      if (skippedCount > 0) {
        toast.success(`已转交 ${data.success} 项，跳过 ${skippedCount} 项（权限不足或已删除）`);
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
      title="批量转交"
      description={`将选中的 ${customerIds.length} 个客户转交给新负责人`}
      desktopMaxWidth="max-w-md"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !chargerId || !hasExactVersions}>
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
            原协作人保留；若新负责人本身在协作人中，将自动从协作人移除。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
