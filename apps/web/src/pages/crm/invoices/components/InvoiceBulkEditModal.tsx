import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

interface InvoiceBulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

interface FormState {
  invoiceType: string;
  invoiceDate: string;
  itemType: string;
  remark: string;
}

const EMPTY_FORM: FormState = {
  invoiceType: '',
  invoiceDate: '',
  itemType: '',
  remark: '',
};

/**
 * 批量编辑发票：仅 4 个低风险字段。
 * 抬头/税号/银行/地址/电话等法定字段默认禁批改（错改风险大）。
 * 金额/发票号/客户/订单/审批/状态一律禁批改。
 */
export function InvoiceBulkEditModal({
  open,
  onOpenChange,
  invoiceIds,
  versions,
  onSuccess,
}: InvoiceBulkEditModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setForm(EMPTY_FORM);
    setSubmitting(false);
  };
  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };
  const update = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const hasAnyChange = Object.values(form).some((v) => v !== '');

  const handleSubmit = async () => {
    const patch: Record<string, string> = {};
    if (form.invoiceType) patch.invoiceType = form.invoiceType;
    if (form.invoiceDate) patch.invoiceDate = form.invoiceDate;
    if (form.itemType) patch.itemType = form.itemType;
    if (form.remark) patch.remark = form.remark;

    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        '/invoices/batch-update',
        { ids: invoiceIds, versions, patch }
      );
      const skippedCount = data.skipped?.length ?? 0;
      toast.success(
        skippedCount > 0
          ? `已编辑 ${data.success} 项，跳过 ${skippedCount} 项（权限不足、记录已删除，或已通过需单独发起变更审批）`
          : `已编辑 ${data.success} 项`
      );
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, '批量编辑失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title="批量编辑发票"
      description={`仅可批量修改下列字段（共选中 ${invoiceIds.length} 张发票）`}
      desktopMaxWidth="max-w-lg"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !hasAnyChange}>
            {submitting ? '保存中...' : '确认修改'}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="grid grid-cols-1 gap-4 py-2 md:grid-cols-2">
          <FormField name="invoiceType" label="发票类型">
            <Input
              value={form.invoiceType}
              onChange={(e) => update('invoiceType', e.target.value)}
              placeholder="留空=不修改"
            />
          </FormField>
          <FormField name="invoiceDate" label="开票日期">
            <DatePicker
              date={form.invoiceDate ? new Date(form.invoiceDate) : undefined}
              onDateChange={(d) => update('invoiceDate', d ? d.toISOString() : '')}
              placeholder="留空=不修改"
              dateFormat="yyyy-MM-dd"
            />
          </FormField>
          <FormField name="itemType" label="项目类型" className="md:col-span-2">
            <Input
              value={form.itemType}
              onChange={(e) => update('itemType', e.target.value)}
              placeholder="留空=不修改"
            />
          </FormField>
          <FormField name="remark" label="备注" className="md:col-span-2">
            <Textarea
              value={form.remark}
              onChange={(e) => update('remark', e.target.value)}
              placeholder="留空=不修改"
              rows={3}
            />
          </FormField>
          <p className="text-xs text-muted-foreground md:col-span-2">
            抬头/税号/银行/地址/电话默认禁批改（法定字段错改风险大）；如需变更请单条编辑。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
