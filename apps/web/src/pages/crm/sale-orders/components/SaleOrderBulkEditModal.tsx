import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

import { buildSaleOrderBulkEditPayload, toSaleOrderBulkDateOnly } from './sale-order-bulk-payload';

interface SaleOrderBulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

interface BulkEditFormState {
  orderTitle: string;
  orderBeginDate: string;
  orderEndDate: string;
  paymentDate: string;
  businessDate: string;
  remark: string;
}

const EMPTY_FORM: BulkEditFormState = {
  orderTitle: '',
  orderBeginDate: '',
  orderEndDate: '',
  paymentDate: '',
  businessDate: '',
  remark: '',
};

function fromSaleOrderBulkDateOnly(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * 批量编辑订单：仅"客观约束外"的弱字段。
 * 金额/客户/订单关系/审批状态/派生字段一律禁批改。
 * 空值/未填 = 不动该字段；至少需填一个才能提交。
 */
export function SaleOrderBulkEditModal({
  open,
  onOpenChange,
  orderIds,
  versions,
  onSuccess,
}: SaleOrderBulkEditModalProps) {
  const [form, setForm] = useState<BulkEditFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setForm(EMPTY_FORM);
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const update = (field: keyof BulkEditFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const hasAnyChange = Object.values(form).some((v) => v !== '');

  const handleSubmit = async () => {
    const patch: Record<string, string> = {};
    if (form.orderTitle) patch.orderTitle = form.orderTitle;
    if (form.orderBeginDate) patch.orderBeginDate = form.orderBeginDate;
    if (form.orderEndDate) patch.orderEndDate = form.orderEndDate;
    if (form.paymentDate) patch.paymentDate = form.paymentDate;
    if (form.businessDate) patch.businessDate = form.businessDate;
    if (form.remark) patch.remark = form.remark;

    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        '/sale-orders/batch-update',
        buildSaleOrderBulkEditPayload(orderIds, versions, patch)
      );
      const skippedCount = data.skipped?.length ?? 0;
      if (skippedCount > 0) {
        toast.success(
          `已编辑 ${data.success} 项，跳过 ${skippedCount} 项（权限不足、记录已删除，或已通过需单独发起变更审批）`
        );
      } else {
        toast.success(`已编辑 ${data.success} 项`);
      }
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
      title="批量编辑订单"
      description={`仅可批量修改下列字段（共选中 ${orderIds.length} 个订单）`}
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
          <FormField name="orderTitle" label="合同标题">
            <Input
              value={form.orderTitle}
              onChange={(e) => update('orderTitle', e.target.value)}
              placeholder="留空=不修改"
            />
          </FormField>
          <FormField name="businessDate" label="业务日期">
            <DatePicker
              date={fromSaleOrderBulkDateOnly(form.businessDate)}
              onDateChange={(d) => update('businessDate', d ? toSaleOrderBulkDateOnly(d) : '')}
              placeholder="留空=不修改"
              dateFormat="yyyy-MM-dd"
            />
          </FormField>
          <FormField name="orderBeginDate" label="合同开始日期">
            <DatePicker
              date={fromSaleOrderBulkDateOnly(form.orderBeginDate)}
              onDateChange={(d) => update('orderBeginDate', d ? toSaleOrderBulkDateOnly(d) : '')}
              placeholder="留空=不修改"
              dateFormat="yyyy-MM-dd"
            />
          </FormField>
          <FormField name="orderEndDate" label="合同结束日期">
            <DatePicker
              date={fromSaleOrderBulkDateOnly(form.orderEndDate)}
              onDateChange={(d) => update('orderEndDate', d ? toSaleOrderBulkDateOnly(d) : '')}
              placeholder="留空=不修改"
              dateFormat="yyyy-MM-dd"
            />
          </FormField>
          <FormField name="paymentDate" label="付款日期">
            <DatePicker
              date={fromSaleOrderBulkDateOnly(form.paymentDate)}
              onDateChange={(d) => update('paymentDate', d ? toSaleOrderBulkDateOnly(d) : '')}
              placeholder="留空=不修改"
              dateFormat="yyyy-MM-dd"
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
            保持留空的字段在提交时不会改变原值。金额/客户/审批等字段已被禁止批量改。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
