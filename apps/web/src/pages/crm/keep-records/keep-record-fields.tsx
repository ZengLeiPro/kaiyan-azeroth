/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { KEEP_RECORD_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { KEEP_RECORD_TYPE_OPTIONS } from '@ky-azeroth/shared/constants/status-values';
import type { IKeepRecordResponse } from '@ky-azeroth/shared/types/keep-record';
import { useMemo } from 'react';

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
import { MultiFileUpload } from '@/components/patterns/multi-file-upload';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MultiSelect, Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerCreate } from '@/hooks/use-drawer-create';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { useFileUpload } from '@/hooks/use-file-upload';
import { formatDateToLocalDateString, getNowDateTimeLocalString } from '@/lib/date-utils';
import { keepRecordStatusMap, keepRecordTypeMap } from '@/lib/status-maps';
import { useAuthStore } from '@/stores/auth';

import {
  type KeepRecordFormData,
  keepRecordFormSchema,
  type KeepRecordProfile,
  toKeepRecordFormData,
  toKeepRecordIntentFormData,
  toKeepRecordPayload,
  toKeepRecordProfile,
} from './types';

const keepRecordStatusOptions = Object.entries(KEEP_RECORD_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const intentTemperatureOptions = [
  { value: 'UNJUDGED', label: '未判断' },
  { value: 'HIGH', label: '高意向' },
  { value: 'MEDIUM', label: '中意向' },
  { value: 'LOW', label: '低意向' },
  { value: 'NONE', label: '无意向' },
];
const intentReasonOptions = [
  { value: 'PAIN_POINT', label: '明确痛点' },
  { value: 'ASKED_PRICE', label: '主动问价' },
  { value: 'DEMO', label: '愿约演示' },
  { value: 'VISIT', label: '愿约上门' },
  { value: 'BUDGET_UNCERTAIN', label: '预算未定' },
  { value: 'TIMING_UNCERTAIN', label: '时间未到' },
  { value: 'DECISION_MAKER_UNFOUND', label: '决策人未找到' },
  { value: 'REJECTED', label: '明确拒绝' },
];
const followUpDays: Record<string, number> = { HIGH: 3, MEDIUM: 10, LOW: 45 };
const suggestedFollowUpDate = (temperature: string) => {
  const days = followUpDays[temperature];
  if (!days) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateToLocalDateString(date);
};

export interface KeepRecordFieldsProps {
  entity: KeepRecordProfile | null;
  formData: KeepRecordFormData;
  updateFormField: <K extends keyof KeepRecordFormData>(
    key: K,
    value: KeepRecordFormData[K]
  ) => void;
  getFieldError: (key: keyof KeepRecordFormData) => string | undefined;
  /** 编辑/新建模式专用：附件上传函数；view 模式下传 noop */
  onUploadFile?: ReturnType<typeof useFileUpload>['uploadFile'];
}

/**
 * 内部组件：根据 FormModeContext 渲染附件控件（view 模式 disabled）。
 * 抽出避免在 fields 渲染函数顶层调 useFormMode 时违反 hooks 规则。
 */
function AttachmentsField({
  value,
  onChange,
  onUpload,
  error,
}: {
  value: KeepRecordFormData['attachments'];
  onChange: (files: KeepRecordFormData['attachments']) => void;
  onUpload?: ReturnType<typeof useFileUpload>['uploadFile'];
  error?: string;
}) {
  const { mode } = useFormMode();
  const isView = mode === 'view';

  // view 模式：绕开 FormField 的 viewContent muted 壳子（min-h-[40px] + inline flex 会
  // 压扁附件这种块级控件），直接画 Label + 只读 MultiFileUpload。详见
  // visit-record-fields.tsx 同名组件的注释。
  if (isView) {
    return (
      <div className="col-span-1 space-y-2 md:col-span-2">
        <Label>附件</Label>
        <MultiFileUpload
          value={value ?? []}
          onChange={() => {}}
          onUpload={() => Promise.reject(new Error('view-mode'))}
          readOnly
        />
      </div>
    );
  }

  return (
    <FormField name="attachments" label="附件" fullRow error={error}>
      <MultiFileUpload
        value={value ?? []}
        onChange={(files) => onChange(files.length > 0 ? files : null)}
        onUpload={onUpload ?? (() => Promise.reject(new Error('view-mode')))}
      />
    </FormField>
  );
}

export function renderKeepRecordFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
  onUploadFile,
}: KeepRecordFieldsProps) {
  return (
    <>
      <FormField
        name="customerId"
        label="客户"
        required
        error={getFieldError('customerId')}
        viewContent={
          <RelatedEntityLink
            entityType="customer"
            id={entity?.customer?.id ?? formData.customerId}
            label={entity?.customerName}
          />
        }
      >
        <CustomerSelect
          value={formData.customerId}
          onChange={(v) => updateFormField('customerId', v)}
          onSelectedCustomerChange={(customer) => {
            if (!customer || entity) return;
            const intent = toKeepRecordIntentFormData(customer);
            updateFormField('intentTemperature', intent.intentTemperature ?? 'UNJUDGED');
            updateFormField('intentReasons', intent.intentReasons);
            updateFormField('nextFollowUpAt', intent.nextFollowUpAt);
          }}
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
            label={entity?.contactName}
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
        name="keepRecordType"
        label="跟进类型"
        required
        error={getFieldError('keepRecordType')}
        viewContent={
          formData.keepRecordType ? (
            <StatusBadge status={formData.keepRecordType} statusMap={keepRecordTypeMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...KEEP_RECORD_TYPE_OPTIONS]}
          value={formData.keepRecordType || ''}
          onValueChange={(v) => updateFormField('keepRecordType', v)}
        />
      </FormField>

      <FormField
        name="keepRecordTime"
        label="跟进时间"
        required
        error={getFieldError('keepRecordTime')}
        viewContent={formData.keepRecordTime}
      >
        <Input
          id="keepRecordTime"
          type="datetime-local"
          value={formData.keepRecordTime || ''}
          onChange={(e) => updateFormField('keepRecordTime', e.target.value)}
        />
      </FormField>

      <FormField
        name="intentTemperature"
        label="意向温度"
        error={getFieldError('intentTemperature')}
        viewContent={
          intentTemperatureOptions.find((item) => item.value === formData.intentTemperature)?.label
        }
      >
        <Select
          options={[{ value: '', label: '未填写' }, ...intentTemperatureOptions]}
          value={formData.intentTemperature ?? ''}
          onValueChange={(value) => {
            updateFormField(
              'intentTemperature',
              (value || null) as KeepRecordFormData['intentTemperature']
            );
            const suggested = suggestedFollowUpDate(value);
            if (suggested) updateFormField('nextFollowUpAt', suggested);
          }}
        />
      </FormField>

      <FormField
        name="intentReasons"
        label="意向依据"
        error={getFieldError('intentReasons')}
        viewContent={formData.intentReasons
          ?.map(
            (item) => intentReasonOptions.find((option) => option.value === item)?.label ?? item
          )
          .join('、')}
      >
        <MultiSelect
          options={intentReasonOptions}
          value={formData.intentReasons ?? []}
          onChange={(values) =>
            updateFormField(
              'intentReasons',
              values.length ? (values as KeepRecordFormData['intentReasons']) : null
            )
          }
          placeholder="请选择意向依据"
        />
      </FormField>

      <FormField
        name="nextFollowUpAt"
        label="下次回访日期"
        error={getFieldError('nextFollowUpAt')}
        viewContent={formData.nextFollowUpAt ?? undefined}
      >
        <Input
          id="nextFollowUpAt"
          type="date"
          value={formData.nextFollowUpAt ?? ''}
          onChange={(event) => updateFormField('nextFollowUpAt', event.target.value || null)}
        />
      </FormField>

      <FormField
        name="keepRecordContent"
        label="跟进内容"
        required
        fullRow
        error={getFieldError('keepRecordContent')}
        viewContent={formData.keepRecordContent}
      >
        <Textarea
          id="keepRecordContent"
          placeholder="请输入跟进内容"
          rows={4}
          value={formData.keepRecordContent || ''}
          onChange={(e) => updateFormField('keepRecordContent', e.target.value)}
        />
      </FormField>

      <FormField
        name="keepRecordStatus"
        label="跟进状态"
        required
        error={getFieldError('keepRecordStatus')}
        viewContent={
          formData.keepRecordStatus ? (
            <StatusBadge status={formData.keepRecordStatus} statusMap={keepRecordStatusMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...keepRecordStatusOptions]}
          value={formData.keepRecordStatus || ''}
          onValueChange={(v) => updateFormField('keepRecordStatus', v)}
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
          onChange={(v) => updateFormField('chargerId', v)}
          placeholder="搜索并选择负责人"
        />
      </FormField>

      <AttachmentsField
        value={formData.attachments ?? null}
        onChange={(v) => updateFormField('attachments', v)}
        onUpload={onUploadFile}
        error={getFieldError('attachments')}
      />
    </>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：跟进记录详情视图
// ============================================================================

function KeepRecordDetailView({ id }: { id: string }) {
  const crud = useDrawerEntityDetail<IKeepRecordResponse, KeepRecordFormData>({
    endpoint: '/keep-records',
    id,
    entityType: 'keep-record',
    schema: keepRecordFormSchema,
    toFormData: (data) => toKeepRecordFormData(toKeepRecordProfile(data)),
    toPayload: toKeepRecordPayload,
    entityNameOf: (e) => `跟进 ${e.keepRecordTime || ''}`,
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
      notFoundHint="跟进记录不存在"
      changeLogTarget={{ module: 'keep-records', target: id }}
    >
      {renderKeepRecordFields({
        entity: crud.data ? toKeepRecordProfile(crud.data) : null,
        formData: crud.formData,
        updateFormField: crud.updateFormField,
        getFieldError: crud.getFieldError,
      })}
    </EntityDetailBody>
  );
}

// ============================================================================
// DrawerStack 二级抽屉：跟进记录创建视图
// ============================================================================

function KeepRecordCreateView({ presets }: { presets?: Record<string, unknown> }) {
  const drawerStack = useDrawerStack();
  const { user } = useAuthStore();
  const currentEmployeeId = user?.employee?.id ?? user?.id ?? null;
  const presetCustomerId = typeof presets?.customerId === 'string' ? presets.customerId : '';
  const { uploadFile } = useFileUpload();

  const initialFormData = useMemo<KeepRecordFormData>(
    () => ({
      customerId: presetCustomerId,
      contactId: null,
      keepRecordType: '',
      keepRecordTime: getNowDateTimeLocalString(),
      keepRecordContent: '',
      keepRecordStatus: '',
      attachments: null,
      chargerId: currentEmployeeId ?? '',
    }),
    [presetCustomerId, currentEmployeeId]
  );

  const create = useDrawerCreate<KeepRecordFormData>({
    endpoint: '/keep-records',
    initialFormData,
    schema: keepRecordFormSchema,
    formToPayload: toKeepRecordPayload,
    onSuccess: () => drawerStack.pop(),
  });

  return (
    <DrawerCreateShell
      onSubmit={create.handleSubmit}
      onCancel={drawerStack.pop}
      submitting={create.submitting}
    >
      {renderKeepRecordFields({
        entity: null,
        formData: create.formData,
        updateFormField: create.updateFormField,
        getFieldError: create.getFieldError,
        onUploadFile: uploadFile,
      })}
    </DrawerCreateShell>
  );
}

registerEntityDetail('keep-record', {
  defaultTitle: '跟进记录',
  defaultCreateTitle: '新建跟进',
  render: (id) => <KeepRecordDetailView id={id} />,
  renderCreate: (presets) => <KeepRecordCreateView presets={presets} />,
});
