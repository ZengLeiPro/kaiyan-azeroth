import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

interface PaymentBulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

interface FormState {
  paymentType: string;
  businessDate: string;
  payer: string;
  bankName: string;
  tradeSerialNumber: string;
  remark: string;
}

const EMPTY_FORM: FormState = {
  paymentType: '',
  businessDate: '',
  payer: '',
  bankName: '',
  tradeSerialNumber: '',
  remark: '',
};

/**
 * 批量编辑回款：弱字段白名单。
 * 金额/方向/客户/订单/审批/退款字段一律禁批改。
 */
export function PaymentBulkEditModal({
  open,
  onOpenChange,
  paymentIds,
  versions,
  onSuccess,
}: PaymentBulkEditModalProps) {
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
    if (form.paymentType) patch.paymentType = form.paymentType;
    if (form.businessDate) patch.businessDate = form.businessDate;
    if (form.payer) patch.payer = form.payer;
    if (form.bankName) patch.bankName = form.bankName;
    if (form.tradeSerialNumber) patch.tradeSerialNumber = form.tradeSerialNumber;
    if (form.remark) patch.remark = form.remark;

    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        '/payments/batch-update',
        { ids: paymentIds, versions, patch }
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
      title="批量编辑回款"
      description={`仅可批量修改下列字段（共选中 ${paymentIds.length} 个回款）`}
      desktopMaxWidth="max-w-xl"
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
          <FormField name="paymentType" label="收款方式">
            <Input
              value={form.paymentType}
              onChange={(e) => update('paymentType', e.target.value)}
              placeholder="留空=不修改"
            />
          </FormField>
          <FormField name="businessDate" label="业务日期">
            <DatePicker
              date={form.businessDate ? new Date(form.businessDate) : undefined}
              onDateChange={(d) => update('businessDate', d ? d.toISOString() : '')}
              placeholder="留空=不修改"
              dateFormat="yyyy-MM-dd"
            />
          </FormField>
          <FormField name="payer" label="付款人">
            <Input
              value={form.payer}
              onChange={(e) => update('payer', e.target.value)}
              placeholder="留空=不修改"
            />
          </FormField>
          <FormField name="bankName" label="账户">
            <Input
              value={form.bankName}
              onChange={(e) => update('bankName', e.target.value)}
              placeholder="留空=不修改"
            />
          </FormField>
          <FormField name="tradeSerialNumber" label="交易流水号" className="md:col-span-2">
            <Input
              value={form.tradeSerialNumber}
              onChange={(e) => update('tradeSerialNumber', e.target.value)}
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
            保持留空的字段在提交时不会改变原值。金额/方向/审批状态/客户等字段禁止批量改。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
