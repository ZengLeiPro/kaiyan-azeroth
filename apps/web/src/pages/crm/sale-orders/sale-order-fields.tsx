/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { APPROVAL_EVENT_TYPE, PAYMENT_DIRECTION } from '@ky-azeroth/shared/constants';
import type { IOpportunityResponse } from '@ky-azeroth/shared/types/opportunity';
import type { IPaymentResponse } from '@ky-azeroth/shared/types/payment';
import type { IOrderProductInfo, ISaleOrderResponse } from '@ky-azeroth/shared/types/sale-order';
import {
  calculateSaleOrderProductPricing,
  formatSaleOrderPriceAdjustment,
} from '@ky-azeroth/shared/utils';
import { Plus, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

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
import { OpportunitySelect } from '@/components/patterns/opportunity-select';
import { ProductSelect, type ProductSelectValue } from '@/components/patterns/product-select';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { RelatedEntityList } from '@/components/patterns/related-entity-list';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerCreate } from '@/hooks/use-drawer-create';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  formatDateDisplay,
  formatDateToLocalDateString,
  getDateAfterYearsString,
  getTodayDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import { orderStatusMap, paymentDirectionMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { PaymentRefundCreateView } from '@/pages/crm/payments/payment-fields';
import { useAuthStore } from '@/stores/auth';

import {
  applyOpportunityToSaleOrderFormData,
  applyProductSelectionToOrderProduct,
  createEmptyOrderProductItem,
  type OrderProductFormItem,
  type SaleOrderFormData,
  saleOrderFormSchema,
  type SaleOrderProfile,
  toSaleOrderFormData,
  toSaleOrderPayload,
  toSaleOrderProfile,
  toSaleOrderUpdatePayload,
  updateOrderProductPricingField,
} from './types';

function SummaryStat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-mono text-sm font-medium', valueClassName)}>{value}</span>
    </div>
  );
}

function calculateProductAmount(products: OrderProductFormItem[]): number {
  return (
    Math.round(
      products.reduce(
        (sum, product) =>
          sum +
          Number(
            calculateSaleOrderProductPricing({
              quantity: product.quantity,
              unitPrice: product.unitPrice,
              contractUnitPrice: product.contractUnitPrice,
            }).productAmount ?? 0
          ),
        0
      ) * 100
    ) / 100
  );
}

export interface SaleOrderFieldsProps {
  entity: SaleOrderProfile | null;
  formData: SaleOrderFormData;
  updateFormField: <K extends keyof SaleOrderFormData>(key: K, value: SaleOrderFormData[K]) => void;
  getFieldError: (key: keyof SaleOrderFormData) => string | undefined;
  /** edit/create 模式专用 products 行变化回调；view 模式可不传 */
  onProductsChange?: (products: OrderProductFormItem[]) => void;
}

// ============================================================================
// 产品明细子表（view / edit 严格分支）
// ============================================================================

function ReadonlyOrderProductsTable({ products }: { products?: IOrderProductInfo[] }) {
  if (!products || products.length === 0) {
    return (
      <div className="space-y-2 pt-4">
        <h3 className="text-sm font-medium">产品明细</h3>
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          暂无产品明细
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 pt-4">
      <h3 className="text-sm font-medium">产品明细（{products.length}）</h3>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">产品名称</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">产品编号</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">产品单价</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">数量</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">合同单价</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">价格浮动</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">小计金额</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">备注</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t">
                <td className="whitespace-nowrap px-3 py-2">{product.productName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {product.productNumber || '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {product.unitPrice != null ? Number(product.unitPrice).toFixed(2) : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {product.quantity != null ? Number(product.quantity).toFixed(2) : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {product.contractUnitPrice != null
                    ? Number(product.contractUnitPrice).toFixed(2)
                    : '-'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {formatSaleOrderPriceAdjustment(product.discount)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {product.subtotalAmount != null ? Number(product.subtotalAmount).toFixed(2) : '-'}
                </td>
                <td className="whitespace-pre-wrap break-words px-3 py-2 text-muted-foreground">
                  {product.remark || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditableOrderProductsTable({
  products,
  onChange,
}: {
  products: OrderProductFormItem[];
  onChange: (products: OrderProductFormItem[]) => void;
}) {
  const updateRow = useCallback(
    (
      tempId: string,
      field: 'unitPrice' | 'contractUnitPrice' | 'quantity',
      value: number | null
    ) => {
      const updated = products.map((p) =>
        p.tempId === tempId ? updateOrderProductPricingField(p, field, value) : p
      );
      onChange(updated);
    },
    [products, onChange]
  );

  const applyProductSelection = useCallback(
    (tempId: string, selection: ProductSelectValue) => {
      const updated = products.map((p) => {
        if (p.tempId !== tempId) return p;
        return applyProductSelectionToOrderProduct(p, selection);
      });
      onChange(updated);
    },
    [products, onChange]
  );

  const addRow = useCallback(() => {
    onChange([...products, createEmptyOrderProductItem()]);
  }, [products, onChange]);

  const removeRow = useCallback(
    (tempId: string) => {
      onChange(products.filter((p) => p.tempId !== tempId));
    },
    [products, onChange]
  );

  return (
    <div className="col-span-1 pt-4 md:col-span-2">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">产品明细</h4>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="mr-1 h-3 w-3" />
          添加产品
        </Button>
      </div>
      {products.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-left font-medium text-muted-foreground">产品名称*</th>
                <th className="w-24 px-2 py-2 text-right font-medium text-muted-foreground">
                  产品单价*
                </th>
                <th className="w-20 px-2 py-2 text-right font-medium text-muted-foreground">
                  数量*
                </th>
                <th className="w-24 px-2 py-2 text-right font-medium text-muted-foreground">
                  合同单价*
                </th>
                <th className="w-20 px-2 py-2 text-right font-medium text-muted-foreground">
                  价格浮动
                </th>
                <th className="w-28 px-2 py-2 text-right font-medium text-muted-foreground">
                  小计
                </th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {products.map((product) => (
                <tr key={product.tempId}>
                  <td className="px-2 py-1.5">
                    <ProductSelect
                      value={product.productName}
                      onSelect={(selection) => applyProductSelection(product.tempId, selection)}
                      placeholder="选择产品"
                      onSaleOnly
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={product.unitPrice ?? ''}
                      onChange={(e) =>
                        updateRow(
                          product.tempId,
                          'unitPrice',
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      placeholder="0.00"
                      className="h-8 text-right text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={product.quantity ?? ''}
                      onChange={(e) =>
                        updateRow(
                          product.tempId,
                          'quantity',
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      placeholder="0"
                      className="h-8 text-right text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={product.contractUnitPrice ?? ''}
                      onChange={(e) =>
                        updateRow(
                          product.tempId,
                          'contractUnitPrice',
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      placeholder="0.00"
                      className="h-8 text-right text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="text"
                      value={formatSaleOrderPriceAdjustment(product.discount)}
                      placeholder="自动"
                      readOnly
                      disabled
                      className="h-8 cursor-default bg-muted/40 text-right text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium">
                    {product.subtotalAmount != null ? product.subtotalAmount.toFixed(2) : '-'}
                  </td>
                  <td className="px-2 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => removeRow(product.tempId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">暂无产品明细，点击"添加产品"开始添加</p>
      )}
    </div>
  );
}

/** view → 只读表（数据 entity.products）；edit/create → 可编辑表（数据 formData.products） */
function OrderProductsTableSwitch({
  entity,
  formData,
  onProductsChange,
}: {
  entity: SaleOrderProfile | null;
  formData: SaleOrderFormData;
  onProductsChange?: (products: OrderProductFormItem[]) => void;
}) {
  const { mode } = useFormMode();
  if (mode === 'view') {
    return (
      <div className="col-span-1 md:col-span-2">
        <ReadonlyOrderProductsTable products={entity?.products} />
      </div>
    );
  }
  return (
    <EditableOrderProductsTable
      products={formData.products ?? []}
      onChange={(p) => onProductsChange?.(p)}
    />
  );
}

/**
 * 合同标题：由后端按「客户名 - 日期 - 金额」自动生成；前端表单一律只读。
 * create 模式空 + placeholder；edit 模式显示当前值（disabled）；view 模式走 viewContent。
 */
function OrderTitleField({ formData, error }: { formData: SaleOrderFormData; error?: string }) {
  return (
    <FormField name="orderTitle" label="合同标题" error={error} viewContent={formData.orderTitle}>
      <Input
        id="orderTitle"
        placeholder="提交后自动生成"
        value={formData.orderTitle ?? ''}
        disabled
        readOnly
      />
    </FormField>
  );
}

function ProductAmountField({
  entity,
  formData,
}: {
  entity: SaleOrderProfile | null;
  formData: SaleOrderFormData;
}) {
  const { mode } = useFormMode();
  const productAmount =
    mode === 'view'
      ? entity?.productAmount != null
        ? Number(entity.productAmount)
        : null
      : calculateProductAmount(formData.products);
  return (
    <FormField
      name="productAmount"
      label="产品金额"
      required
      viewContent={productAmount != null ? productAmount.toFixed(2) : undefined}
    >
      <Input
        id="productAmount"
        value={productAmount != null ? productAmount.toFixed(2) : ''}
        readOnly
        disabled
        className="cursor-default bg-muted/40"
      />
    </FormField>
  );
}

function OpportunityField({
  entity,
  formData,
  updateFormField,
  error,
}: {
  entity: SaleOrderProfile | null;
  formData: SaleOrderFormData;
  updateFormField: <K extends keyof SaleOrderFormData>(key: K, value: SaleOrderFormData[K]) => void;
  error?: string;
}) {
  const { mode } = useFormMode();
  const lastAppliedOpportunityIdRef = useRef<string | null>(null);
  const pendingSelectedOpportunityIdRef = useRef<string | null>(null);

  const handleOpportunityChange = useCallback(
    (value: string) => {
      if (!value) {
        lastAppliedOpportunityIdRef.current = null;
        pendingSelectedOpportunityIdRef.current = null;
      } else if (value !== formData.opportunityId) {
        pendingSelectedOpportunityIdRef.current = value;
      }
      updateFormField('opportunityId', value || null);
    },
    [formData.opportunityId, updateFormField]
  );

  const handleSelectedOpportunityChange = useCallback(
    (opportunity: IOpportunityResponse | null) => {
      if (mode === 'view') return;
      if (!opportunity) {
        lastAppliedOpportunityIdRef.current = null;
        pendingSelectedOpportunityIdRef.current = null;
        return;
      }
      if (pendingSelectedOpportunityIdRef.current !== opportunity.id) return;
      if (lastAppliedOpportunityIdRef.current === opportunity.id) return;
      lastAppliedOpportunityIdRef.current = opportunity.id;
      pendingSelectedOpportunityIdRef.current = null;

      const next = applyOpportunityToSaleOrderFormData(formData, opportunity);
      updateFormField('customerId', next.customerId);
      updateFormField('opportunityId', next.opportunityId);
      updateFormField('orderAmount', next.orderAmount);
      updateFormField('products', next.products);
      updateFormField('productsTouched', true);
    },
    [formData, mode, updateFormField]
  );

  return (
    <FormField
      name="opportunityId"
      label="关联商机"
      required
      error={error}
      viewContent={
        <RelatedEntityLink
          entityType="opportunity"
          id={entity?.opportunity?.id ?? formData.opportunityId}
          label={entity?.opportunity?.opportunityName}
        />
      }
    >
      <OpportunitySelect
        value={formData.opportunityId ?? ''}
        onChange={handleOpportunityChange}
        onSelectedOpportunityChange={handleSelectedOpportunityChange}
        customerId={formData.customerId}
        availableForSaleOrder
        currentSaleOrderId={entity?.id}
        placeholder="搜索并选择商机"
      />
    </FormField>
  );
}

/** 仅 view 模式渲染的后端计算金额（应收/已收/未收 + 已开票/开票状态） */
export function ReadonlyTotalsFields({
  entity,
}: {
  entity: Pick<
    SaleOrderProfile,
    | 'totalReceivables'
    | 'totalReceived'
    | 'totalRefunded'
    | 'badDebtAmount'
    | 'totalUncollected'
    | 'invoicedAmount'
    | 'orderInvoiceStatus'
  > | null;
}) {
  const { mode } = useFormMode();
  if (mode !== 'view' || !entity) return null;
  return (
    <>
      <FormField
        name="totalReceivables"
        label="应收总额"
        viewContent={
          entity.totalReceivables != null ? Number(entity.totalReceivables).toFixed(2) : undefined
        }
      />
      <FormField
        name="totalReceived"
        label="已收总额(净)"
        viewContent={
          entity.totalReceived != null ? Number(entity.totalReceived).toFixed(2) : undefined
        }
      />
      <FormField
        name="totalRefunded"
        label="已退总额"
        viewContent={
          entity.totalRefunded != null && Number(entity.totalRefunded) > 0
            ? Number(entity.totalRefunded).toFixed(2)
            : '0.00'
        }
      />
      <FormField
        name="badDebtAmount"
        label="坏账金额"
        viewContent={Number(entity.badDebtAmount ?? 0).toFixed(2)}
      />
      <FormField
        name="totalUncollected"
        label="未收余额"
        viewContent={
          entity.totalUncollected != null ? Number(entity.totalUncollected).toFixed(2) : undefined
        }
      />
      <FormField
        name="invoicedAmount"
        label="已开票金额"
        viewContent={Number(entity.invoicedAmount).toFixed(2)}
      />
      <FormField
        name="orderInvoiceStatus"
        label="开票状态"
        viewContent={entity.orderInvoiceStatus ?? undefined}
      />
    </>
  );
}

function ReadonlyOrderStatusField({ entity }: { entity: SaleOrderProfile | null }) {
  const { mode } = useFormMode();
  if (mode !== 'view' || !entity) return null;

  // orderStatus 是后端派生的 5 态字段（NOT_RECEIVED / PARTIALLY_RECEIVED / FULLY_RECEIVED
  // / PARTIALLY_REFUNDED / FULLY_REFUNDED），仅展示，禁止编辑（FormData 已不含此字段）。
  return (
    <FormField
      name="orderStatus"
      label="回款状态"
      viewContent={
        entity.orderStatus ? (
          <StatusBadge status={entity.orderStatus} statusMap={orderStatusMap} />
        ) : undefined
      }
    />
  );
}

export function BadDebtAmountInputField({
  value,
  error,
  onChange,
}: {
  value: number | null;
  error?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <FormField
      name="badDebtAmount"
      label="坏账金额"
      error={error}
      viewContent={value != null ? Number(value).toFixed(2) : undefined}
    >
      <Input
        id="badDebtAmount"
        type="number"
        min="0"
        step="0.01"
        placeholder="0.00"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      />
    </FormField>
  );
}

export function renderSaleOrderFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
  onProductsChange,
}: SaleOrderFieldsProps) {
  return (
    <>
      <OrderTitleField formData={formData} error={getFieldError('orderTitle')} />

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
          value={formData.customerId}
          onChange={(v) => updateFormField('customerId', v)}
          placeholder="搜索并选择客户"
        />
      </FormField>

      <OpportunityField
        entity={entity}
        formData={formData}
        updateFormField={updateFormField}
        error={getFieldError('opportunityId')}
      />

      <ReadonlyOrderStatusField entity={entity} />

      <FormField
        name="orderAmount"
        label="合同金额"
        required
        error={getFieldError('orderAmount')}
        viewContent={
          formData.orderAmount != null ? Number(formData.orderAmount).toFixed(2) : undefined
        }
      >
        <Input
          id="orderAmount"
          type="number"
          step="0.01"
          placeholder="请输入合同金额"
          value={formData.orderAmount ?? ''}
          onChange={(e) =>
            updateFormField('orderAmount', e.target.value ? Number(e.target.value) : null)
          }
        />
      </FormField>

      <FormField
        name="otherFee"
        label="其他相关费用"
        required
        error={getFieldError('otherFee')}
        viewContent={formData.otherFee != null ? Number(formData.otherFee).toFixed(2) : undefined}
      >
        <Input
          id="otherFee"
          type="number"
          step="0.01"
          placeholder="请输入其他相关费用"
          value={formData.otherFee ?? ''}
          onChange={(e) =>
            updateFormField('otherFee', e.target.value ? Number(e.target.value) : null)
          }
        />
      </FormField>

      <BadDebtAmountInputField
        value={formData.badDebtAmount}
        error={getFieldError('badDebtAmount')}
        onChange={(value) => updateFormField('badDebtAmount', value)}
      />

      <ProductAmountField entity={entity} formData={formData} />

      <FormField
        name="businessDate"
        label="业务日期"
        required
        error={getFieldError('businessDate')}
        viewContent={formatDateDisplay(formData.businessDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.businessDate)}
          onDateChange={(date) =>
            updateFormField('businessDate', date ? formatDateToLocalDateString(date) : null)
          }
          placeholder="选择业务日期"
          className="w-full"
        />
      </FormField>

      <FormField
        name="paymentDate"
        label="回款时间"
        error={getFieldError('paymentDate')}
        viewContent={formatDateDisplay(formData.paymentDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.paymentDate)}
          onDateChange={(date) =>
            updateFormField('paymentDate', date ? formatDateToLocalDateString(date) : null)
          }
          placeholder="选择回款时间"
          className="w-full"
        />
      </FormField>

      <FormField
        name="orderBeginDate"
        label="合同开始日期"
        required
        error={getFieldError('orderBeginDate')}
        viewContent={formatDateDisplay(formData.orderBeginDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.orderBeginDate)}
          onDateChange={(date) =>
            updateFormField('orderBeginDate', date ? formatDateToLocalDateString(date) : null)
          }
          placeholder="选择开始日期"
          className="w-full"
        />
      </FormField>

      <FormField
        name="orderEndDate"
        label="合同结束日期"
        error={getFieldError('orderEndDate')}
        viewContent={formatDateDisplay(formData.orderEndDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.orderEndDate)}
          onDateChange={(date) =>
            updateFormField('orderEndDate', date ? formatDateToLocalDateString(date) : null)
          }
          placeholder="选择结束日期"
          className="w-full"
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

      <ReadonlyTotalsFields entity={entity} />

      <OrderProductsTableSwitch
        entity={entity}
        formData={formData}
        onProductsChange={onProductsChange}
      />

      <FormField
        name="remark"
        label="备注"
        fullRow
        error={getFieldError('remark')}
        viewContent={formData.remark}
      >
        <Textarea
          id="remark"
          placeholder="请输入备注信息"
          value={formData.remark ?? ''}
          onChange={(e) => updateFormField('remark', e.target.value || null)}
          rows={3}
        />
      </FormField>
    </>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：订单详情视图（含关联回款 / 发票，可继续下钻）
// ============================================================================

function SaleOrderDetailView({
  id,
  approvalContext,
}: {
  id: string;
  approvalContext?: BusinessApprovalContext;
}) {
  const isMobile = useIsMobile();
  const drawerStack = useDrawerStack();
  const [tab, setTab] = useState('order');
  const [refundOpen, setRefundOpen] = useState(false);
  const crud = useDrawerEntityDetail<ISaleOrderResponse, SaleOrderFormData>({
    endpoint: '/sale-orders',
    id,
    entityType: 'sale-order',
    // @ts-expect-error: schema 校验 ICreateSaleOrder；products.tempId 是 UI-only 字段
    schema: saleOrderFormSchema,
    toFormData: (data) => toSaleOrderFormData(toSaleOrderProfile(data)),
    toPayload: toSaleOrderUpdatePayload,
    // entityNameOf 不传 → useDrawerEntityDetail 默认走 getEntityDisplayName('sale-order', e, 'long')
  });
  useEntityHeaderActions(crud);

  const profile = crud.data ? toSaleOrderProfile(crud.data) : null;
  const grossReceived =
    (Number(profile?.totalReceived ?? 0) || 0) + (Number(profile?.totalRefunded ?? 0) || 0);
  const refundedAmount = Number(profile?.totalRefunded ?? 0) || 0;
  const netReceived = Number(profile?.totalReceived ?? 0) || 0;
  const receivables = Number(profile?.totalReceivables ?? profile?.orderAmount ?? 0) || 0;
  const uncollected = Number(profile?.totalUncollected ?? 0) || 0;
  const moneyFmt = (v: number) =>
    new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      v
    );
  const invoiceAmountPreset = useMemo(() => {
    const orderAmount = Number(profile?.orderAmount ?? 0);
    const invoicedAmount = Number(profile?.invoicedAmount ?? 0);
    if (!Number.isFinite(orderAmount) || !Number.isFinite(invoicedAmount)) return 0;
    return Math.max(Math.round((orderAmount - invoicedAmount) * 100) / 100, 0);
  }, [profile?.orderAmount, profile?.invoicedAmount]);

  const handleInvoiceCreate = useCallback(() => {
    if (!profile) return;
    drawerStack.push({
      type: 'invoice',
      id: '__create__',
      mode: 'create',
      title: '新建发票',
      presets: {
        saleOrderId: id,
        customerId: profile.customerId,
        invoiceAmount: invoiceAmountPreset,
      },
    });
  }, [drawerStack, id, invoiceAmountPreset, profile]);

  const paymentSummary = (
    <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-5">
      <SummaryStat label="毛回款" value={`¥${moneyFmt(grossReceived)}`} />
      <SummaryStat
        label="退款"
        value={`¥${moneyFmt(refundedAmount)}`}
        valueClassName="text-orange-700"
      />
      <SummaryStat
        label="净回款"
        value={`¥${moneyFmt(netReceived)}`}
        valueClassName="text-emerald-700"
      />
      <SummaryStat label="应收" value={`¥${moneyFmt(receivables)}`} />
      <SummaryStat label="未收" value={`¥${moneyFmt(uncollected)}`} />
    </div>
  );

  const handleProductsChange = useCallback(
    (products: OrderProductFormItem[]) => {
      crud.updateFormField('products', products);
      crud.updateFormField('productsTouched', true);
    },
    [crud]
  );

  if (crud.error && approvalContext?.approvalInstanceId) {
    return (
      <BusinessApprovalFallback
        approvalContext={approvalContext}
        defaultEventType={APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE}
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
      notFoundHint="订单不存在"
      useGridLayout={false}
      changeLogTarget={{ module: 'sale-orders', target: id }}
    >
      <div className="space-y-6">
        <Tabs value={tab} onValueChange={setTab} className="col-span-1 md:col-span-2">
          <TabsList className="flex w-full justify-start gap-1 overflow-x-auto whitespace-nowrap">
            <TabsTrigger value="order">合同订单信息</TabsTrigger>
            <TabsTrigger value="payments">回款信息</TabsTrigger>
          </TabsList>

          <TabsContent value="order">
            <div className="space-y-6">
              <BusinessApprovalSection
                eventType={APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE}
                formId={id}
                flowStatus={crud.data?.flowStatus}
                approvalInstanceId={approvalContext?.approvalInstanceId}
                approvalEventType={approvalContext?.approvalEventType}
                onApprovalSuccess={approvalContext?.onApprovalSuccess}
                onSuccess={crud.refetch}
              />

              <div className={cn(isMobile ? 'space-y-4' : 'grid grid-cols-2 gap-x-4 gap-y-4')}>
                {renderSaleOrderFields({
                  entity: crud.data ? toSaleOrderProfile(crud.data) : null,
                  formData: crud.formData,
                  updateFormField: crud.updateFormField,
                  getFieldError: crud.getFieldError,
                  onProductsChange: handleProductsChange,
                })}
              </div>

              {/* 嵌套关联：该订单的发票记录 */}
              <div className="space-y-2">
                <h3 className="text-sm font-medium">关联发票</h3>
                <RelatedEntityList
                  endpoint="/invoices"
                  queryParams={{ saleOrderId: id, sortBy: 'invoiceDate', sortOrder: 'desc' }}
                  columns={[
                    {
                      key: 'invoiceDate',
                      header: '开票日期',
                      render: (r) => (r as { invoiceDate?: string }).invoiceDate || '-',
                    },
                    {
                      key: 'invoiceNumber',
                      header: '发票号',
                      render: (r) => (r as { invoiceNumber?: string }).invoiceNumber || '-',
                    },
                    {
                      key: 'invoiceAmount',
                      header: '金额',
                      className: 'text-right font-mono',
                      render: (r) => {
                        const v = (r as { invoiceAmount?: number | string }).invoiceAmount;
                        return v != null ? Number(v).toFixed(2) : '-';
                      },
                    },
                  ]}
                  emptyHint="该订单暂无发票记录"
                  entityType="invoice"
                  onCreate={profile ? handleInvoiceCreate : undefined}
                  createLabel="新增发票"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="payments">
            <RelatedEntityList<IPaymentResponse>
              endpoint="/payments"
              queryParams={{ saleOrderId: id, sortBy: 'businessDate', sortOrder: 'desc' }}
              summary={paymentSummary}
              extraToolbarActions={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 border-orange-300 text-orange-700 hover:bg-orange-50"
                  onClick={() => setRefundOpen(true)}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  新建退款
                </Button>
              }
              columns={[
                {
                  key: 'direction',
                  header: '方向',
                  render: (r) => {
                    const cfg = paymentDirectionMap[r.direction as 'IN' | 'OUT'];
                    if (!cfg) return r.direction || '-';
                    return (
                      <Badge className={cn(cfg.color, `hover:${cfg.color}`)}>{cfg.label}</Badge>
                    );
                  },
                },
                {
                  key: 'serialNumber',
                  header: '编号',
                  render: (r) => (
                    <span
                      className={cn(
                        r.direction === PAYMENT_DIRECTION.OUT && 'text-orange-700',
                        'font-medium'
                      )}
                    >
                      {r.serialNumber}
                    </span>
                  ),
                },
                {
                  key: 'businessDate',
                  header: '业务日期',
                  render: (r) => r.businessDate || '-',
                },
                {
                  key: 'paymentAmount',
                  header: '金额',
                  className: 'text-right font-mono',
                  render: (r) => {
                    const v = r.paymentAmount;
                    if (v == null) return '-';
                    const isRefund = r.direction === PAYMENT_DIRECTION.OUT;
                    return (
                      <span className={cn(isRefund && 'text-orange-700')}>
                        {isRefund ? '-' : ''}
                        {Number(v).toFixed(2)}
                      </span>
                    );
                  },
                },
                {
                  key: 'bankName',
                  header: '账户',
                  render: (r) => r.bankName || '-',
                },
              ]}
              emptyHint="该订单暂无回款 / 退款记录"
              entityType="payment"
            />
          </TabsContent>
        </Tabs>

        {/* 退款抽屉（订单内联开）。预填 saleOrderId / customerId 减少用户操作 */}
        <Sheet open={refundOpen} onOpenChange={setRefundOpen}>
          <SheetContent
            side="right"
            className="w-full overflow-y-auto sm:max-w-2xl"
            onInteractOutside={(e) => e.preventDefault()}
          >
            <SheetHeader>
              <SheetTitle>新建退款 - {profile?.serialNumber || ''}</SheetTitle>
            </SheetHeader>
            {refundOpen && (
              <div className="mt-4">
                <PaymentRefundCreateView
                  presets={{
                    saleOrderId: id,
                    customerId: profile?.customerId || '',
                  }}
                  onClose={() => setRefundOpen(false)}
                  onSuccess={() => crud.refetch()}
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </EntityDetailBody>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：订单创建视图（含产品明细）
// ============================================================================

function SaleOrderCreateView({ presets }: { presets?: Record<string, unknown> }) {
  const drawerStack = useDrawerStack();
  const { user } = useAuthStore();
  const currentEmployeeId = user?.employee?.id ?? user?.id ?? null;
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';

  const initialFormData = useMemo<SaleOrderFormData>(
    () => ({
      orderTitle: null,
      customerId: presetCustomerId,
      opportunityId: null,
      orderAmount: null,
      otherFee: 0,
      badDebtAmount: 0,
      businessDate: getTodayDateString(),
      paymentDate: null,
      orderBeginDate: getTodayDateString(),
      orderEndDate: getDateAfterYearsString(1),
      chargerId: currentEmployeeId,
      remark: null,
      products: [createEmptyOrderProductItem()],
      productsTouched: false,
    }),
    [presetCustomerId, currentEmployeeId]
  );

  const create = useDrawerCreate<SaleOrderFormData>({
    endpoint: '/sale-orders',
    // @ts-expect-error: schema 校验 ICreateSaleOrder；products.tempId 是 UI-only 字段
    schema: saleOrderFormSchema,
    initialFormData,
    formToPayload: toSaleOrderPayload,
    onSuccess: () => drawerStack.pop(),
  });

  const handleProductsChange = useCallback(
    (products: OrderProductFormItem[]) => {
      create.updateFormField('products', products);
      create.updateFormField('productsTouched', true);
    },
    [create]
  );

  return (
    <DrawerCreateShell
      onSubmit={create.handleSubmit}
      onCancel={drawerStack.pop}
      submitting={create.submitting}
    >
      {renderSaleOrderFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
        onProductsChange: handleProductsChange,
      })}
    </DrawerCreateShell>
  );
}

registerEntityDetail('sale-order', {
  defaultTitle: '订单详情',
  defaultCreateTitle: '新建订单',
  render: (id, context) => (
    <SaleOrderDetailView id={id} approvalContext={normalizeBusinessApprovalContext(context)} />
  ),
  renderCreate: (presets) => <SaleOrderCreateView presets={presets} />,
});
