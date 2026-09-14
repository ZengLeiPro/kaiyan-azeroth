/* eslint-disable react-refresh/only-export-components -- 字段渲染模块：renderXxxFields 函数 + 同文件内 DetailView 组件，是设计上的协同结构 */
import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import { COUNTRIES, DEFAULT_COUNTRY } from '@ky-azeroth/shared/constants/countries';
import {
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_RELATIONSHIP_LABELS,
  CUSTOMER_SOURCE_LABELS,
  CUSTOMER_TAG_LABELS,
  HEADCOUNT_RANGE_LABELS,
  INDUSTRY_LABELS,
  INTENT_TEMPERATURE_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import type { IndustryValue } from '@ky-azeroth/shared/constants/status-values';
import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';
import { useState } from 'react';

import {
  AddressPicker,
  type AddressValue,
  UNKNOWN_REGION_VALUE,
} from '@/components/patterns/address-picker';
import {
  type BusinessApprovalContext,
  normalizeBusinessApprovalContext,
} from '@/components/patterns/business-approval-context';
import { BusinessApprovalFallback } from '@/components/patterns/business-approval-fallback';
import { BusinessApprovalSection } from '@/components/patterns/business-approval-section';
import {
  EntityDetailBody,
  registerEntityDetail,
  useEntityHeaderActions,
} from '@/components/patterns/drawer-stack';
import { EmployeeMultiSelect } from '@/components/patterns/employee-multi-select';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { FormField, useFormMode } from '@/components/patterns/form-field';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect, Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDrawerEntityDetail } from '@/hooks/use-drawer-entity-detail';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import {
  contactStatusMap,
  customerLevelMap,
  customerRelationshipMap,
  customerSourceMap,
  customerTagMap,
  dealStatusMap,
  headcountRangeMap,
  industryMap,
  leadProgressStatusMap,
  leadStageMap,
} from '@/lib/status-maps';

import { CustomerDrawerBody } from './components/CustomerDrawerBody';
import { CustomerLeadProgressModal } from './components/CustomerLeadProgressModal';
import { CustomerLeadStageChangeModal } from './components/CustomerLeadStageChangeModal';
import {
  type CustomerFormData,
  customerFormSchema,
  type CustomerProfile,
  toCustomerFormData,
  toCustomerUpdatePayload,
} from './types';

const customerLevelOptions = Object.entries(CUSTOMER_LEVEL_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const customerSourceOptions = Object.entries(CUSTOMER_SOURCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const customerRelationshipOptions = Object.entries(CUSTOMER_RELATIONSHIP_LABELS).map(
  ([value, label]) => ({ value, label })
);
const customerTagOptions = Object.entries(CUSTOMER_TAG_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const headcountRangeOptions = Object.entries(HEADCOUNT_RANGE_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const industryOptions = Object.entries(INDUSTRY_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const baseCountryOptions = COUNTRIES.map((c) => ({ value: c.name, label: c.name }));

export interface CustomerFieldsProps {
  entity: CustomerProfile | null;
  formData: CustomerFormData;
  updateFormField: <K extends keyof CustomerFormData>(key: K, value: CustomerFormData[K]) => void;
  getFieldError: (key: keyof CustomerFormData) => string | undefined;
  /** view 模式下"申请改 MQL/SQL"审批提交成功后回调（典型用：crud.refetch/refresh 刷新详情） */
  onLeadStageChanged?: () => void;
}

/** view 模式独有的后端计算金额（应收账款） */
function ReadonlyTotalsFields({ entity }: { entity: CustomerProfile | null }) {
  const { mode } = useFormMode();
  if (mode !== 'view' || !entity) return null;
  return (
    <>
      <FormField
        name="accountsReceivable"
        label="应收账款"
        viewContent={
          entity.accountsReceivable != null
            ? Number(entity.accountsReceivable).toFixed(2)
            : undefined
        }
      />
    </>
  );
}

/** view 模式独有的只读状态（跟进状态 / 成交状态 / 线索阶段），新增/编辑不显示 */
function ReadonlyStatusFields({
  formData,
  entity,
  onLeadStageChanged,
}: {
  formData: CustomerFormData;
  entity: CustomerProfile | null;
  /** 申请变更审批提交成功后，父组件应刷新客户详情 */
  onLeadStageChanged?: () => void;
}) {
  const { mode } = useFormMode();
  const [leadStageModalOpen, setLeadStageModalOpen] = useState(false);
  const [leadProgressModalOpen, setLeadProgressModalOpen] = useState(false);

  if (mode !== 'view') return null;

  // 2026-06 改造后所有角色（含 ADMIN）都走"申请改 MQL/SQL"审批入口；
  // 若申请人即审批人，引擎 autoPassSelfTasksAndAdvance 会自动通过。
  // 实际可见性由 customers/edit 权限把关（已在路由/RBAC 处控制）。
  // 必须有 entity.version 才能发起（乐观锁），否则按钮禁用避免 silent 409。
  const hasVersion = typeof entity?.version === 'number';
  const canRequestChange = !!entity && hasVersion;

  return (
    <>
      <FormField
        name="contactStatus"
        label="跟进状态"
        forceView
        viewContent={
          formData.contactStatus ? (
            <StatusBadge status={formData.contactStatus} statusMap={contactStatusMap} />
          ) : undefined
        }
      />
      <FormField
        name="dealStatus"
        label="成交状态"
        forceView
        viewContent={
          formData.dealStatus ? (
            <StatusBadge status={formData.dealStatus} statusMap={dealStatusMap} />
          ) : undefined
        }
      />
      <FormField
        name="leadStage"
        label="线索阶段"
        forceView
        viewContent={
          <div className="flex items-center gap-2">
            {formData.leadStage ? (
              <StatusBadge status={formData.leadStage} statusMap={leadStageMap} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {canRequestChange && entity && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLeadStageModalOpen(true)}
              >
                申请改 MQL/SQL
              </Button>
            )}
          </div>
        }
      />
      <FormField
        name="leadProgressStatus"
        label="推进状态"
        forceView
        viewContent={
          entity?.leadProgressStatus ? (
            <StatusBadge status={entity.leadProgressStatus} statusMap={leadProgressStatusMap} />
          ) : undefined
        }
      />
      <FormField
        name="leadAppointmentAt"
        label="预约拜访时间"
        forceView
        viewContent={
          <div className="flex items-center gap-2">
            <span>
              {entity?.leadAppointmentAt
                ? formatDateTimeDisplay(entity.leadAppointmentAt) || '—'
                : '—'}
            </span>
            {canRequestChange && entity?.leadStage && entity.leadProgressStatus !== 'WON' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLeadProgressModalOpen(true)}
              >
                {entity.leadAppointmentAt ? '修改预约' : '安排拜访'}
              </Button>
            )}
          </div>
        }
      />
      {entity?.leadProgressReason && (
        <FormField
          name="leadProgressReason"
          label={entity.leadProgressStatus === 'NO_SHOW' ? '毁约原因' : '流失原因'}
          forceView
          viewContent={entity.leadProgressReason}
        />
      )}
      {canRequestChange && entity && typeof entity.version === 'number' && (
        <>
          <CustomerLeadStageChangeModal
            customerId={entity.id}
            customerName={entity.customerName}
            currentLeadStage={(entity.leadStage ?? null) as string | null}
            currentVersion={entity.version}
            open={leadStageModalOpen}
            onOpenChange={setLeadStageModalOpen}
            onSuccess={onLeadStageChanged}
          />
          <CustomerLeadProgressModal
            customerId={entity.id}
            customerName={entity.customerName}
            currentVersion={entity.version}
            currentAppointmentAt={entity.leadAppointmentAt}
            targetStatus="PENDING_VISIT"
            open={leadProgressModalOpen}
            onOpenChange={setLeadProgressModalOpen}
            onSuccess={onLeadStageChanged}
          />
        </>
      )}
    </>
  );
}

export function renderCustomerFields({
  entity,
  formData,
  updateFormField,
  getFieldError,
  onLeadStageChanged,
}: CustomerFieldsProps) {
  // 只有 country='中国' 时省/市/县可选；其他所有非中国值（含'未知'/港澳台/外国）都锁死显示「未知」
  const isNonChinaCountry = !!formData.country && formData.country !== DEFAULT_COUNTRY;
  const countryOptions =
    formData.country && !baseCountryOptions.some((option) => option.value === formData.country)
      ? [...baseCountryOptions, { value: formData.country, label: formData.country }]
      : baseCountryOptions;
  const addressValue = {
    province: isNonChinaCountry ? UNKNOWN_REGION_VALUE : (formData.province ?? ''),
    city: isNonChinaCountry ? UNKNOWN_REGION_VALUE : (formData.city ?? ''),
    district: isNonChinaCountry ? UNKNOWN_REGION_VALUE : (formData.district ?? ''),
    detail: formData.address ?? '',
  };

  return (
    <>
      <FormField
        name="customerName"
        label="客户名称"
        required
        error={getFieldError('customerName')}
        viewContent={formData.customerName}
      >
        <Input
          id="customerName"
          placeholder="请输入客户名称"
          value={formData.customerName}
          onChange={(e) => updateFormField('customerName', e.target.value)}
        />
      </FormField>

      <FormField
        name="industry"
        label="行业"
        required
        error={getFieldError('industry')}
        viewContent={
          formData.industry ? (
            <StatusBadge status={formData.industry} statusMap={industryMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...industryOptions]}
          value={formData.industry ?? ''}
          onValueChange={(v) => updateFormField('industry', v ? (v as IndustryValue) : null)}
        />
      </FormField>

      {/* 线索阶段（MQL/SQL）：所有角色（含 ADMIN）统一在 view 模式下通过 ReadonlyStatusFields 的
          "申请改 MQL/SQL" 按钮走审批入口；2026-06 改造已删除 PUT 直改字段路径。 */}

      <FormField
        name="customerLevel"
        label="客户等级"
        required
        error={getFieldError('customerLevel')}
        viewContent={
          formData.customerLevel ? (
            <StatusBadge status={formData.customerLevel} statusMap={customerLevelMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...customerLevelOptions]}
          value={formData.customerLevel ?? ''}
          onValueChange={(v) => updateFormField('customerLevel', v || null)}
        />
      </FormField>

      <FormField
        name="customerSource"
        label="客户来源"
        required
        error={getFieldError('customerSource')}
        viewContent={
          formData.customerSource ? (
            <StatusBadge status={formData.customerSource} statusMap={customerSourceMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...customerSourceOptions]}
          value={formData.customerSource ?? ''}
          onValueChange={(v) => updateFormField('customerSource', v || null)}
        />
      </FormField>

      <FormField
        name="customerRelationship"
        label="客户关系"
        required
        error={getFieldError('customerRelationship')}
        viewContent={
          formData.customerRelationship ? (
            <StatusBadge
              status={formData.customerRelationship}
              statusMap={customerRelationshipMap}
            />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...customerRelationshipOptions]}
          value={formData.customerRelationship ?? ''}
          onValueChange={(v) => updateFormField('customerRelationship', v || null)}
        />
      </FormField>

      <FormField
        name="customerTags"
        label="客户标签"
        error={getFieldError('customerTags')}
        viewContent={
          formData.customerTags && formData.customerTags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {formData.customerTags.map((tag) => (
                <StatusBadge key={tag} status={tag} statusMap={customerTagMap} />
              ))}
            </div>
          ) : undefined
        }
      >
        <MultiSelect
          options={customerTagOptions}
          value={formData.customerTags ?? []}
          onChange={(v) => updateFormField('customerTags', v.length > 0 ? v : null)}
          placeholder="请选择客户标签"
        />
      </FormField>

      <FormField
        name="headcountRange"
        label="员工数范围"
        error={getFieldError('headcountRange')}
        viewContent={
          formData.headcountRange ? (
            <StatusBadge status={formData.headcountRange} statusMap={headcountRangeMap} />
          ) : undefined
        }
      >
        <Select
          options={[{ value: '', label: '请选择' }, ...headcountRangeOptions]}
          value={formData.headcountRange ?? ''}
          onValueChange={(v) => updateFormField('headcountRange', v || null)}
        />
      </FormField>

      <ReadonlyStatusFields
        formData={formData}
        entity={entity}
        onLeadStageChanged={onLeadStageChanged}
      />

      <div className="col-span-full rounded-md border bg-muted/30 p-3 text-sm">
        <div className="font-medium">客户意向（仅可通过写跟进记录更新）</div>
        <div className="mt-1 text-muted-foreground">
          {INTENT_TEMPERATURE_LABELS[entity?.intentTemperature ?? 'UNJUDGED']}
          {entity?.intentReasons?.length ? ` · ${entity.intentReasons.join('、')}` : ''}
          {entity?.nextFollowUpAt ? ` · 下次回访：${entity.nextFollowUpAt}` : ''}
          {entity?.intentUpdatedByName ? ` · 更新人：${entity.intentUpdatedByName}` : ''}
          {entity?.intentUpdatedAt ? ` · 更新时间：${entity.intentUpdatedAt}` : ''}
          {entity?.intentSourceKeepRecordId ? (
            <span className="ml-2">
              <RelatedEntityLink
                entityType="keep-record"
                id={entity.intentSourceKeepRecordId}
                label="查看来源跟进记录"
              />
            </span>
          ) : null}
        </div>
      </div>

      <FormField
        name="leadValidity"
        label="线索有效性"
        error={getFieldError('leadValidity')}
        viewContent={formData.leadValidity === 'INVALID' ? '无效' : '有效'}
      >
        <Select
          options={[
            { value: 'VALID', label: '有效' },
            { value: 'INVALID', label: '无效' },
          ]}
          value={formData.leadValidity ?? 'VALID'}
          onValueChange={(value) =>
            updateFormField('leadValidity', value as CustomerFormData['leadValidity'])
          }
        />
      </FormField>

      {formData.leadValidity === 'INVALID' && (
        <FormField
          name="leadInvalidReason"
          label="无效原因"
          required
          error={getFieldError('leadInvalidReason')}
          viewContent={formData.leadInvalidReason ?? undefined}
        >
          <Select
            options={[
              { value: '', label: '请选择' },
              { value: 'EMPTY_PHONE', label: '空号' },
              { value: 'CLOSED', label: '停业' },
              { value: 'DUPLICATE', label: '重复' },
              { value: 'NON_TARGET', label: '非目标客户' },
            ]}
            value={formData.leadInvalidReason ?? ''}
            onValueChange={(value) => updateFormField('leadInvalidReason', value || null)}
          />
        </FormField>
      )}

      <FormField
        name="country"
        label="国家"
        required
        error={getFieldError('country')}
        viewContent={formData.country}
      >
        <Select
          options={countryOptions}
          value={formData.country ?? ''}
          onValueChange={(v) => {
            updateFormField('country', v || null);
            if (v && v !== DEFAULT_COUNTRY) {
              // 非中国（含未知/港澳台/外国）：三级锁定为「未知」
              updateFormField('province', UNKNOWN_REGION_VALUE);
              updateFormField('city', UNKNOWN_REGION_VALUE);
              updateFormField('district', UNKNOWN_REGION_VALUE);
            } else {
              // 切到中国 或 清空国家：清掉历史值让用户重选
              updateFormField('province', null);
              updateFormField('city', null);
              updateFormField('district', null);
            }
          }}
          placeholder="请选择国家"
          data-testid="customer-country-select"
        />
      </FormField>

      <FormField
        name="province"
        label="地址"
        required
        fullRow
        error={
          getFieldError('province') ||
          getFieldError('city') ||
          getFieldError('district') ||
          getFieldError('address')
        }
        viewContent={
          [addressValue.province, addressValue.city, addressValue.district, addressValue.detail]
            .filter(Boolean)
            .join(' ') || undefined
        }
      >
        <AddressPicker
          value={addressValue}
          onChange={(val: AddressValue) => {
            updateFormField('province', val.province || null);
            updateFormField('city', val.city || null);
            updateFormField('district', val.district || null);
            updateFormField('address', val.detail || null);
          }}
          disabled={isNonChinaCountry}
          includeUnknownOption
          data-testid="customer-address-picker"
        />
      </FormField>

      <FormField
        name="organizationId"
        label="组织 ID"
        error={getFieldError('organizationId')}
        viewContent={formData.organizationId}
      >
        <Input
          id="organizationId"
          placeholder="请输入组织 ID"
          value={formData.organizationId ?? ''}
          onChange={(e) => updateFormField('organizationId', e.target.value || null)}
        />
      </FormField>

      <FormField
        name="uncId"
        label="统一信用代码"
        error={getFieldError('uncId')}
        viewContent={formData.uncId}
      >
        <Input
          id="uncId"
          placeholder="请输入统一信用代码"
          value={formData.uncId ?? ''}
          onChange={(e) => updateFormField('uncId', e.target.value || null)}
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
          onChange={(v) => {
            const newCharger = v || null;
            updateFormField('chargerId', newCharger);
            // 新负责人若已在协作人列表中，自动剔除（协作人不能是负责人本人）
            if (newCharger && formData.collaboratorIds?.includes(newCharger)) {
              const filtered = formData.collaboratorIds.filter((id) => id !== newCharger);
              updateFormField('collaboratorIds', filtered.length > 0 ? filtered : null);
            }
          }}
          placeholder="搜索并选择负责人"
        />
      </FormField>

      <FormField
        name="collaboratorIds"
        label="协作人"
        error={getFieldError('collaboratorIds')}
        viewContent={entity?.collaboratorName}
      >
        <EmployeeMultiSelect
          value={formData.collaboratorIds ?? []}
          onChange={(ids) => updateFormField('collaboratorIds', ids.length > 0 ? ids : null)}
          excludeIds={formData.chargerId ? [formData.chargerId] : undefined}
          placeholder="搜索并选择协作人"
        />
      </FormField>

      <ReadonlyTotalsFields entity={entity} />

      <FormField
        name="remark"
        label="备注"
        fullRow
        error={getFieldError('remark')}
        viewContent={
          formData.remark ? (
            <span className="block min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {formData.remark}
            </span>
          ) : null
        }
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
// DrawerStack 二级抽屉：客户详情视图
//
// 客户的详情视图复用 CustomerDrawerBody（带 8 Tab：基本信息 + 7 个关联实体），
// fieldsContent 注入 renderCustomerFields。栈深度 ≥ 2 强制 view 模式（不允许栈内编辑）。
// ============================================================================

function CustomerDetailView({
  id,
  approvalContext,
}: {
  id: string;
  approvalContext?: BusinessApprovalContext;
}) {
  const crud = useDrawerEntityDetail<ICustomerResponse, CustomerFormData>({
    endpoint: '/customers',
    id,
    entityType: 'customer',
    schema: customerFormSchema,
    toFormData: (data) => toCustomerFormData({ ...data }),
    toPayload: toCustomerUpdatePayload,
    entityNameOf: (e) => e.customerName,
  });
  useEntityHeaderActions(crud);

  const profile: CustomerProfile | null = crud.data ? { ...crud.data } : null;

  if (crud.error && approvalContext?.approvalInstanceId) {
    return (
      <BusinessApprovalFallback
        approvalContext={approvalContext}
        defaultEventType={APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE}
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
      notFoundHint="客户不存在"
      useGridLayout={false}
      // 客户详情把"更改记录"放到 CustomerDrawerBody 的「基本信息」tab 内，
      // 而不是外层 EntityDetailBody 底部——避免在联系人/商机/订单等 tab 里也显示。
    >
      {profile && (
        <>
          {/* 客户线索阶段（MQL/SQL）变更审批：仅当从审批中心进入时（context 带 approvalInstanceId）显示。
              客户没有自身 flowStatus，故直接打开客户详情不会触发，符合预期——
              审批面板渲染在 CustomerDrawerBody 之上，跨 tab 始终可见。 */}
          <BusinessApprovalSection
            eventType={APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE}
            approvalInstanceId={approvalContext?.approvalInstanceId}
            approvalEventType={approvalContext?.approvalEventType}
            onApprovalSuccess={approvalContext?.onApprovalSuccess}
            onSuccess={crud.refetch}
          />
          <CustomerDrawerBody
            customerId={profile.id}
            customerName={profile.customerName}
            aiInfoSummary={profile.aiInfoSummary}
            aiInfoGeneratedAt={profile.aiInfoGeneratedAt}
            fieldsContent={renderCustomerFields({
              entity: profile,
              formData: crud.formData,
              updateFormField: crud.updateFormField,
              getFieldError: crud.getFieldError,
              onLeadStageChanged: () => crud.refetch(),
            })}
            changeLogTarget={crud.mode === 'view' ? { module: 'customers', target: id } : undefined}
          />
        </>
      )}
    </EntityDetailBody>
  );
}

registerEntityDetail('customer', {
  defaultTitle: '客户详情',
  render: (id, context) => (
    <CustomerDetailView id={id} approvalContext={normalizeBusinessApprovalContext(context)} />
  ),
});
