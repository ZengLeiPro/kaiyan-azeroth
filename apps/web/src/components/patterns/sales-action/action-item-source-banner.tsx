/**
 * 销售待办「来源 banner」：在实体详情抽屉顶部展示。
 *
 * 用途：今日作战卡 / 列表「去处理」穿透到商机/客户/跟进详情抽屉时，
 * 通过 DrawerEntry.context.sourceActionItemId 透传待办 id，
 * 在实体详情顶部挂一条「来自销售待办 ｜ 标记已办」横幅，让销售在处理完关联实体后
 * 就地办结对应待办（进攻类待办原本只有「去处理」、无办结入口）。
 *
 * 复用既有 POST /sales-action-items/:id/done（useDoneActionItem），要求填写处置结果；
 * 办结后本地置「已办结」态，不自动关抽屉（不打断用户在实体里的后续操作）；
 * mutation onSuccess 已 invalidate 两卡/列表。
 *
 * 依赖边界：不 import drawer-stack，避免与 EntityDetailView（drawer-stack）形成循环依赖。
 */
import type { IDoneSalesActionItemKeepRecord } from '@ky-azeroth/shared/types';
import { CheckCircle2, ClipboardList, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/hooks/use-has-permission';
import { getErrorMessage } from '@/lib/api';

import { DONE_TYPE_OPTIONS } from './constants';
import { useDoneActionItem, useReopenActionItem } from './hooks';
import { IgnoreDialog } from './ignore-dialog';

interface ActionItemSourceBannerProps {
  /** 来源销售待办 id（来自 DrawerEntry.context.sourceActionItemId） */
  actionItemId: string;
  /** 待办标题（可选，用于横幅文案） */
  title?: string;
}

export function ActionItemSourceBanner({ actionItemId, title }: ActionItemSourceBannerProps) {
  const canEdit = useHasPermission('crm', 'sales_action_items', 'edit');
  const done = useDoneActionItem();
  const reopen = useReopenActionItem();
  const [resolved, setResolved] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  const handleConfirmDone = async (
    resolveNote: string,
    doneType?: string,
    keepRecord?: IDoneSalesActionItemKeepRecord
  ) => {
    if (!doneType) return;
    try {
      await done.mutateAsync({ id: actionItemId, doneType, resolveNote, keepRecord });
      setResolved(true);
      setDoneOpen(false);
      toast.success('已办结，该待办已从你的列表移除');
    } catch (error) {
      toast.error(getErrorMessage(error, '办结失败'));
    }
  };

  const handleReopen = async () => {
    try {
      await reopen.mutateAsync(actionItemId);
      setResolved(false);
      toast.success('已改回待办');
    } catch (error) {
      toast.error(getErrorMessage(error, '改回待办失败'));
    }
  };

  // 无处置权限（view-only 角色，如 PM/VIEWER）：不展示办结入口，避免点了 403。
  if (!canEdit) return null;

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 dark:border-rose-900/50 dark:bg-rose-950/30">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span className="truncate text-sm text-foreground">
            来自销售待办{title ? `：${title}` : ''}
          </span>
        </div>
        {resolved ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleReopen}
            disabled={reopen.isPending}
            className="shrink-0"
          >
            <RotateCcw className="mr-1 h-4 w-4" /> 改回待办
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => setDoneOpen(true)}
            disabled={done.isPending}
            className="shrink-0"
          >
            <CheckCircle2 className="mr-1 h-4 w-4" /> 标记已办
          </Button>
        )}
      </div>

      <IgnoreDialog
        open={doneOpen}
        onOpenChange={setDoneOpen}
        onConfirm={handleConfirmDone}
        loading={done.isPending}
        title="标记已办"
        description="请填写本次实际处置结果。该信息会留存在待办记录中，便于复盘和管理端审计。"
        label="处置结果"
        placeholder="例如：已联系客户确认下周三演示；或已补齐跟进记录并同步商机阶段"
        confirmText="确认办结"
        doneTypeOptions={DONE_TYPE_OPTIONS}
        requireDoneType
      />
    </>
  );
}
