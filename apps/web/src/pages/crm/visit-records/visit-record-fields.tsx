/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import { VISIT_TYPE_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import type { IVisitRecordResponse } from '@ky-azeroth/shared/types/visit-record';

import {
  type BusinessApprovalContext,
  normalizeBusinessApprovalContext,
} from '@/components/patterns/business-approval-context';
import { BusinessApprovalFallback } from '@/components/patterns/business-approval-fallback';
import { BusinessApprovalSection } from '@/components/patterns/business-approval-section';
import { ContactSelect } from '@/components/patterns/contact-select';
import { CustomerSelect } from '@/components/patterns/customer-select';
import {
  EntityDetailBody,
  registerEntityDetail,
  useEntityHeaderActions,
} from '@/components/patterns/drawer-stack';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, useFormMode } from '@/components/patterns/form-field';
import { GeolocationButton } from '@/components/patterns/geolocation-button';
import { MultiFileUpload } from '@/components/patterns/multi-file-upload';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { useFileUpload } from '@/hooks/use-file-upload';
import type { GeolocationPosition } from '@/hooks/use-geolocation';
import { visitTypeMap } from '@/lib/status-maps';

import {
  toVisitRecordFormData,
  toVisitRecordPayload,
  toVisitRecordProfile,
  type VisitRecordFormData,
  visitRecordFormSchema,
  type VisitRecordProfile,
} from './types';

/** 拜访类型选项：从 shared VISIT_TYPE_LABELS 生成，消除前端本地枚举 */
const visitTypeOptions = Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export interface VisitRecordFieldsProps {
  entity: VisitRecordProfile | null;
  formData: VisitRecordFormData;
  updateFormField: <K extends keyof VisitRecordFormData>(
    key: K,
    value: VisitRecordFormData[K]
  ) => void;
  getFieldError: (key: keyof VisitRecordFormData) => string | undefined;
  onLocationDetected?: (coords: GeolocationPosition) => void;
  onUploadFile?: ReturnType<typeof useFileUpload>['uploadFile'];
}

function SignAddressField({
  value,
  onChange,
  onLocationDetected,
  error,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  onLocationDetected?: (c: GeolocationPosition) => void;
  error?: string;
}) {
  const { mode } = useFormMode();
  const isView = mode === 'view';
  return (
    <FormField
      name="signAddress"
      label="签到地址"
      required
      fullRow
      error={error}
      viewContent={value}
    >
      <div className="flex gap-2">
        <Input
          id="signAddress"
          placeholder="请输入签到地址或点击定位"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="flex-1"
        />
        <GeolocationButton
          onLocationDetected={onLocationDetected ?? (() => undefined)}
          disabled={isView}
        />
      </div>
    </FormField>
  );
}

function AttachmentsField({
  value,
  onChange,
  onUpload,
  error,
}: {
  value: VisitRecordFormData['attachments'];
  onChange: (files: VisitRecordFormData['attachments']) => void;
  onUpload?: ReturnType<typeof useFileUpload>['uploadFile'];
  error?: string;
}) {
  const { mode } = useFormMode();
  const isView = mode === 'view';

  // view 模式：绕开 FormField 的 viewContent muted 壳子（min-h-[40px] + inline flex 会
  // 压扁附件这种块级控件），直接画 Label + 只读 MultiFileUpload。
  // FormField 的 viewContent 设计目标是单行文本字段，附件场景不适用。
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
    <FormField name="attachments" label="附件" required fullRow error={error}>
      <MultiFileUpload
        value={value ?? []}
        onChange={(files) => onChange(files.length > 0 ? files : null)}
        onUpload={onUpload ?? (() => Promise.reject(new Error('view-mode')))}
      />
    </FormField>
  );
}

export function renderVisitRecordFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
  onLocationDetected,
  onUploadFile,
}: VisitRecordFieldsProps) {
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
            label={entity?.customer?.customerName}
          />
        }
      >
        <CustomerSelect
          value={formData.customerId}
          onChange={(v) => updateFormField('customerId', v)}
        />
      </FormField>

      <FormField
        name="contactId"
        label="联系人"
        required
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
        name="visitType"
        label="拜访类型"
        required
        error={getFieldError('visitType')}
        viewContent={
          formData.visitType ? (
            <StatusBadge status={formData.visitType} statusMap={visitTypeMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...visitTypeOptions]}
          value={formData.visitType || ''}
          onValueChange={(v) => updateFormField('visitType', v || null)}
        />
      </FormField>

      <FormField
        name="content"
        label="拜访内容"
        required
        fullRow
        error={getFieldError('content')}
        viewContent={formData.content}
      >
        <Textarea
          id="content"
          placeholder="请输入拜访内容"
          rows={4}
          value={formData.content || ''}
          onChange={(e) => updateFormField('content', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="signInTime"
        label="签到时间"
        required
        error={getFieldError('signInTime')}
        viewContent={formData.signInTime}
      >
        <Input
          id="signInTime"
          type="datetime-local"
          value={formData.signInTime || ''}
          onChange={(e) => updateFormField('signInTime', e.target.value || null)}
        />
      </FormField>

      <SignAddressField
        value={formData.signAddress ?? null}
        onChange={(v) => updateFormField('signAddress', v)}
        onLocationDetected={onLocationDetected}
        error={getFieldError('signAddress')}
      />

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
// DrawerStack 二级抽屉：拜访记录详情视图
// ============================================================================

function VisitRecordDetailView({
  id,
  approvalContext,
}: {
  id: string;
  approvalContext?: BusinessApprovalContext;
}) {
  const crud = useDrawerEntityDetail<IVisitRecordResponse, VisitRecordFormData>({
    endpoint: '/visit-records',
    id,
    entityType: 'visit-record',
    schema: visitRecordFormSchema,
    toFormData: (data) => toVisitRecordFormData(toVisitRecordProfile(data)),
    toPayload: toVisitRecordPayload,
    entityNameOf: (e) => `拜访 ${e.signInTime || ''}`,
  });
  useEntityHeaderActions(crud);

  if (crud.error && approvalContext?.approvalInstanceId) {
    return (
      <BusinessApprovalFallback
        approvalContext={approvalContext}
        defaultEventType={APPROVAL_EVENT_TYPE.VISIT_APPROVE}
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
      notFoundHint="拜访记录不存在"
      changeLogTarget={{ module: 'visit-records', target: id }}
    >
      <>
        <BusinessApprovalSection
          eventType={APPROVAL_EVENT_TYPE.VISIT_APPROVE}
          formId={id}
          flowStatus={crud.data?.flowStatus}
          approvalInstanceId={approvalContext?.approvalInstanceId}
          approvalEventType={approvalContext?.approvalEventType}
          onApprovalSuccess={approvalContext?.onApprovalSuccess}
          onSuccess={crud.refetch}
          className="col-span-2"
        />
        {renderVisitRecordFields({
          entity: crud.data ? toVisitRecordProfile(crud.data) : null,
          formData: crud.formData,
          updateFormField: crud.updateFormField,
          getFieldError: crud.getFieldError,
        })}
      </>
    </EntityDetailBody>
  );
}

registerEntityDetail('visit-record', {
  defaultTitle: '拜访记录',
  render: (id, context) => (
    <VisitRecordDetailView id={id} approvalContext={normalizeBusinessApprovalContext(context)} />
  ),
});
