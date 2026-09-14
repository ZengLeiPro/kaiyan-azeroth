import { INVOICE_SUBJECT_PRESETS } from '@ky-azeroth/shared/constants';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

interface SelectedPayment {
  id: string;
  serialNumber?: string | null;
  customerId: string | null | undefined;
  customerName?: string | null;
  saleOrderId: string | null | undefined;
  saleOrderSerialNumber?: string | null;
  direction: string | null | undefined;
  flowStatus: string | null | undefined;
  invoicedByInvoiceId?: string | null;
  paymentAmount: number | string | null | undefined;
}

interface PaymentMergeInvoiceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPayments: SelectedPayment[];
  onSuccess: () => void;
}

interface InvoiceForm {
  subject: string;
  invoiceType: string;
  invoiceDate: string;
  invoiceNumber: string;
  title: string;
  taxIdentifyNum: string;
  itemType: string;
  bankName: string;
  bankAccount: string;
  registeredAddress: string;
  registeredPhone: string;
  remark: string;
}

const EMPTY_INVOICE: InvoiceForm = {
  subject: '',
  invoiceType: '',
  invoiceDate: '',
  invoiceNumber: '',
  title: '',
  taxIdentifyNum: '',
  itemType: '',
  bankName: '',
  bankAccount: '',
  registeredAddress: '',
  registeredPhone: '',
  remark: '',
};

/**
 * 合并开票（v1）：
 * 选 N 条同客户同订单的 IN 回款合并开一张发票。
 *
 * 严格的前端预校验：
 * - 至少 2 条回款
 * - 全部同 customerId
 * - 全部同 saleOrderId
 * - 全部 direction='IN'
 * - 全部 flowStatus='approved'
 * - 全部 invoicedByInvoiceId 为空（未合并过）
 *
 * 任一不符合 → 弹错并指出问题，不调后端。
 */
export function PaymentMergeInvoiceModal({
  open,
  onOpenChange,
  selectedPayments,
  onSuccess,
}: PaymentMergeInvoiceModalProps) {
  const [form, setForm] = useState<InvoiceForm>(EMPTY_INVOICE);
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof InvoiceForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const reset = () => {
    setForm(EMPTY_INVOICE);
    setSubmitting(false);
  };
  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  // 预校验
  const validation = useMemo(() => {
    const issues: string[] = [];
    if (selectedPayments.length < 2) {
      issues.push('合并开票至少需要 2 条回款');
    }
    const customerIds = new Set(
      selectedPayments.map((p) => p.customerId).filter((v): v is string => Boolean(v))
    );
    if (customerIds.size > 1) {
      issues.push('所有回款必须属于同一客户');
    }
    const saleOrderIds = new Set(
      selectedPayments.map((p) => p.saleOrderId).filter((v): v is string => Boolean(v))
    );
    if (saleOrderIds.size > 1) {
      issues.push('所有回款必须属于同一订单（v1 限制）');
    }
    const outItems = selectedPayments.filter((p) => p.direction !== 'IN');
    if (outItems.length > 0) {
      issues.push(`${outItems.length} 条为退款（OUT）记录，不能用于合并开票`);
    }
    const notApproved = selectedPayments.filter((p) => p.flowStatus !== 'approved');
    if (notApproved.length > 0) {
      issues.push(`${notApproved.length} 条回款尚未审批通过，不能合并`);
    }
    const alreadyMerged = selectedPayments.filter((p) => p.invoicedByInvoiceId);
    if (alreadyMerged.length > 0) {
      issues.push(`${alreadyMerged.length} 条回款已合并到其他发票`);
    }

    const totalAmount = selectedPayments.reduce((sum, p) => sum + Number(p.paymentAmount ?? 0), 0);
    const customer = selectedPayments[0]?.customerName ?? '';
    const order = selectedPayments[0]?.saleOrderSerialNumber ?? '';
    return { issues, totalAmount, customer, order, canSubmit: issues.length === 0 };
  }, [selectedPayments]);

  const handleSubmit = async () => {
    if (!validation.canSubmit) return;
    if (!form.subject || !form.invoiceType || !form.invoiceDate) {
      toast.error('请填写业务摘要、发票类型与开票日期');
      return;
    }

    const invoice: Record<string, string> = {
      subject: form.subject,
      invoiceType: form.invoiceType,
      invoiceDate: form.invoiceDate,
    };
    if (form.invoiceNumber) invoice.invoiceNumber = form.invoiceNumber;
    if (form.title) invoice.title = form.title;
    if (form.taxIdentifyNum) invoice.taxIdentifyNum = form.taxIdentifyNum;
    if (form.itemType) invoice.itemType = form.itemType;
    if (form.bankName) invoice.bankName = form.bankName;
    if (form.bankAccount) invoice.bankAccount = form.bankAccount;
    if (form.registeredAddress) invoice.registeredAddress = form.registeredAddress;
    if (form.registeredPhone) invoice.registeredPhone = form.registeredPhone;
    if (form.remark) invoice.remark = form.remark;

    setSubmitting(true);
    try {
      await api.post('/payments/merge-invoice', {
        paymentIds: selectedPayments.map((p) => p.id),
        invoice,
      });
      toast.success('合并开票成功，发票已提交审批');
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, '合并开票失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title="合并开票"
      description={`选 ${selectedPayments.length} 条同客户同订单的 IN 回款合并开一张发票`}
      desktopMaxWidth="max-w-2xl"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !validation.canSubmit}>
            {submitting ? '提交中...' : '提交合并开票'}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="space-y-4 py-2">
          {/* 校验结果 */}
          {validation.issues.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <p className="font-medium">不能合并开票：</p>
              <ul className="mt-1 list-disc pl-5">
                {validation.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">客户：</span>
                  <span className="font-medium">{validation.customer || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">订单：</span>
                  <span className="font-medium">{validation.order || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">合计金额：</span>
                  <span className="font-semibold">¥{validation.totalAmount.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">合并回款数：</span>
                  <span className="font-medium">{selectedPayments.length}</span>
                </div>
              </div>
            </div>
          )}

          {/* 发票字段 */}
          {validation.canSubmit && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormField name="subject" label="业务摘要" required className="md:col-span-2">
                <>
                  <Input
                    value={form.subject}
                    onChange={(e) => update('subject', e.target.value)}
                    list="merge-invoice-subject-presets"
                    placeholder="选预设或自定义（如：软件开发服务费 / 钉钉软件费）"
                    maxLength={100}
                  />
                  <datalist id="merge-invoice-subject-presets">
                    {INVOICE_SUBJECT_PRESETS.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </>
              </FormField>
              <FormField name="invoiceType" label="发票类型" required>
                <Input
                  value={form.invoiceType}
                  onChange={(e) => update('invoiceType', e.target.value)}
                  placeholder="如：增值税专用发票"
                />
              </FormField>
              <FormField name="invoiceDate" label="开票日期" required>
                <DatePicker
                  date={form.invoiceDate ? new Date(form.invoiceDate) : undefined}
                  onDateChange={(d) => update('invoiceDate', d ? d.toISOString() : '')}
                  placeholder="选择开票日期"
                  dateFormat="yyyy-MM-dd"
                />
              </FormField>
              <FormField name="invoiceNumber" label="发票号码">
                <Input
                  value={form.invoiceNumber}
                  onChange={(e) => update('invoiceNumber', e.target.value)}
                />
              </FormField>
              <FormField name="itemType" label="项目类型">
                <Input value={form.itemType} onChange={(e) => update('itemType', e.target.value)} />
              </FormField>
              <FormField name="title" label="抬头" className="md:col-span-2">
                <Input value={form.title} onChange={(e) => update('title', e.target.value)} />
              </FormField>
              <FormField name="taxIdentifyNum" label="税号">
                <Input
                  value={form.taxIdentifyNum}
                  onChange={(e) => update('taxIdentifyNum', e.target.value)}
                />
              </FormField>
              <FormField name="bankName" label="开户行">
                <Input value={form.bankName} onChange={(e) => update('bankName', e.target.value)} />
              </FormField>
              <FormField name="bankAccount" label="银行账号" className="md:col-span-2">
                <Input
                  value={form.bankAccount}
                  onChange={(e) => update('bankAccount', e.target.value)}
                />
              </FormField>
              <FormField name="registeredAddress" label="注册地址" className="md:col-span-2">
                <Input
                  value={form.registeredAddress}
                  onChange={(e) => update('registeredAddress', e.target.value)}
                />
              </FormField>
              <FormField name="registeredPhone" label="注册电话">
                <Input
                  value={form.registeredPhone}
                  onChange={(e) => update('registeredPhone', e.target.value)}
                />
              </FormField>
              <FormField name="remark" label="备注" className="md:col-span-2">
                <Textarea
                  value={form.remark}
                  onChange={(e) => update('remark', e.target.value)}
                  rows={2}
                />
              </FormField>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            提交后将创建一张新发票并自动走标准审批流；被合并的回款将标记为"已合并到发票 X"。
            若审批被驳回或撤回，回款的合并标记会自动清除以便重新选。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
