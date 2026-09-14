/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { APPROVAL_EVENT_TYPE, INVOICE_SUBJECT_PRESETS } from '@ky-azeroth/shared/constants';
import {
  INVOICE_ITEM_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  INVOICE_TYPE_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import type { IInvoiceResponse } from '@ky-azeroth/shared/types/invoice';
import type { SaleOrderForSelection } from '@ky-azeroth/shared/types/sale-order';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import {
  type BusinessApprovalContext,
  normalizeBusinessApprovalContext,
} from '@/components/patterns/business-approval-context';
import { BusinessApprovalFallback } from '@/components/patterns/business-approval-fallback';
import { BusinessApprovalSection } from '@/components/patterns/business-approval-section';
import { CustomerSelect } from '@/components/patterns/customer-select';
import { DrawerCreateShell } from '@/components/patterns/drawer-create-shell';
import {
  EntityDetailBody,
  registerEntityDetail,
  useDrawerStack,
  useEntityHeaderActions,
} from '@/components/patterns/drawer-stack';
import { FormField, useFormMode } from '@/components/patterns/form-field';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { SaleOrderSelect } from '@/components/patterns/sale-order-select';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { MultiSelect, Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerCreate } from '@/hooks/use-drawer-create';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { api } from '@/lib/api';
import {
  formatDateDisplay,
  formatDateToLocalDateString,
  getTodayDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import { getStatusColor, getStatusLabel, invoiceStatusMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';

import {
  buildInvoicePrefillClears,
  buildInvoicePrefillUpdates,
  extractInvoicePrefillValues,
  hasInvoicePrefillValues,
  type InvoicePrefillField,
  type InvoicePrefillValues,
} from './invoice-prefill';
import {
  type InvoiceFormData,
  invoiceFormSchema,
  type InvoiceProfile,
  parseInvoiceSubjects,
  serializeInvoiceSubjects,
  toInvoiceFormData,
  toInvoicePayload,
  toInvoiceProfile,
} from './types';

const invoiceStatusOptions = Object.entries(INVOICE_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const invoiceTypeOptions = Object.entries(INVOICE_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const invoiceItemTypeOptions = Object.entries(INVOICE_ITEM_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function getUninvoicedAmount(order: SaleOrderForSelection | null | undefined): number | null {
  if (order?.orderAmount == null) return null;
  const orderAmount = Number(order.orderAmount);
  const invoicedAmount = Number(order.invoicedAmount ?? 0);
  if (!Number.isFinite(orderAmount) || !Number.isFinite(invoicedAmount)) return null;
  return Math.max(Math.round((orderAmount - invoicedAmount) * 100) / 100, 0);
}

function getStatusBadge(status: string | null | undefined) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  const label = getStatusLabel(status, invoiceStatusMap);
  const color = getStatusColor(status, invoiceStatusMap);
  return <Badge className={cn(color, `hover:${color}`)}>{label}</Badge>;
}

export interface InvoiceFieldsProps {
  entity: InvoiceProfile | null;
  formData: InvoiceFormData;
  updateFormField: <K extends keyof InvoiceFormData>(key: K, value: InvoiceFormData[K]) => void;
  getFieldError: (key: keyof InvoiceFormData) => string | undefined;
}

interface InvoiceListResponse {
  items?: IInvoiceResponse[];
}

function applyPrefillChanges(
  changes: Partial<InvoicePrefillValues>,
  updateFormField: InvoiceFieldsProps['updateFormField']
) {
  (Object.entries(changes) as [InvoicePrefillField, string | null][]).forEach(([field, value]) => {
    updateFormField(field, value);
  });
}

function InvoicePrefillController({ entity, formData, updateFormField }: InvoiceFieldsProps) {
  const customerId = formData.customerId || '';
  const previousCustomerIdRef = useRef<string>('');
  const previousTemplateRef = useRef<InvoicePrefillValues | null>(null);
  const lastAppliedTemplateKeyRef = useRef<string>('');

  const { data: latestInvoice } = useQuery({
    queryKey: ['invoice-prefill', customerId],
    enabled: !entity && Boolean(customerId),
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const response = await api.get<InvoiceListResponse>('/invoices', {
        params: { customerId, page: 1, pageSize: 10 },
      });
      return response.data.items?.find((invoice) => hasInvoicePrefillValues(invoice)) ?? null;
    },
  });

  useEffect(() => {
    if (entity) return;
    if (previousCustomerIdRef.current === customerId) return;

    previousCustomerIdRef.current = customerId;
    lastAppliedTemplateKeyRef.current = '';

    const previousTemplate = previousTemplateRef.current;
    if (!previousTemplate) return;

    const clears = buildInvoicePrefillClears(formData, previousTemplate);
    previousTemplateRef.current = null;
    applyPrefillChanges(clears, updateFormField);
  }, [customerId, entity, formData, updateFormField]);

  useEffect(() => {
    if (entity || !customerId || !latestInvoice) return;

    const templateKey = `${customerId}:${latestInvoice.id}`;
    if (lastAppliedTemplateKeyRef.current === templateKey) return;

    const template = extractInvoicePrefillValues(latestInvoice);
    const updates = buildInvoicePrefillUpdates(formData, template, previousTemplateRef.current);

    previousTemplateRef.current = template;
    lastAppliedTemplateKeyRef.current = templateKey;
    applyPrefillChanges(updates, updateFormField);
  }, [customerId, entity, formData, latestInvoice, updateFormField]);

  return null;
}

function SaleOrderField({
  value,
  customerId,
  saleOrderId,
  viewName,
  onChange,
  onSelectOrder,
  error,
}: {
  value: string;
  customerId: string;
  saleOrderId?: string | null;
  viewName?: string;
  onChange: (v: string) => void;
  onSelectOrder: (order: SaleOrderForSelection | null) => void;
  error?: string;
}) {
  const { mode } = useFormMode();
  const isView = mode === 'view';
  return (
    <FormField
      name="saleOrderId"
      label="合同订单"
      required
      error={error}
      viewContent={<RelatedEntityLink entityType="sale-order" id={saleOrderId} label={viewName} />}
    >
      <SaleOrderSelect
        value={value}
        onChange={onChange}
        onSelect={onSelectOrder}
        customerId={customerId}
        amountHint="uninvoiced"
        disabled={isView}
      />
    </FormField>
  );
}

export function renderInvoiceFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
}: InvoiceFieldsProps) {
  return (
    <>
      <InvoicePrefillController
        entity={entity}
        formData={formData}
        updateFormField={updateFormField}
        getFieldError={getFieldError}
      />

      <SaleOrderField
        value={formData.saleOrderId}
        customerId={formData.customerId ?? ''}
        saleOrderId={entity?.saleOrder?.id ?? formData.saleOrderId}
        viewName={entity?.saleOrder?.serialNumber}
        onChange={(v) => updateFormField('saleOrderId', v)}
        onSelectOrder={(order) => {
          if (!order) {
            if (!entity) updateFormField('invoiceAmount', 0);
            return;
          }
          if (order.customerId) {
            updateFormField('customerId', order.customerId);
          }
          const uninvoicedAmount = getUninvoicedAmount(order);
          if (uninvoicedAmount != null && !entity) {
            updateFormField('invoiceAmount', uninvoicedAmount);
          }
        }}
        error={getFieldError('saleOrderId')}
      />

      <FormField
        name="subject"
        label="业务摘要"
        required
        error={getFieldError('subject')}
        viewContent={formData.subject || undefined}
      >
        <div className="space-y-2">
          <MultiSelect
            options={[
              ...INVOICE_SUBJECT_PRESETS,
              ...parseInvoiceSubjects(formData.subject).filter(
                (subject) => !INVOICE_SUBJECT_PRESETS.some((preset) => preset === subject)
              ),
            ].map((value) => ({ value, label: value }))}
            value={parseInvoiceSubjects(formData.subject)}
            onChange={(values) => updateFormField('subject', serializeInvoiceSubjects(values))}
            placeholder="请选择业务摘要（可多选）"
          />
          <Input
            id="invoice-subject"
            placeholder="可直接编辑或补充自定义摘要，多个摘要用“、”分隔"
            maxLength={100}
            value={formData.subject ?? ''}
            onChange={(e) => updateFormField('subject', e.target.value)}
          />
        </div>
      </FormField>

      <FormField
        name="customerId"
        label="客户"
        required
        error={getFieldError('customerId')}
        viewContent={
          <RelatedEntityLink
            entityType="customer"
            id={entity?.customer?.id ?? formData.customerId}
            label={entity?.customer?.customerName}
          />
        }
      >
        <CustomerSelect
          value={formData.customerId ?? ''}
          onChange={(v) => updateFormField('customerId', v)}
        />
      </FormField>

      <FormField
        name="invoiceAmount"
        label="发票金额"
        required
        error={getFieldError('invoiceAmount')}
        viewContent={
          formData.invoiceAmount != null && !Number.isNaN(Number(formData.invoiceAmount))
            ? Number(formData.invoiceAmount).toFixed(2)
            : undefined
        }
      >
        <Input
          id="invoiceAmount"
          type="number"
          step="0.01"
          placeholder="请输入发票金额"
          value={formData.invoiceAmount}
          onChange={(e) => updateFormField('invoiceAmount', Number(e.target.value))}
        />
      </FormField>

      <FormField
        name="invoiceType"
        label="发票类型"
        required
        error={getFieldError('invoiceType')}
        viewContent={
          invoiceTypeOptions.find((o) => o.value === formData.invoiceType)?.label ||
          formData.invoiceType
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...invoiceTypeOptions]}
          value={formData.invoiceType || ''}
          onValueChange={(v) => updateFormField('invoiceType', v || null)}
        />
      </FormField>

      <FormField
        name="invoiceDate"
        label="开票日期"
        required
        error={getFieldError('invoiceDate')}
        viewContent={formatDateDisplay(formData.invoiceDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.invoiceDate)}
          onDateChange={(d) =>
            updateFormField('invoiceDate', d ? formatDateToLocalDateString(d) : null)
          }
          className="w-full"
        />
      </FormField>

      <FormField
        name="invoiceNumber"
        label="发票号码"
        error={getFieldError('invoiceNumber')}
        viewContent={formData.invoiceNumber}
      >
        <Input
          id="invoiceNumber"
          placeholder="请输入发票号码"
          value={formData.invoiceNumber || ''}
          onChange={(e) => updateFormField('invoiceNumber', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="title"
        label="发票抬头"
        error={getFieldError('title')}
        viewContent={formData.title}
      >
        <Input
          id="title"
          placeholder="请输入发票抬头"
          value={formData.title || ''}
          onChange={(e) => updateFormField('title', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="taxIdentifyNum"
        label="纳税识别号"
        error={getFieldError('taxIdentifyNum')}
        viewContent={formData.taxIdentifyNum}
      >
        <Input
          id="taxIdentifyNum"
          placeholder="请输入纳税识别号"
          value={formData.taxIdentifyNum || ''}
          onChange={(e) => updateFormField('taxIdentifyNum', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="invoiceStatus"
        label="开票状态"
        error={getFieldError('invoiceStatus')}
        viewContent={getStatusBadge(formData.invoiceStatus ?? null)}
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...invoiceStatusOptions]}
          value={formData.invoiceStatus || ''}
          onValueChange={(v) => updateFormField('invoiceStatus', v || null)}
        />
      </FormField>

      <FormField
        name="itemType"
        label="发票项目"
        error={getFieldError('itemType')}
        viewContent={
          invoiceItemTypeOptions.find((o) => o.value === formData.itemType)?.label ||
          formData.itemType
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...invoiceItemTypeOptions]}
          value={formData.itemType || ''}
          onValueChange={(v) => updateFormField('itemType', v || null)}
        />
      </FormField>

      <FormField
        name="bankName"
        label="开户银行"
        error={getFieldError('bankName')}
        viewContent={formData.bankName}
      >
        <Input
          id="invoiceBankName"
          placeholder="请输入开户银行"
          value={formData.bankName || ''}
          onChange={(e) => updateFormField('bankName', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="bankAccount"
        label="银行账号"
        error={getFieldError('bankAccount')}
        viewContent={formData.bankAccount}
      >
        <Input
          id="bankAccount"
          placeholder="请输入银行账号"
          value={formData.bankAccount || ''}
          onChange={(e) => updateFormField('bankAccount', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="registeredAddress"
        label="注册地址"
        fullRow
        error={getFieldError('registeredAddress')}
        viewContent={formData.registeredAddress}
      >
        <Input
          id="registeredAddress"
          placeholder="请输入注册地址"
          value={formData.registeredAddress || ''}
          onChange={(e) => updateFormField('registeredAddress', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="registeredPhone"
        label="注册电话"
        error={getFieldError('registeredPhone')}
        viewContent={formData.registeredPhone}
      >
        <Input
          id="registeredPhone"
          placeholder="请输入注册电话"
          value={formData.registeredPhone || ''}
          onChange={(e) => updateFormField('registeredPhone', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="remark"
        label="备注"
        fullRow
        error={getFieldError('remark')}
        viewContent={formData.remark}
      >
        <Textarea
          id="remark"
          placeholder="请输入备注"
          className="min-h-24 resize-y"
          value={formData.remark || ''}
          onChange={(e) => updateFormField('remark', e.target.value || null)}
        />
      </FormField>
    </>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：发票详情视图
// ============================================================================

function InvoiceDetailView({
  id,
  approvalContext,
}: {
  id: string;
  approvalContext?: BusinessApprovalContext;
}) {
  const crud = useDrawerEntityDetail<IInvoiceResponse, InvoiceFormData>({
    endpoint: '/invoices',
    id,
    entityType: 'invoice',
    schema: invoiceFormSchema,
    toFormData: (data) => toInvoiceFormData(toInvoiceProfile(data)),
    toPayload: toInvoicePayload,
    // entityNameOf 不传 → useDrawerEntityDetail 默认走 getEntityDisplayName('invoice', e, 'long')
  });
  useEntityHeaderActions(crud);

  if (crud.error && approvalContext?.approvalInstanceId) {
    return (
      <BusinessApprovalFallback
        approvalContext={approvalContext}
        defaultEventType={APPROVAL_EVENT_TYPE.INVOICE_APPROVE}
        formId={id}
        onRetry={crud.refetch}
      />
    );
  }

  return (
    <EntityDetailBody
      mode={crud.mode}
      loading={crud.loading}
      error={crud.error}
      hasData={!!crud.data}
      onRetry={crud.refetch}
      deleteConfirmProps={crud.deleteConfirmProps}
      notFoundHint="发票记录不存在"
      changeLogTarget={{ module: 'invoices', target: id }}
    >
      <>
        <BusinessApprovalSection
          eventType={APPROVAL_EVENT_TYPE.INVOICE_APPROVE}
          formId={id}
          flowStatus={crud.data?.flowStatus}
          approvalInstanceId={approvalContext?.approvalInstanceId}
          approvalEventType={approvalContext?.approvalEventType}
          onApprovalSuccess={approvalContext?.onApprovalSuccess}
          onSuccess={crud.refetch}
          className="col-span-2"
        />
        {renderInvoiceFields({
          entity: crud.data ? toInvoiceProfile(crud.data) : null,
          formData: crud.formData,
          updateFormField: crud.updateFormField,
          getFieldError: crud.getFieldError,
        })}
      </>
    </EntityDetailBody>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：发票创建视图
// ============================================================================

function InvoiceCreateView({ presets }: { presets?: Record<string, unknown> }) {
  const drawerStack = useDrawerStack();
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';
  const presetSaleOrderId = typeof presets?.saleOrderId === 'string' ? presets.saleOrderId : '';
  const presetInvoiceAmount =
    typeof presets?.invoiceAmount === 'number' && Number.isFinite(presets.invoiceAmount)
      ? presets.invoiceAmount
      : 0;

  const initialFormData = useMemo<InvoiceFormData>(
    () => ({
      saleOrderId: presetSaleOrderId,
      customerId: presetCustomerId,
      subject: '',
      invoiceAmount: presetInvoiceAmount,
      invoiceType: null,
      invoiceDate: getTodayDateString(),
      invoiceNumber: null,
      title: null,
      taxIdentifyNum: null,
      invoiceStatus: null,
      itemType: null,
      bankName: null,
      bankAccount: null,
      registeredAddress: null,
      registeredPhone: null,
      remark: null,
    }),
    [presetCustomerId, presetSaleOrderId, presetInvoiceAmount]
  );

  const create = useDrawerCreate<InvoiceFormData>({
    endpoint: '/invoices',
    initialFormData,
    schema: invoiceFormSchema,
    formToPayload: toInvoicePayload,
    onSuccess: () => drawerStack.pop(),
  });

  return (
    <DrawerCreateShell
      onSubmit={create.handleSubmit}
      onCancel={drawerStack.pop}
      submitting={create.submitting}
    >
      {renderInvoiceFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
      })}
    </DrawerCreateShell>
  );
}

registerEntityDetail('invoice', {
  defaultTitle: '发票详情',
  defaultCreateTitle: '新建发票',
  render: (id, context) => (
    <InvoiceDetailView id={id} approvalContext={normalizeBusinessApprovalContext(context)} />
  ),
  renderCreate: (presets) => <InvoiceCreateView presets={presets} />,
});
