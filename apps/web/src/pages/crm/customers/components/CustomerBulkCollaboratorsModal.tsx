import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { EmployeeMultiSelect } from '@/components/patterns/employee-multi-select';
import { FormField, FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { api, getErrorMessage } from '@/lib/api';

interface CustomerBulkCollaboratorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerIds: string[];
  versions: Record<string, number>;
  onSuccess: () => void;
  /** add 模式：合并去重写入 collaboratorIds；remove 模式：从 collaboratorIds 中删除入参 */
  mode: 'add' | 'remove';
}

function buildCustomerBulkCollaboratorsPayload(
  customerIds: string[],
  versions: Record<string, number>,
  collaboratorIds: string[]
) {
  return { ids: customerIds, versions, collaboratorIds };
}

/**
 * 批量加 / 移协作人
 *
 * 同一组件用 mode 区分两个动作。endpoint:
 * - add → PATCH /customers/batch-add-collaborators
 * - remove → PATCH /customers/batch-remove-collaborators
 *
 * 后端语义：
 * - add: 入参 collaboratorIds 与现有合并去重
 * - remove: 入参 collaboratorIds 从现有里删除
 * - 每个可访问目标都执行 CAS 并将 version + 1，即使协作人集合恰好没有业务差异
 */
export function CustomerBulkCollaboratorsModal({
  open,
  onOpenChange,
  customerIds,
  versions,
  onSuccess,
  mode,
}: CustomerBulkCollaboratorsModalProps) {
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const hasExactVersions =
    customerIds.length > 0 &&
    Object.keys(versions).length === customerIds.length &&
    customerIds.every((id) => Number.isInteger(versions[id]) && (versions[id] ?? 0) >= 1);

  const reset = () => {
    setCollaboratorIds([]);
    setSubmitting(false);
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const title = mode === 'add' ? '添加协作人' : '移除协作人';
  const submitLabel = mode === 'add' ? '确认添加' : '确认移除';
  const loadingLabel = mode === 'add' ? '添加中...' : '移除中...';
  const endpoint =
    mode === 'add' ? '/customers/batch-add-collaborators' : '/customers/batch-remove-collaborators';

  const handleSubmit = async () => {
    // @validation-ok: 这是所选实体的并发快照完整性检查，不是表单字段校验。
    if (!hasExactVersions) {
      toast.error('所选客户版本信息不完整，请刷新列表后重试');
      return;
    }
    // UI 防呆已由按钮 disabled 兜底；空数组仍能进来时由后端 zod schema 拦截
    setSubmitting(true);
    try {
      const { data } = await api.patch<{ success: number; skipped: string[] }>(
        endpoint,
        buildCustomerBulkCollaboratorsPayload(customerIds, versions, collaboratorIds)
      );
      const skippedCount = data.skipped?.length ?? 0;
      const actionVerb = mode === 'add' ? '处理' : '处理';
      if (skippedCount > 0) {
        toast.success(
          `已${actionVerb} ${data.success} 项，跳过 ${skippedCount} 项（权限不足或已删除）`
        );
      } else {
        toast.success(`已${actionVerb} ${data.success} 项`);
      }
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, `批量${title}失败`));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      title={`批量${title}`}
      description={`对选中的 ${customerIds.length} 个客户${mode === 'add' ? '添加' : '移除'}指定协作人`}
      desktopMaxWidth="max-w-md"
      modal
      footer={
        <>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || collaboratorIds.length === 0 || !hasExactVersions}
            variant={mode === 'remove' ? 'destructive' : 'default'}
          >
            {submitting ? loadingLabel : submitLabel}
          </Button>
        </>
      }
    >
      <FormModeProvider mode="edit">
        <div className="space-y-4 py-2">
          <FormField
            name="collaboratorIds"
            label={mode === 'add' ? '要添加的协作人' : '要移除的协作人'}
            required
          >
            <EmployeeMultiSelect
              value={collaboratorIds}
              onChange={setCollaboratorIds}
              placeholder="搜索并选择员工（可多选）"
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            {mode === 'add'
              ? '已是协作人的客户保持不变；新增项会去重合并。'
              : '不在协作人列表中的客户保持不变；仅移除已存在的项。'}
          </p>
        </div>
      </FormModeProvider>
    </ResponsiveDialog>
  );
}
