import { checkCustomerDuplicateSchema } from '@ky-azeroth/shared/schemas/customer';
import type {
  CustomerDuplicateMatchField,
  ICheckCustomerDuplicate,
  ICustomerDuplicateCheckResponse,
} from '@ky-azeroth/shared/types/customer';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, getErrorMessage } from '@/lib/api';

type DuplicateCheckFormState = {
  customerName: string;
  phone: string;
  uncId: string;
  organizationId: string;
};

type DuplicateCheckFieldErrors = Partial<Record<keyof DuplicateCheckFormState, string>>;

export type CustomerDuplicateCreatePrefill = Pick<
  DuplicateCheckFormState,
  'customerName' | 'uncId' | 'organizationId'
>;

const MATCHED_FIELD_LABELS: Partial<Record<CustomerDuplicateMatchField, string>> = {
  customerName: '客户名称',
  contactPhone: '联系人电话',
  uncId: '统一信用代码',
  organizationId: '组织ID',
};

const EMPTY_FORM: DuplicateCheckFormState = {
  customerName: '',
  phone: '',
  uncId: '',
  organizationId: '',
};

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDuplicatePayload(form: DuplicateCheckFormState): ICheckCustomerDuplicate {
  return {
    customerName: blankToNull(form.customerName),
    phone: blankToNull(form.phone),
    uncId: blankToNull(form.uncId),
    organizationId: blankToNull(form.organizationId),
  };
}

export function CustomerDuplicateCheckDialog({
  open,
  onOpenChange,
  onCreateCustomer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateCustomer?: (prefill: CustomerDuplicateCreatePrefill) => void;
}) {
  const [form, setForm] = useState<DuplicateCheckFormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<DuplicateCheckFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<ICustomerDuplicateCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);

  const hasCriterion = useMemo(
    () => Object.values(form).some((value) => Boolean(value.trim())),
    [form]
  );

  const updateField = (field: keyof DuplicateCheckFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setSubmitError(null);
  };

  const handleCreateCustomer = () => {
    onCreateCustomer?.({
      customerName: form.customerName.trim(),
      uncId: form.uncId.trim(),
      organizationId: form.organizationId.trim(),
    });
  };

  const handleCheck = async () => {
    const parsed = checkCustomerDuplicateSchema.safeParse(toDuplicatePayload(form));
    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        customerName: flattened.customerName?.[0],
        phone: flattened.phone?.[0],
        uncId: flattened.uncId?.[0],
        organizationId: flattened.organizationId?.[0],
      });
      setResult(null);
      return;
    }

    setChecking(true);
    setSubmitError(null);
    try {
      const response = await api.post<ICustomerDuplicateCheckResponse>(
        '/customers/duplicate-check',
        parsed.data
      );
      setResult(response.data);
    } catch (error) {
      setSubmitError(getErrorMessage(error));
      setResult(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="客户查重"
      desktopMaxWidth="max-w-[760px]"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {result?.total === 0 && onCreateCustomer && (
            <Button type="button" variant="secondary" onClick={handleCreateCustomer}>
              <Plus className="mr-2 h-4 w-4" />
              未重复，去新建客户
            </Button>
          )}
          <Button type="button" onClick={handleCheck} disabled={!hasCriterion || checking}>
            <Search className="mr-2 h-4 w-4" />
            {checking ? '查重中...' : '开始查重'}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="create">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField name="customerName" label="客户名称" error={fieldErrors.customerName}>
            <Input
              id="customerName"
              value={form.customerName}
              onChange={(event) => updateField('customerName', event.target.value)}
              placeholder="输入完整客户名称"
            />
          </FormField>
          <FormField name="phone" label="联系人电话" error={fieldErrors.phone}>
            <Input
              id="phone"
              value={form.phone}
              onChange={(event) => updateField('phone', event.target.value)}
              placeholder="输入电话/手机匹配联系人"
            />
          </FormField>
          <FormField name="uncId" label="统一信用代码" error={fieldErrors.uncId}>
            <Input
              id="uncId"
              value={form.uncId}
              onChange={(event) => updateField('uncId', event.target.value)}
              placeholder="输入统一信用代码"
            />
          </FormField>
          <FormField
            name="organizationId"
            label="组织ID"
            error={fieldErrors.organizationId}
            fullRow
          >
            <Input
              id="organizationId"
              value={form.organizationId}
              onChange={(event) => updateField('organizationId', event.target.value)}
              placeholder="输入上游组织ID"
            />
          </FormField>
        </div>
      </FormModeProvider>

      {submitError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {submitError}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {result.total > 0 ? `发现 ${result.total} 个潜在重复客户` : '未发现重复客户'}
          </div>
          {result.items.length > 0 && (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {result.items.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {/* accessible（公海/自己范围内）→ 穿透打开详情抽屉；别人私海保持纯文本 */}
                      {item.accessible ? (
                        <RelatedEntityLink
                          entityType="customer"
                          id={item.id}
                          label={item.customerName}
                          title={item.customerName}
                        />
                      ) : (
                        <div className="truncate font-medium">{item.customerName}</div>
                      )}
                      <div className="mt-1 text-xs text-muted-foreground">{item.serialNumber}</div>
                    </div>
                    <Badge variant={item.pool === 'public' ? 'info' : 'secondary'}>
                      {item.pool === 'public' ? '公海' : item.chargerName || '私海'}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                    <div className="text-muted-foreground">
                      统一信用代码：<span className="text-foreground">{item.uncId || '-'}</span>
                    </div>
                    <div className="text-muted-foreground">
                      组织ID：<span className="text-foreground">{item.organizationId || '-'}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.matchedFields.map((field) => (
                      <Badge key={field} variant="outline">
                        命中：{MATCHED_FIELD_LABELS[field] ?? field}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ResponsiveDialog>
  );
}
