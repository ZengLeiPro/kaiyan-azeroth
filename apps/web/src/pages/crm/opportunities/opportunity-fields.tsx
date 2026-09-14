/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { OPPORTUNITY_STAGE_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { OPPORTUNITY_LOSE_REASON } from '@ky-azeroth/shared/constants/status-values';
import type {
  IOpportunityProductInfo,
  IOpportunityResponse,
} from '@ky-azeroth/shared/types/opportunity';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { ContactSelect } from '@/components/patterns/contact-select';
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
import { ProductSelect, type ProductSelectValue } from '@/components/patterns/product-select';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerCreate } from '@/hooks/use-drawer-create';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import {
  formatDateDisplay,
  formatDateToLocalDateString,
  parseLocalDateString,
} from '@/lib/date-utils';
import { opportunityStageMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import {
  createEmptyProductItem,
  type OpportunityFormData,
  opportunityFormSchema,
  type OpportunityProductFormItem,
  type OpportunityProfile,
  toOpportunityFormData,
  toOpportunityPayload,
  toOpportunityProfile,
  toOpportunityUpdatePayload,
} from './types';

const opportunityStageOptions = Object.entries(OPPORTUNITY_STAGE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const opportunityLoseReasonOptions = Object.values(OPPORTUNITY_LOSE_REASON).map((value) => ({
  value,
  label: value,
}));

export interface OpportunityFieldsProps {
  entity: OpportunityProfile | null;
  formData: OpportunityFormData;
  updateFormField: <K extends keyof OpportunityFormData>(
    key: K,
    value: OpportunityFormData[K]
  ) => void;
  getFieldError: (key: keyof OpportunityFormData) => string | undefined;
  /** edit/create 模式专用：products 行变化（同步小计与总额）；view 模式可不传 */
  onProductsChange?: (products: OpportunityProductFormItem[]) => void;
}

// ============================================================================
// 产品明细子表（view 与 edit 严格分支，不传 noop handler）
// ============================================================================

/** 只读产品明细表（view 模式，数据来源 entity.products） */
function ReadonlyProductsTable({ products }: { products: IOpportunityProductInfo[] | null }) {
  if (!products || products.length === 0) {
    return (
      <div className="col-span-1 pt-4 md:col-span-2">
        <h4 className="mb-3 text-sm font-medium text-foreground">产品明细</h4>
        <p className="text-sm text-muted-foreground">暂无产品明细</p>
      </div>
    );
  }
  return (
    <div className="col-span-1 pt-4 md:col-span-2">
      <h4 className="mb-3 text-sm font-medium text-foreground">产品明细</h4>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">产品名称</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">产品编号</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">单价</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">数量</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">折扣(%)</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">小计金额</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.map((product) => (
              <tr key={product.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">{product.productName}</td>
                <td className="px-3 py-2 text-muted-foreground">{product.productNumber || '-'}</td>
                <td className="px-3 py-2 text-right">
                  {product.unitPrice != null ? Number(product.unitPrice).toFixed(2) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {product.quantity != null ? Number(product.quantity) : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  {product.discount != null ? `${Number(product.discount)}%` : '-'}
                </td>
                <td className="px-3 py-2 text-right font-medium">
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

/** 可编辑产品明细表（edit/create 模式，数据来源 formData.products） */
function EditableProductsTable({
  products,
  onChange,
}: {
  products: OpportunityProductFormItem[];
  onChange: (products: OpportunityProductFormItem[]) => void;
}) {
  const updateRow = useCallback(
    (tempId: string, field: keyof OpportunityProductFormItem, value: unknown) => {
      const updated = products.map((p) => {
        if (p.tempId !== tempId) return p;
        const newRow = { ...p, [field]: value };
        if (['unitPrice', 'quantity', 'discount'].includes(field as string)) {
          const qty = newRow.quantity != null ? Number(newRow.quantity) : null;
          const price = newRow.unitPrice != null ? Number(newRow.unitPrice) : null;
          const disc = Number(newRow.discount ?? 0);
          newRow.subtotalAmount =
            qty != null && price != null
              ? Math.round(qty * price * (1 - disc / 100) * 100) / 100
              : null;
        }
        return newRow;
      });
      onChange(updated);
    },
    [products, onChange]
  );

  const applyProductSelection = useCallback(
    (tempId: string, selection: ProductSelectValue) => {
      const updated = products.map((p) => {
        if (p.tempId !== tempId) return p;
        const newRow: OpportunityProductFormItem = {
          ...p,
          productName: selection.productName,
          productNumber: selection.productNumber,
          productPrice: selection.standardPrice,
          unitPrice: selection.standardPrice,
        };
        const qty = newRow.quantity != null ? Number(newRow.quantity) : null;
        const price = newRow.unitPrice != null ? Number(newRow.unitPrice) : null;
        const disc = Number(newRow.discount ?? 0);
        newRow.subtotalAmount =
          qty != null && price != null
            ? Math.round(qty * price * (1 - disc / 100) * 100) / 100
            : null;
        return newRow;
      });
      onChange(updated);
    },
    [products, onChange]
  );

  const addRow = useCallback(() => {
    onChange([...products, createEmptyProductItem()]);
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
                  单价*
                </th>
                <th className="w-20 px-2 py-2 text-right font-medium text-muted-foreground">
                  数量*
                </th>
                <th className="w-20 px-2 py-2 text-right font-medium text-muted-foreground">
                  折扣(%)
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
                      className="h-8 text-sm"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      type="number"
                      step="0.01"
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
                      step="1"
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
                      step="1"
                      min="0"
                      max="100"
                      value={product.discount ?? ''}
                      onChange={(e) =>
                        updateRow(
                          product.tempId,
                          'discount',
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      placeholder="0"
                      className="h-8 text-right text-sm"
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

/** 根据 FormModeContext 选择渲染哪个 products 表（不传 noop handler） */
function ProductsTableSwitch({
  entity,
  formData,
  onProductsChange,
}: {
  entity: OpportunityProfile | null;
  formData: OpportunityFormData;
  onProductsChange?: (products: OpportunityProductFormItem[]) => void;
}) {
  const { mode } = useFormMode();
  if (mode === 'view') {
    return <ReadonlyProductsTable products={entity?.products ?? null} />;
  }
  return (
    <EditableProductsTable
      products={formData.products ?? []}
      onChange={(p) => onProductsChange?.(p)}
    />
  );
}

/**
 * 商机名称：由后端按「客户名 - 日期 - 金额」自动生成；前端表单一律只读。
 * create 模式空 + placeholder；edit 模式显示当前值（disabled）；view 模式走 viewContent。
 */
function OpportunityNameField({
  formData,
  error,
}: {
  formData: OpportunityFormData;
  error?: string;
}) {
  return (
    <FormField
      name="opportunityName"
      label="商机名称"
      error={error}
      viewContent={formData.opportunityName}
    >
      <Input
        id="opportunityName"
        placeholder="提交后自动生成"
        value={formData.opportunityName ?? ''}
        disabled
        readOnly
      />
    </FormField>
  );
}

/**
 * 商机金额输入：edit 模式 + 有 products 时禁用并展示子表小计；view 模式直接展示金额。
 */
function OpportunityAmountField({
  formData,
  updateFormField,
  error,
}: {
  formData: OpportunityFormData;
  updateFormField: OpportunityFieldsProps['updateFormField'];
  error?: string;
}) {
  const { mode } = useFormMode();
  const hasProducts = (formData.products?.length ?? 0) > 0;
  const productSubtotalTotal = useMemo(
    () =>
      Math.round(
        (formData.products ?? []).reduce(
          (sum, product) => sum + Number(product.subtotalAmount ?? 0),
          0
        ) * 100
      ) / 100,
    [formData.products]
  );
  const isView = mode === 'view';
  return (
    <FormField
      name="opportunityAmount"
      label="商机金额"
      required
      error={error}
      viewContent={
        // view 模式下，若有 products 子表，优先显示自动汇总（与 edit 模式一致）；
        // 否则展示后端 opportunityAmount。Number(null)=0 会显示 "0.00"，故先判 != null。
        hasProducts
          ? productSubtotalTotal.toFixed(2)
          : formData.opportunityAmount != null && !Number.isNaN(Number(formData.opportunityAmount))
            ? Number(formData.opportunityAmount).toFixed(2)
            : undefined
      }
      helpText={!isView && hasProducts ? '由产品明细小计自动汇总' : undefined}
    >
      <Input
        id="opportunityAmount"
        type="number"
        step="0.01"
        placeholder={hasProducts ? '由产品明细小计自动汇总' : '请输入商机金额'}
        value={hasProducts ? productSubtotalTotal.toFixed(2) : (formData.opportunityAmount ?? '')}
        disabled={hasProducts}
        onChange={(e) =>
          updateFormField('opportunityAmount', e.target.value ? Number(e.target.value) : null)
        }
      />
    </FormField>
  );
}

export function renderOpportunityFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
  onProductsChange,
}: OpportunityFieldsProps) {
  return (
    <>
      <OpportunityNameField formData={formData} error={getFieldError('opportunityName')} />

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

      <FormField
        name="contactId"
        label="联系人"
        error={getFieldError('contactId')}
        viewContent={
          <RelatedEntityLink
            entityType="contact"
            id={entity?.contact?.id ?? formData.contactId}
            label={entity?.contact?.contactName}
          />
        }
      >
        <ContactSelect
          value={formData.contactId ?? ''}
          onChange={(v) => updateFormField('contactId', v || null)}
          customerId={formData.customerId}
          placeholder="搜索并选择联系人"
        />
      </FormField>

      <FormField
        name="opportunityStage"
        label="商机阶段"
        required
        error={getFieldError('opportunityStage')}
        viewContent={
          formData.opportunityStage ? (
            <StatusBadge status={formData.opportunityStage} statusMap={opportunityStageMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...opportunityStageOptions]}
          value={formData.opportunityStage ?? ''}
          onValueChange={(v) => updateFormField('opportunityStage', v || null)}
        />
      </FormField>

      <OpportunityAmountField
        formData={formData}
        updateFormField={updateFormField}
        error={getFieldError('opportunityAmount')}
      />

      <FormField
        name="winRate"
        label="赢单率(%)"
        error={getFieldError('winRate')}
        viewContent={formData.winRate != null ? `${Number(formData.winRate)}%` : undefined}
      >
        <Input
          id="winRate"
          type="number"
          step="1"
          min="0"
          max="100"
          placeholder="请输入赢单率（0-100）"
          value={formData.winRate ?? ''}
          onChange={(e) =>
            updateFormField('winRate', e.target.value ? Number(e.target.value) : null)
          }
        />
      </FormField>

      <FormField
        name="expectedDealDate"
        label="预计成交日期"
        required
        error={getFieldError('expectedDealDate')}
        viewContent={formatDateDisplay(formData.expectedDealDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.expectedDealDate)}
          onDateChange={(date) =>
            updateFormField('expectedDealDate', date ? formatDateToLocalDateString(date) : null)
          }
          placeholder="选择预计成交日期"
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

      <FormField
        name="lostDate"
        label="输单日期"
        error={getFieldError('lostDate')}
        viewContent={formatDateDisplay(formData.lostDate) || undefined}
      >
        <DatePicker
          date={parseLocalDateString(formData.lostDate)}
          onDateChange={(date) =>
            updateFormField('lostDate', date ? formatDateToLocalDateString(date) : null)
          }
          placeholder={
            formData.opportunityStage === '输单流失'
              ? '不填写则默认为当前时间'
              : '商机阶段=输单流失 时启用'
          }
          className="w-full"
        />
      </FormField>

      <FormField
        name="loseReason"
        label="失单原因"
        required={formData.opportunityStage === '输单流失'}
        error={getFieldError('loseReason')}
        viewContent={formData.loseReason}
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...opportunityLoseReasonOptions]}
          value={formData.loseReason ?? ''}
          onValueChange={(v) => {
            updateFormField('loseReason', v || null);
            // 切到非「其他」时清空 detail，避免脏数据残留
            if (v !== '其他') updateFormField('loseReasonDetail', null);
          }}
        />
      </FormField>

      {formData.loseReason === '其他' && (
        <FormField
          name="loseReasonDetail"
          label="失单原因说明"
          required
          fullRow
          error={getFieldError('loseReasonDetail')}
          viewContent={formData.loseReasonDetail}
        >
          <Textarea
            id="loseReasonDetail"
            placeholder="请填写具体的失单原因说明"
            value={formData.loseReasonDetail ?? ''}
            onChange={(e) => updateFormField('loseReasonDetail', e.target.value || null)}
            rows={3}
          />
        </FormField>
      )}

      <ProductsTableSwitch
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
// DrawerStack 二级抽屉：商机详情视图
// ============================================================================

function OpportunityDetailView({ id }: { id: string }) {
  const crud = useDrawerEntityDetail<IOpportunityResponse, OpportunityFormData>({
    endpoint: '/opportunities',
    id,
    entityType: 'opportunity',
    // @ts-expect-error: schema 校验 ICreateOpportunity；products.tempId 是 UI-only 字段
    schema: opportunityFormSchema,
    toFormData: (data) => toOpportunityFormData(toOpportunityProfile(data)),
    toPayload: toOpportunityUpdatePayload,
    // entityNameOf 不传 → useDrawerEntityDetail 默认走 getEntityDisplayName('opportunity', e, 'long')
  });
  useEntityHeaderActions(crud);

  const handleProductsChange = useCallback(
    (products: OpportunityProductFormItem[]) => {
      crud.updateFormField('products', products);
      crud.updateFormField('productsTouched', true);
    },
    [crud]
  );

  return (
    <EntityDetailBody
      mode={crud.mode}
      loading={crud.loading}
      error={crud.error}
      hasData={!!crud.data}
      onRetry={crud.refetch}
      deleteConfirmProps={crud.deleteConfirmProps}
      notFoundHint="商机不存在"
      changeLogTarget={{ module: 'opportunities', target: id }}
    >
      {renderOpportunityFields({
        entity: crud.data ? toOpportunityProfile(crud.data) : null,
        formData: crud.formData,
        updateFormField: crud.updateFormField,
        getFieldError: crud.getFieldError,
        onProductsChange: handleProductsChange,
      })}
    </EntityDetailBody>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：商机创建视图（含产品明细）
// ============================================================================

function OpportunityCreateView({ presets }: { presets?: Record<string, unknown> }) {
  const drawerStack = useDrawerStack();
  const { user } = useAuthStore();
  const currentEmployeeId = user?.employee?.id ?? user?.id ?? null;
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';

  const initialFormData = useMemo<OpportunityFormData>(
    () => ({
      opportunityName: '',
      customerId: presetCustomerId,
      contactId: null,
      opportunityStage: null,
      opportunityAmount: null,
      winRate: null,
      expectedDealDate: null,
      lostDate: null,
      chargerId: currentEmployeeId,
      loseReason: null,
      loseReasonDetail: null,
      remark: null,
      products: [],
      productsTouched: false,
    }),
    [presetCustomerId, currentEmployeeId]
  );

  const create = useDrawerCreate<OpportunityFormData>({
    endpoint: '/opportunities',
    // @ts-expect-error: schema 校验 ICreateOpportunity；products.tempId 是 UI-only 字段
    schema: opportunityFormSchema,
    initialFormData,
    formToPayload: toOpportunityPayload,
    onSuccess: () => drawerStack.pop(),
  });

  const handleProductsChange = useCallback(
    (products: OpportunityProductFormItem[]) => {
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
      {renderOpportunityFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
        onProductsChange: handleProductsChange,
      })}
    </DrawerCreateShell>
  );
}

registerEntityDetail('opportunity', {
  defaultTitle: '商机详情',
  defaultCreateTitle: '新建商机',
  render: (id) => <OpportunityDetailView id={id} />,
  renderCreate: (presets) => <OpportunityCreateView presets={presets} />,
});
