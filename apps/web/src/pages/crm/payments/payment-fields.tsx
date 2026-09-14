/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import {
  APPROVAL_EVENT_TYPE,
  PAYMENT_DIRECTION,
  PAYMENT_REFUND_TYPE,
  PAYMENT_SUBJECT_IN_PRESETS,
  PAYMENT_SUBJECT_OUT_PRESETS,
} from '@ky-azeroth/shared/constants';
import type { IPaymentResponse } from '@ky-azeroth/shared/types/payment';
import type {
  ISaleOrderResponse,
  SaleOrderForSelection,
} from '@ky-azeroth/shared/types/sale-order';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

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
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, useFormMode } from '@/components/patterns/form-field';
import { PaymentSelect } from '@/components/patterns/payment-select';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { SaleOrderSelect } from '@/components/patterns/sale-order-select';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerCreate } from '@/hooks/use-drawer-create';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import {
  formatDateDisplay,
  formatDateToLocalDateString,
  getTodayDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import {
  getStatusColor,
  getStatusLabel,
  orderStatusMap,
  paymentDirectionMap,
  paymentStatusMap,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';

import { PaymentItemForm } from './components/PaymentItemForm';
import {
  getDefaultPaymentAmountFromSaleOrder,
  type PaymentFormData,
  paymentFormSchema,
  type PaymentProfile,
  type PaymentRefundFormData,
  paymentRefundFormSchema,
  toPaymentFormData,
  toPaymentPayload,
  toPaymentProfile,
  toPaymentRefundPayload,
} from './types';

const refundTypeOptions = Object.values(PAYMENT_REFUND_TYPE).map((v) => ({ value: v, label: v }));

// 与 YCCRM 同步进来的中文枚举对齐：value 与 label 一致，避免下拉值匹配不上
export const paymentTypeOptions = [
  { value: '银行转账', label: '银行转账' },
  { value: '支付宝', label: '支付宝' },
  { value: '微信支付', label: '微信支付' },
  { value: '现金', label: '现金' },
  { value: '其他', label: '其他' },
];

export const bankNameOptions = [
  { value: '招商银行', label: '招商银行' },
  { value: '浙江网商银行', label: '浙江网商银行' },
  { value: '微信', label: '微信' },
  { value: '支付宝', label: '支付宝' },
  { value: '现金', label: '现金' },
];

const amountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(value: number | string | null | undefined) {
  if (value == null) return '-';
  const amount = Number(value);
  return Number.isFinite(amount) ? amountFormatter.format(amount) : '-';
}

function PaymentSaleOrderReceiptSummary({
  saleOrderId,
  selectedOrder,
}: {
  saleOrderId: string;
  selectedOrder?: SaleOrderForSelection | null;
}) {
  const { data } = useQuery({
    queryKey: ['payment-sale-order-receipt-summary', saleOrderId],
    enabled: Boolean(saleOrderId),
    queryFn: async () => {
      const response = await api.get<ISaleOrderResponse>(`/sale-orders/${saleOrderId}`);
      return response.data;
    },
    staleTime: 60 * 1000,
  });

  const orderStatus = data?.orderStatus ?? selectedOrder?.orderStatus ?? null;
  const totalReceived = data?.totalReceived ?? selectedOrder?.totalReceived ?? null;
  const totalUncollected = data?.totalUncollected ?? selectedOrder?.totalUncollected ?? null;

  if (!saleOrderId && !selectedOrder) return null;

  return (
    <>
      <FormField
        name="orderStatus"
        label="回款情况"
        forceView
        viewContent={
          orderStatus ? (
            <Badge
              className={cn(
                getStatusColor(orderStatus, orderStatusMap),
                `hover:${getStatusColor(orderStatus, orderStatusMap)}`
              )}
            >
              {getStatusLabel(orderStatus, orderStatusMap)}
            </Badge>
          ) : undefined
        }
      />
      <FormField
        name="totalReceived"
        label="已回款金额"
        forceView
        viewContent={formatAmount(totalReceived)}
      />
      <FormField
        name="totalUncollected"
        label="未回款金额"
        forceView
        viewContent={formatAmount(totalUncollected)}
      />
    </>
  );
}

function getStatusBadge(status: string | null | undefined) {
  if (!status) return <span className="text-muted-foreground">-</span>;
  const label = getStatusLabel(status, paymentStatusMap);
  const color = getStatusColor(status, paymentStatusMap);
  return <Badge className={cn(color, `hover:${color}`)}>{label}</Badge>;
}

export interface PaymentFieldsProps {
  entity: PaymentProfile | null;
  formData: PaymentFormData;
  updateFormField: <K extends keyof PaymentFormData>(key: K, value: PaymentFormData[K]) => void;
  getFieldError: (key: keyof PaymentFormData) => string | undefined;
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
  const [selectedOrder, setSelectedOrder] = useState<SaleOrderForSelection | null>(null);
  return (
    <>
      <FormField
        name="saleOrderId"
        label="合同订单"
        required
        error={error}
        viewContent={
          <RelatedEntityLink entityType="sale-order" id={saleOrderId} label={viewName} />
        }
      >
        <SaleOrderSelect
          value={value}
          onChange={onChange}
          onSelect={(order) => {
            setSelectedOrder(order);
            onSelectOrder(order);
          }}
          customerId={customerId}
          disabled={isView}
        />
      </FormField>
      <PaymentSaleOrderReceiptSummary saleOrderId={value} selectedOrder={selectedOrder} />
    </>
  );
}

/**
 * 渲染回款（IN）表单字段。原 `renderPaymentFields` 保留为同名 alias 以兼容外部引用。
 */
export function renderPaymentInFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
}: PaymentFieldsProps) {
  return (
    <>
      <SaleOrderField
        value={formData.saleOrderId}
        customerId={formData.customerId ?? ''}
        saleOrderId={entity?.saleOrder?.id ?? formData.saleOrderId}
        viewName={
          entity?.saleOrder
            ? `${entity.saleOrder.serialNumber}${entity.saleOrder.orderTitle ? ` ${entity.saleOrder.orderTitle}` : ''}`
            : undefined
        }
        onChange={(v) => updateFormField('saleOrderId', v)}
        onSelectOrder={(order) => {
          if (!order) {
            if (!entity) updateFormField('paymentAmount', 0);
            updateFormField('chargerId', null);
            return;
          }
          if (order?.customerId && !formData.customerId) {
            updateFormField('customerId', order.customerId);
          }
          updateFormField('chargerId', order.chargerId ?? null);
          const defaultPaymentAmount = getDefaultPaymentAmountFromSaleOrder(order);
          if (defaultPaymentAmount != null && !entity) {
            updateFormField('paymentAmount', defaultPaymentAmount);
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
        <>
          <Input
            id="subject"
            list="payment-subject-in-presets"
            placeholder="选预设或自定义（如：首期款 / 进度款 / 尾款）"
            maxLength={100}
            value={formData.subject ?? ''}
            onChange={(e) => updateFormField('subject', e.target.value)}
          />
          <datalist id="payment-subject-in-presets">
            {PAYMENT_SUBJECT_IN_PRESETS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
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
        name="paymentAmount"
        label="回款金额"
        required
        error={getFieldError('paymentAmount')}
        viewContent={
          formData.paymentAmount != null && !Number.isNaN(Number(formData.paymentAmount))
            ? Number(formData.paymentAmount).toFixed(2)
            : undefined
        }
      >
        <Input
          id="paymentAmount"
          type="number"
          step="0.01"
          placeholder="请输入回款金额"
          value={formData.paymentAmount}
          onChange={(e) => updateFormField('paymentAmount', Number(e.target.value))}
        />
      </FormField>

      <FormField
        name="paymentType"
        label="付款方式"
        required
        error={getFieldError('paymentType')}
        viewContent={
          paymentTypeOptions.find((o) => o.value === formData.paymentType)?.label ||
          formData.paymentType
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...paymentTypeOptions]}
          value={formData.paymentType || ''}
          onValueChange={(v) => updateFormField('paymentType', v || null)}
        />
      </FormField>

      <FormField
        name="businessDate"
        label="业务日期"
        required
        error={getFieldError('businessDate')}
        viewContent={formatDateDisplay(formData.businessDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.businessDate)}
          onDateChange={(d) =>
            updateFormField('businessDate', d ? formatDateToLocalDateString(d) : null)
          }
          className="w-full"
        />
      </FormField>

      <FormField
        name="bankName"
        label="收款账户"
        required
        error={getFieldError('bankName')}
        viewContent={
          bankNameOptions.find((o) => o.value === formData.bankName)?.label || formData.bankName
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...bankNameOptions]}
          value={formData.bankName || ''}
          onValueChange={(v) => updateFormField('bankName', v || null)}
        />
      </FormField>

      <FormField
        name="tradeSerialNumber"
        label="交易流水号"
        error={getFieldError('tradeSerialNumber')}
        viewContent={formData.tradeSerialNumber}
      >
        <Input
          id="tradeSerialNumber"
          placeholder="请输入交易流水号"
          value={formData.tradeSerialNumber || ''}
          onChange={(e) => updateFormField('tradeSerialNumber', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="chargerId"
        label="负责人"
        required
        error={getFieldError('chargerId')}
        viewContent={entity?.chargerName}
      >
        <EmployeeSelect
          value={formData.chargerId ?? ''}
          onChange={(v) => updateFormField('chargerId', v || null)}
          placeholder="搜索并选择负责人"
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

      {/* v2.2 PR-B：PaymentItem 子表 —— 仅 IN 回款按产品×模式拆 N 行 */}
      {formData.direction !== PAYMENT_DIRECTION.OUT ? (
        <div className="col-span-2">
          <PaymentItemForm
            saleOrderId={formData.saleOrderId}
            value={formData.items}
            paymentAmount={Number(formData.paymentAmount ?? 0)}
            onChange={(rows) => updateFormField('items', rows)}
            autoPopulate={!entity}
          />
        </div>
      ) : null}
    </>
  );
}

/**
 * 兼容旧 named import：renderPaymentFields → renderPaymentInFields。
 */
export const renderPaymentFields = renderPaymentInFields;

// ============================================================================
// 退款表单字段（OUT）
// ============================================================================

export interface PaymentRefundFieldsProps {
  entity: PaymentProfile | null;
  formData: PaymentRefundFormData;
  updateFormField: <K extends keyof PaymentRefundFormData>(
    key: K,
    value: PaymentRefundFormData[K]
  ) => void;
  getFieldError: (key: keyof PaymentRefundFormData) => string | undefined;
}

export function renderPaymentRefundFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
}: PaymentRefundFieldsProps) {
  return (
    <>
      <SaleOrderField
        value={formData.saleOrderId}
        customerId={formData.customerId ?? ''}
        saleOrderId={entity?.saleOrder?.id ?? formData.saleOrderId}
        viewName={
          entity?.saleOrder
            ? `${entity.saleOrder.serialNumber}${entity.saleOrder.orderTitle ? ` ${entity.saleOrder.orderTitle}` : ''}`
            : undefined
        }
        onChange={(v) => updateFormField('saleOrderId', v)}
        onSelectOrder={(order) => {
          if (order?.customerId && !formData.customerId) {
            updateFormField('customerId', order.customerId);
          }
          updateFormField('chargerId', order?.chargerId ?? null);
        }}
        error={getFieldError('saleOrderId')}
      />

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
        name="relatedPaymentId"
        label="关联原回款"
        required
        error={getFieldError('relatedPaymentId')}
        viewContent={entity?.relatedPayment?.serialNumber}
      >
        <PaymentSelect
          value={formData.relatedPaymentId || ''}
          onChange={(v) => updateFormField('relatedPaymentId', v)}
          onSelect={(payment) => {
            // 选中原回款后，自动填入金额上限提示用户（不强制覆盖）
            if (payment && !formData.paymentAmount) {
              updateFormField('paymentAmount', payment.paymentAmount);
            }
          }}
          customerId={formData.customerId ?? undefined}
          saleOrderId={formData.saleOrderId || undefined}
          direction="IN"
          flowStatus="approved"
        />
      </FormField>

      <FormField
        name="refundType"
        label="退款类型"
        required
        error={getFieldError('refundType')}
        viewContent={formData.refundType}
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...refundTypeOptions]}
          value={formData.refundType || ''}
          onValueChange={(v) => updateFormField('refundType', v)}
        />
      </FormField>

      <FormField
        name="subject"
        label="业务摘要"
        error={getFieldError('subject')}
        viewContent={formData.subject || undefined}
      >
        <>
          <Input
            id="refund-subject"
            list="payment-subject-out-presets"
            placeholder="选预设或留空（留空时取退款类型作为摘要）"
            maxLength={100}
            value={formData.subject ?? ''}
            onChange={(e) => updateFormField('subject', e.target.value)}
          />
          <datalist id="payment-subject-out-presets">
            {PAYMENT_SUBJECT_OUT_PRESETS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      </FormField>

      <FormField
        name="paymentAmount"
        label="退款金额"
        required
        error={getFieldError('paymentAmount')}
        viewContent={
          formData.paymentAmount != null && !Number.isNaN(Number(formData.paymentAmount))
            ? Number(formData.paymentAmount).toFixed(2)
            : undefined
        }
      >
        <Input
          id="paymentAmount"
          type="number"
          step="0.01"
          placeholder="请输入退款金额"
          value={formData.paymentAmount}
          onChange={(e) => updateFormField('paymentAmount', Number(e.target.value))}
        />
      </FormField>

      <FormField
        name="paymentType"
        label="付款方式"
        required
        error={getFieldError('paymentType')}
        viewContent={
          paymentTypeOptions.find((o) => o.value === formData.paymentType)?.label ||
          formData.paymentType
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...paymentTypeOptions]}
          value={formData.paymentType || ''}
          onValueChange={(v) => updateFormField('paymentType', v || null)}
        />
      </FormField>

      <FormField
        name="businessDate"
        label="业务日期"
        required
        error={getFieldError('businessDate')}
        viewContent={formatDateDisplay(formData.businessDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.businessDate)}
          onDateChange={(d) =>
            updateFormField('businessDate', d ? formatDateToLocalDateString(d) : null)
          }
          className="w-full"
        />
      </FormField>

      <FormField
        name="bankName"
        label="付款账户"
        required
        error={getFieldError('bankName')}
        viewContent={
          bankNameOptions.find((o) => o.value === formData.bankName)?.label || formData.bankName
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...bankNameOptions]}
          value={formData.bankName || ''}
          onValueChange={(v) => updateFormField('bankName', v || null)}
        />
      </FormField>

      <FormField
        name="tradeSerialNumber"
        label="交易流水号"
        error={getFieldError('tradeSerialNumber')}
        viewContent={formData.tradeSerialNumber}
      >
        <Input
          id="tradeSerialNumber"
          placeholder="请输入交易流水号"
          value={formData.tradeSerialNumber || ''}
          onChange={(e) => updateFormField('tradeSerialNumber', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="chargerId"
        label="负责人"
        required
        error={getFieldError('chargerId')}
        viewContent={entity?.chargerName}
      >
        <EmployeeSelect
          value={formData.chargerId ?? ''}
          onChange={(v) => updateFormField('chargerId', v || null)}
          placeholder="搜索并选择负责人"
        />
      </FormField>

      <FormField
        name="refundReason"
        label="退款原因"
        fullRow
        error={getFieldError('refundReason')}
        viewContent={formData.refundReason}
      >
        <Textarea
          id="refundReason"
          placeholder="请输入退款原因（可选）"
          className="min-h-20 resize-y"
          value={formData.refundReason || ''}
          onChange={(e) => updateFormField('refundReason', e.target.value || null)}
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
          className="min-h-20 resize-y"
          value={formData.remark || ''}
          onChange={(e) => updateFormField('remark', e.target.value || null)}
        />
      </FormField>
    </>
  );
}

/**
 * 退款详情专用的"只读补充字段"渲染：关联原回款 / 退款类型 / 退款原因。
 *
 * PaymentDetailView 在 isRefund=true 时调用此函数，与 renderPaymentInFields 拼接渲染。
 * 这三个字段是 OUT 不可逆字段（CLAUDE.md：direction/refundType/relatedPaymentId 一旦
 * 通过审批即冻结），detail 视图永远 readonly，不参与 formData 校验，因此独立成函数
 * 而不复用 renderPaymentRefundFields（后者要求 PaymentRefundFormData 类型 binding）。
 */
function renderRefundReadonlyExtras(entity: PaymentProfile | null) {
  if (!entity) return null;
  const refundTypeLabel =
    refundTypeOptions.find((o) => o.value === entity.refundType)?.label ?? entity.refundType ?? '-';
  return (
    <>
      <FormField
        name="relatedPaymentId"
        label="关联原回款"
        forceView
        viewContent={
          <RelatedEntityLink
            entityType="payment"
            id={entity.relatedPaymentId ?? undefined}
            label={entity.relatedPayment?.serialNumber}
          />
        }
      />
      <FormField name="refundType" label="退款类型" forceView viewContent={refundTypeLabel} />
      <FormField
        name="refundReason"
        label="退款原因"
        fullRow
        forceView
        viewContent={entity.refundReason}
      />
      {entity.relatedInvoice ? (
        <FormField
          name="relatedInvoiceId"
          label="关联红字发票"
          forceView
          viewContent={
            <RelatedEntityLink
              entityType="invoice"
              id={entity.relatedInvoiceId ?? undefined}
              label={entity.relatedInvoice.serialNumber}
            />
          }
        />
      ) : null}
    </>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：回款详情视图（含状态/审批 badge）
// ============================================================================

function PaymentDetailView({
  id,
  approvalContext,
}: {
  id: string;
  approvalContext?: BusinessApprovalContext;
}) {
  const isMobile = useIsMobile();
  const crud = useDrawerEntityDetail<IPaymentResponse, PaymentFormData>({
    endpoint: '/payments',
    id,
    entityType: 'payment',
    schema: paymentFormSchema,
    toFormData: (data) => toPaymentFormData(toPaymentProfile(data)),
    toPayload: toPaymentPayload,
    customUpdate: async ({ entity, payload, endpoint }) => {
      if (entity.flowStatus === 'approved') {
        await api.post(`${endpoint}/${entity.id}/change-request`, payload);
        return { message: '已提交变更审批' };
      }
      const response = await api.put<IPaymentResponse>(`${endpoint}/${entity.id}`, payload);
      return { data: response.data };
    },
    // entityNameOf 不传 → useDrawerEntityDetail 默认走 getEntityDisplayName('payment', e, 'long')
  });
  useEntityHeaderActions(crud);

  const profile = crud.data ? toPaymentProfile(crud.data) : null;
  const isRefund = profile?.direction === PAYMENT_DIRECTION.OUT;

  // 只读快照：view 模式直接从当前实体同步派生，不等待 useDrawerEntityDetail 的
  // Effect 把 formData 映射完成（接口数据就绪 ≠ 编辑表单就绪；见 PR 回归
  // payment-detail-first-render.test.tsx）。编辑模式仍用 crud.formData 保留未保存草稿。
  const detailSnapshot = useMemo(() => {
    if (!profile) return null;
    return { profile, formData: toPaymentFormData(profile) };
  }, [profile]);
  const displayFormData = crud.mode === 'view' ? detailSnapshot?.formData : crud.formData;

  if (crud.error && approvalContext?.approvalInstanceId) {
    return (
      <BusinessApprovalFallback
        approvalContext={approvalContext}
        defaultEventType={APPROVAL_EVENT_TYPE.PAYMENT_APPROVE}
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
      notFoundHint={isRefund ? '退款记录不存在' : '回款记录不存在'}
      useGridLayout={false}
      changeLogTarget={{ module: 'payments', target: id }}
    >
      <div className="space-y-4">
        <BusinessApprovalSection
          eventType={
            isRefund
              ? APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE
              : APPROVAL_EVENT_TYPE.PAYMENT_APPROVE
          }
          formId={id}
          flowStatus={crud.data?.flowStatus}
          approvalInstanceId={approvalContext?.approvalInstanceId}
          approvalEventType={approvalContext?.approvalEventType}
          onApprovalSuccess={approvalContext?.onApprovalSuccess}
          onSuccess={crud.refetch}
        />
        {profile && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">方向：</span>
            <Badge
              className={cn(
                paymentDirectionMap[profile.direction as 'IN' | 'OUT']?.color ??
                  'bg-gray-100 text-gray-800'
              )}
            >
              {paymentDirectionMap[profile.direction as 'IN' | 'OUT']?.label ?? profile.direction}
            </Badge>
            <span className="ml-4 text-muted-foreground">状态：</span>
            {getStatusBadge(profile.status)}
          </div>
        )}
        <div className={cn(isMobile ? 'space-y-4' : 'grid grid-cols-2 gap-x-4 gap-y-4')}>
          {detailSnapshot && displayFormData
            ? renderPaymentInFields({
                entity: detailSnapshot.profile,
                formData: displayFormData,
                updateFormField: crud.updateFormField,
                getFieldError: crud.getFieldError,
              })
            : null}
          {/* OUT 行额外展示退款专有字段（只读），保证退款详情不再"漏字段" */}
          {isRefund ? renderRefundReadonlyExtras(profile) : null}
        </div>
      </div>
    </EntityDetailBody>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：回款创建视图
// ============================================================================

function PaymentCreateView({ presets }: { presets?: Record<string, unknown> }) {
  const drawerStack = useDrawerStack();
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';

  const initialFormData = useMemo<PaymentFormData>(
    () => ({
      saleOrderId: '',
      customerId: presetCustomerId,
      subject: '',
      paymentAmount: 0,
      paymentType: null,
      businessDate: getTodayDateString(),
      bankName: null,
      tradeSerialNumber: null,
      chargerId: null,
      remark: null,
      items: [],
    }),
    [presetCustomerId]
  );

  const create = useDrawerCreate<PaymentFormData>({
    endpoint: '/payments',
    initialFormData,
    schema: paymentFormSchema,
    formToPayload: toPaymentPayload,
    onSuccess: () => drawerStack.pop(),
  });

  return (
    <DrawerCreateShell
      onSubmit={create.handleSubmit}
      onCancel={drawerStack.pop}
      submitting={create.submitting}
    >
      {renderPaymentInFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
      })}
    </DrawerCreateShell>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：退款创建视图（独立入口）
// ============================================================================

export function PaymentRefundCreateView({
  presets,
  onClose,
  onSuccess,
}: {
  presets?: Record<string, unknown>;
  /** 在外部 Sheet 中使用时传入；不传则默认 drawerStack.pop() */
  onClose?: () => void;
  /** 创建成功后的回调（如刷新外部列表）；与 onClose 协同 */
  onSuccess?: () => void;
}) {
  const drawerStack = useDrawerStack();
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';
  const presetSaleOrderId = typeof presets?.saleOrderId === 'string' ? presets.saleOrderId : '';
  const presetRelatedPaymentId =
    typeof presets?.relatedPaymentId === 'string' ? presets.relatedPaymentId : '';

  const initialFormData = useMemo<PaymentRefundFormData>(
    () => ({
      saleOrderId: presetSaleOrderId,
      customerId: presetCustomerId,
      paymentAmount: 0,
      paymentType: null,
      businessDate: getTodayDateString(),
      bankName: null,
      tradeSerialNumber: null,
      chargerId: null,
      remark: null,
      refundType: '',
      refundReason: null,
      relatedPaymentId: presetRelatedPaymentId,
      relatedInvoiceId: null,
    }),
    [presetCustomerId, presetSaleOrderId, presetRelatedPaymentId]
  );

  const closeFn = onClose ?? (() => drawerStack.pop());
  const create = useDrawerCreate<PaymentRefundFormData>({
    endpoint: '/payments/refund',
    initialFormData,
    schema: paymentRefundFormSchema,
    formToPayload: toPaymentRefundPayload,
    onSuccess: () => {
      onSuccess?.();
      closeFn();
    },
  });

  return (
    <DrawerCreateShell
      onSubmit={create.handleSubmit}
      onCancel={closeFn}
      submitting={create.submitting}
    >
      {renderPaymentRefundFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
      })}
    </DrawerCreateShell>
  );
}

/**
 * 'payment' entity 同时承载回款和退款：
 *   - detail 视图根据 record.direction 自动渲染（PaymentDetailView 已处理）
 *   - create 视图默认走「新建回款」（最常用入口）
 *   - 退款创建走 PaymentsPage 上的「新建退款」按钮 + PaymentRefundCreateView
 *     （在 PaymentsPage 中直接渲染抽屉，不挂在 entity-registry 上）
 */
registerEntityDetail('payment', {
  defaultTitle: '回款详情',
  defaultCreateTitle: '新建回款',
  render: (id, context) => (
    <PaymentDetailView id={id} approvalContext={normalizeBusinessApprovalContext(context)} />
  ),
  renderCreate: (presets) => <PaymentCreateView presets={presets} />,
});
