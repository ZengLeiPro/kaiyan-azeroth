import {
  CLOUD_OWNER_CATEGORY,
  CLOUD_PRODUCT_CODE_VALUES,
  CLOUD_RENEWAL_INTENT,
  CLOUD_VENDOR,
  type CloudOwnerCategoryValue,
  type CloudRenewalIntentValue,
  type CloudVendorValue,
} from '@ky-azeroth/shared/constants/cloud-cost';
import {
  CLOUD_OWNER_CATEGORY_LABELS,
  CLOUD_RENEWAL_INTENT_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';

import { FormField } from '@/components/patterns/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { UseCrudReturn } from '@/hooks/use-crud';

import type { CloudInstanceMetaFormData, CloudInstanceMetaProfile } from '../types';

const vendorOptions = Object.values(CLOUD_VENDOR).map((v) => ({ value: v, label: v }));
const productCodeOptions = CLOUD_PRODUCT_CODE_VALUES.map((v) => ({ value: v, label: v }));
const ownerCategoryOptions = Object.values(CLOUD_OWNER_CATEGORY).map((v) => ({
  value: v,
  label: CLOUD_OWNER_CATEGORY_LABELS[v] || v,
}));
const renewalIntentOptions = Object.values(CLOUD_RENEWAL_INTENT).map((v) => ({
  value: v,
  label: CLOUD_RENEWAL_INTENT_LABELS[v] || v,
}));

interface Props {
  crud: UseCrudReturn<CloudInstanceMetaProfile, CloudInstanceMetaFormData>;
}

export function CloudInstanceMetaFormFields({ crud }: Props) {
  const { formData, updateFormField, getFieldError } = crud;

  return (
    <>
      <FormField
        name="vendor"
        label="厂商"
        required
        error={getFieldError('vendor')}
        viewContent={formData.vendor}
      >
        <Select
          options={vendorOptions}
          value={formData.vendor || ''}
          onValueChange={(v) => updateFormField('vendor', v as CloudVendorValue)}
        />
      </FormField>

      <FormField
        name="productCode"
        label="产品代码"
        required
        error={getFieldError('productCode')}
        viewContent={formData.productCode}
      >
        <Select
          options={productCodeOptions}
          value={formData.productCode || ''}
          onValueChange={(v) => updateFormField('productCode', v)}
        />
      </FormField>

      <FormField
        name="instanceId"
        label="实例 ID"
        required
        error={getFieldError('instanceId')}
        viewContent={formData.instanceId}
        fullRow
      >
        <Input
          id="instanceId"
          placeholder="如 i-wz959zfflu6v05p005k8 / fc_cu_dp_cn-xxx"
          value={formData.instanceId}
          onChange={(e) => updateFormField('instanceId', e.target.value)}
        />
      </FormField>

      <FormField
        name="alias"
        label="别名"
        error={getFieldError('alias')}
        viewContent={formData.alias}
      >
        <Input
          id="alias"
          placeholder="如 Agent FC CU 包"
          value={formData.alias ?? ''}
          onChange={(e) => updateFormField('alias', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="ownerName"
        label="归属名称"
        error={getFieldError('ownerName')}
        viewContent={formData.ownerName}
      >
        <Input
          id="ownerName"
          placeholder="客户名 / 内部模块名"
          value={formData.ownerName ?? ''}
          onChange={(e) => updateFormField('ownerName', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="ownerCategory"
        label="归属类别"
        error={getFieldError('ownerCategory')}
        viewContent={
          formData.ownerCategory ? CLOUD_OWNER_CATEGORY_LABELS[formData.ownerCategory] : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...ownerCategoryOptions]}
          value={formData.ownerCategory ?? ''}
          onValueChange={(v) =>
            updateFormField('ownerCategory', v ? (v as CloudOwnerCategoryValue) : null)
          }
        />
      </FormField>

      <FormField
        name="renewalIntent"
        label="续费意愿"
        error={getFieldError('renewalIntent')}
        viewContent={
          formData.renewalIntent ? CLOUD_RENEWAL_INTENT_LABELS[formData.renewalIntent] : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...renewalIntentOptions]}
          value={formData.renewalIntent ?? ''}
          onValueChange={(v) =>
            updateFormField('renewalIntent', v ? (v as CloudRenewalIntentValue) : null)
          }
        />
      </FormField>

      <FormField
        name="archived"
        label="已归档"
        error={getFieldError('archived')}
        viewContent={formData.archived ? '是' : '否'}
      >
        <div className="flex items-center gap-2">
          <Switch
            checked={!!formData.archived}
            onCheckedChange={(v) => updateFormField('archived', v)}
          />
          <span className="text-sm text-muted-foreground">
            {formData.archived ? '已归档' : '未归档'}
          </span>
        </div>
      </FormField>

      <FormField
        name="purpose"
        label="用途说明"
        error={getFieldError('purpose')}
        viewContent={formData.purpose}
        fullRow
      >
        <Textarea
          id="purpose"
          placeholder="详细描述该实例的业务用途、关键链路等"
          value={formData.purpose ?? ''}
          rows={3}
          onChange={(e) => updateFormField('purpose', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="notes"
        label="备注"
        error={getFieldError('notes')}
        viewContent={formData.notes}
        fullRow
      >
        <Textarea
          id="notes"
          placeholder="其他备注信息"
          value={formData.notes ?? ''}
          rows={2}
          onChange={(e) => updateFormField('notes', e.target.value || null)}
        />
      </FormField>
    </>
  );
}
