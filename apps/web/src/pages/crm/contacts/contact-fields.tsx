/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { GENDER_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import type { IContactResponse } from '@ky-azeroth/shared/types/contact';
import { useMemo } from 'react';

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
import { StatusBadge } from '@/components/patterns/status-badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerCreate } from '@/hooks/use-drawer-create';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { genderMap } from '@/lib/status-maps';

import {
  type ContactFormData,
  contactFormSchema,
  type ContactProfile,
  toContactFormData,
  toContactPayload,
} from './types';

const sexOptions = Object.entries(GENDER_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export interface ContactFieldsProps {
  entity: ContactProfile | null;
  formData: ContactFormData;
  updateFormField: <K extends keyof ContactFormData>(key: K, value: ContactFormData[K]) => void;
  getFieldError: (key: keyof ContactFormData) => string | undefined;
}

/**
 * Contact 表单字段渲染。Page（编辑/新建/查看）与 DrawerStack 二级抽屉（只读）共用。
 *
 * 是否只读由外层 FormModeProvider 决定（FormDialog 与 ContactDetailView 各自包了它）。
 * 不在这里读 isViewMode prop，避免与 FormField 内部的 useFormMode 冲突。
 */
export function renderContactFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
}: ContactFieldsProps) {
  return (
    <>
      <FormField
        name="contactName"
        label="联系人姓名"
        required
        error={getFieldError('contactName')}
        viewContent={formData.contactName}
      >
        <Input
          id="contactName"
          placeholder="请输入联系人姓名"
          value={formData.contactName}
          onChange={(e) => updateFormField('contactName', e.target.value)}
        />
      </FormField>

      <FormField
        name="customerId"
        label="所属客户"
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
        name="sex"
        label="性别"
        error={getFieldError('sex')}
        viewContent={
          formData.sex ? <StatusBadge status={formData.sex} statusMap={genderMap} /> : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...sexOptions]}
          value={formData.sex ?? ''}
          onValueChange={(v) => updateFormField('sex', v || null)}
        />
      </FormField>

      <FormField
        name="mobile"
        label="手机号"
        error={getFieldError('mobile')}
        viewContent={formData.mobile}
      >
        <Input
          id="mobile"
          placeholder="请输入手机号"
          value={formData.mobile ?? ''}
          onChange={(e) => updateFormField('mobile', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="phone"
        label="电话"
        error={getFieldError('phone')}
        viewContent={formData.phone}
      >
        <Input
          id="phone"
          placeholder="请输入电话"
          value={formData.phone ?? ''}
          onChange={(e) => updateFormField('phone', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="email"
        label="邮箱"
        error={getFieldError('email')}
        viewContent={formData.email}
      >
        <Input
          id="email"
          type="email"
          placeholder="请输入邮箱"
          value={formData.email ?? ''}
          onChange={(e) => updateFormField('email', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="wechat"
        label="微信"
        error={getFieldError('wechat')}
        viewContent={formData.wechat}
      >
        <Input
          id="wechat"
          placeholder="请输入微信号"
          value={formData.wechat ?? ''}
          onChange={(e) => updateFormField('wechat', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="position"
        label="职位"
        error={getFieldError('position')}
        viewContent={formData.position}
      >
        <Input
          id="position"
          placeholder="请输入职位"
          value={formData.position ?? ''}
          onChange={(e) => updateFormField('position', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="department"
        label="部门"
        error={getFieldError('department')}
        viewContent={formData.department}
      >
        <Input
          id="department"
          placeholder="请输入部门"
          value={formData.department ?? ''}
          onChange={(e) => updateFormField('department', e.target.value || null)}
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
          placeholder="请输入备注信息"
          value={formData.remark ?? ''}
          onChange={(e) => updateFormField('remark', e.target.value || null)}
          rows={3}
        />
      </FormField>
      <ContactAuditFields entity={entity} />
    </>
  );
}

function ContactAuditFields({ entity }: { entity: ContactProfile | null }) {
  const { mode } = useFormMode();

  // 创建人和修改人由服务端审计字段提供，仅在详情模式展示。
  if (mode !== 'view' || !entity) return null;

  return (
    <>
      <FormField
        name="updatedAt"
        label="最近修改"
        forceView
        viewContent={
          entity.updatedAt ? formatDateTimeDisplay(entity.updatedAt) || undefined : undefined
        }
      />
      <FormField name="createdBy" label="创建人" forceView viewContent={entity.createdBy} />
      <FormField name="updatedBy" label="修改人" forceView viewContent={entity.updatedBy} />
    </>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：联系人详情视图
// ============================================================================

function ContactDetailView({ id }: { id: string }) {
  const crud = useDrawerEntityDetail<IContactResponse, ContactFormData>({
    endpoint: '/contacts',
    id,
    entityType: 'contact',
    schema: contactFormSchema,
    toFormData: toContactFormData,
    toPayload: toContactPayload,
    entityNameOf: (e) => e.contactName,
  });
  useEntityHeaderActions(crud);

  return (
    <EntityDetailBody
      mode={crud.mode}
      loading={crud.loading}
      error={crud.error}
      hasData={!!crud.data}
      onRetry={crud.refetch}
      deleteConfirmProps={crud.deleteConfirmProps}
      notFoundHint="联系人不存在"
      changeLogTarget={{ module: 'contacts', target: id }}
    >
      {renderContactFields({
        entity: (crud.data as ContactProfile | null) ?? null,
        formData: crud.formData,
        updateFormField: crud.updateFormField,
        getFieldError: crud.getFieldError,
      })}
    </EntityDetailBody>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：联系人创建视图
// ============================================================================

function ContactCreateView({ presets }: { presets?: Record<string, unknown> }) {
  const drawerStack = useDrawerStack();
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';

  const initialFormData = useMemo<ContactFormData>(
    () => ({
      contactName: '',
      customerId: presetCustomerId,
      sex: null,
      mobile: null,
      phone: null,
      email: null,
      wechat: null,
      position: null,
      department: null,
      remark: null,
    }),
    [presetCustomerId]
  );

  const create = useDrawerCreate<ContactFormData>({
    endpoint: '/contacts',
    initialFormData,
    schema: contactFormSchema,
    formToPayload: toContactPayload,
    onSuccess: () => drawerStack.pop(),
  });

  return (
    <DrawerCreateShell
      onSubmit={create.handleSubmit}
      onCancel={drawerStack.pop}
      submitting={create.submitting}
    >
      {renderContactFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
      })}
    </DrawerCreateShell>
  );
}

// 模块顶层注册（被 register-drawer-entities.ts import 时触发）
registerEntityDetail('contact', {
  defaultTitle: '联系人详情',
  defaultCreateTitle: '新建联系人',
  render: (id) => <ContactDetailView id={id} />,
  renderCreate: (presets) => <ContactCreateView presets={presets} />,
});
