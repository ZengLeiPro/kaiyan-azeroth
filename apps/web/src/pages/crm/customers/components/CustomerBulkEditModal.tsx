import {
  CUSTOMER_LEVEL_LABELS,
  CUSTOMER_RELATIONSHIP_LABELS,
  CUSTOMER_SOURCE_LABELS,
  INDUSTRY_LABELS,
} from '@ky-azeroth/shared/constants/status-labels';
import type { IndustryValue } from '@ky-azeroth/shared/constants/status-values';
import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api';

interface CustomerBulkEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
}

function buildCustomerBulkEditPayload(
  customerIds: string[],
  versions: Record<string, number>,
  patch: Record<string, string>
) {
  return { ids: customerIds, versions, patch };
}

interface BulkEditFormState {
  customerLevel: string;
  industry: string;
  customerSource: string;
  customerRelationship: string;
}

const EMPTY_FORM: BulkEditFormState = {
  customerLevel: '',
  industry: '',
  customerSource: '',
  customerRelationship: '',
};

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
const industryOptions = Object.entries(INDUSTRY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/**
 * 批量编辑客户：仅 4 个白名单字段
 *
 * 字段范围（2026-05-18 决策锁定）：
 * customerLevel (SABC) / industry / customerSource / customerRelationship
 *
 * 唯一字段（customerName / uncId / organizationId 等）不允许批量改。
 * 空值/未选 = 不动该字段；至少需选一个才能提交。
 */
export function CustomerBulkEditModal({
  open,
  onOpenChange,
  customerIds,
  versions,
  onSuccess,
}: CustomerBulkEditModalProps) {
  const [form, setForm] = useState<BulkEditFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setForm(EMPTY_FORM);
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const update = (field: keyof BulkEditFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // 至少选一个字段才能提交（空字符串 = 未改）
  const hasAnyChange =
    form.customerLevel || form.industry || form.customerSource || form.customerRelationship;
  const hasExactVersions =
    customerIds.length > 0 &&
    Object.keys(versions).length === customerIds.length &&
    customerIds.every((id) => Number.isInteger(versions[id]) && (versions[id] ?? 0) >= 1);

  const handleSubmit = async () => {
    // @validation-ok: 这是所选实体的并发快照完整性检查，不是表单字段校验。
    if (!hasExactVersions) {
      toast.error('所选客户版本信息不完整，请刷新列表后重试');
      return;
    }
    // UI 防呆已由按钮 disabled 兜底；空 patch 仍能进来时由后端 zod refine 拦截
    const patch: Record<string, string> = {};
    if (form.customerLevel) patch.customerLevel = form.customerLevel;
    if (form.industry) patch.industry = form.industry;
    if (form.customerSource) patch.customerSource = form.customerSource;
    if (form.customerRelationship) patch.customerRelationship = form.customerRelationship;

    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        '/customers/batch-update',
        buildCustomerBulkEditPayload(customerIds, versions, patch)
      );
      const skippedCount = data.skipped?.length ?? 0;
      if (skippedCount > 0) {
        toast.success(`已编辑 ${data.success} 项，跳过 ${skippedCount} 项（权限不足或已删除）`);
      } else {
        toast.success(`已编辑 ${data.success} 项`);
      }
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, '批量编辑失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title="批量编辑"
      description={`仅可批量修改下列 4 个字段（共选中 ${customerIds.length} 个客户）`}
      desktopMaxWidth="max-w-lg"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !hasAnyChange || !hasExactVersions}
          >
            {submitting ? '保存中...' : '确认修改'}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="space-y-4 py-2">
          <FormField name="customerLevel" label="客户等级">
            <Select
              options={[{ value: '', label: '不修改' }, ...customerLevelOptions]}
              value={form.customerLevel}
              onValueChange={(v) => update('customerLevel', v)}
            />
          </FormField>
          <FormField name="industry" label="行业">
            <Select
              options={[{ value: '', label: '不修改' }, ...industryOptions]}
              value={form.industry}
              onValueChange={(v) => update('industry', v as IndustryValue | '')}
            />
          </FormField>
          <FormField name="customerSource" label="客户来源">
            <Select
              options={[{ value: '', label: '不修改' }, ...customerSourceOptions]}
              value={form.customerSource}
              onValueChange={(v) => update('customerSource', v)}
            />
          </FormField>
          <FormField name="customerRelationship" label="客户关系">
            <Select
              options={[{ value: '', label: '不修改' }, ...customerRelationshipOptions]}
              value={form.customerRelationship}
              onValueChange={(v) => update('customerRelationship', v)}
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            保持「不修改」的字段在提交时不会改变原值。
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
