/**
 * 销售数据闭环：待办详情抽屉。
 *
 * 统一走 ResponsiveDialog variant="drawer"，与客户/商机等其他 CRM 模块抽屉共用同一套外壳
 * （桌面右侧抽屉 / 移动端底部抽屉、header border-b、body flex-1 滚动、footer border-t）。
 *
 * 两卡 + 列表页共用。
 *
 * Footer 三按钮（仅防御类待办）：
 * - 采纳：仅 category==='FILL_CONFIRM' 且 aiDraft.kind==='keep_record' 才显示 → POST /:id/adopt。
 *   绝不直接 api.post('/keep-records')（D6 闸门）。
 * - 去补充：DrawerStack.push({type:'keep-record', mode:'create', presets:{customerId}})。
 *   customerId 取 aiDraft.payload.customerId 或 refId（/crm/customers/:id?tab= 路由不存在）。
 * - 忽略：必填理由表单 → POST /:id/ignore。
 * - 转交：管理视图传入 onTransfer 后展示，不在抽屉内直接提交。
 *
 * 进攻类待办：行点击直接穿透到商机/客户 Drawer（见卡片/列表的 onRowClick），
 * 抽屉里对进攻类只展示「去处理」按钮（push 到对应实体详情）。
 */
import type {
  IDoneSalesActionItemKeepRecord,
  ISalesActionItemResponse,
} from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { useDrawerStackOptional } from '@/components/patterns/drawer-stack';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Button } from '@/components/ui/button';
import { useHasPermission } from '@/hooks/use-has-permission';
import { getErrorMessage } from '@/lib/api';
import {
  salesActionItemCategoryMap,
  salesActionItemConfidenceMap,
  salesActionItemDoneTypeMap,
  salesActionItemStatusMap,
} from '@/lib/status-maps';

import {
  ATTACK_CATEGORIES,
  DONE_TYPE_OPTIONS,
  isAdoptableActionItem,
  refTypeToDrawerType,
} from './constants';
import { AiDraftPreview, EvidenceList } from './evidence-view';
import {
  useAdoptActionItem,
  useDoneActionItem,
  useIgnoreActionItem,
  useReopenActionItem,
  useUndoActionItem,
} from './hooks';
import { IgnoreDialog } from './ignore-dialog';

interface SalesActionDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ISalesActionItemResponse | null;
  /** 是否允许撤销（已采纳项；列表页管理视图传 true） */
  canUndo?: boolean;
  /** 是否允许从详情抽屉发起转交（列表页全员视图传 true） */
  canTransfer?: boolean;
  onTransfer?: (item: ISalesActionItemResponse) => void;
  /** 处置成功后回调（除 query 自动失效外，调用方可额外刷新） */
  onProcessed?: () => void;
}

function safeFormat(iso: string | undefined | null, pattern: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, pattern);
}

function getResolveNoteDisplay(item: ISalesActionItemResponse): string | null {
  if (item.resolveNote) return item.resolveNote;
  if (item.status === 'adopted') return '已采纳并生成跟进记录';
  if (item.status === 'auto_expired') return '缺口已被后续动作自动回收';
  return null;
}

function getDoneTypeDisplay(item: ISalesActionItemResponse): string | null {
  if (item.status !== 'done' || !item.doneType) return null;
  return salesActionItemDoneTypeMap[item.doneType]?.label ?? item.doneType;
}

export function SalesActionDrawer({
  open,
  onOpenChange,
  item,
  canUndo = false,
  canTransfer = false,
  onTransfer,
  onProcessed,
}: SalesActionDrawerProps) {
  const drawerStack = useDrawerStackOptional();
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);

  const canEdit = useHasPermission('crm', 'sales_action_items', 'edit');
  const adopt = useAdoptActionItem();
  const ignore = useIgnoreActionItem();
  const done = useDoneActionItem();
  const reopen = useReopenActionItem();
  const undo = useUndoActionItem();

  if (!item) return null;

  const isAttack = ATTACK_CATEGORIES.includes(item.category as never);
  const isAdopted = item.status === 'adopted';
  const isDone = item.status === 'done';
  const isIgnored = item.status === 'ignored';
  const isAutoExpired = item.status === 'auto_expired';
  const hasResolution = isDone || isIgnored || isAdopted || isAutoExpired;
  const resolvedByName = item.resolvedByName ?? item.resolvedBy?.name ?? null;
  const doneTypeDisplay = getDoneTypeDisplay(item);
  const resolveNoteDisplay = getResolveNoteDisplay(item);
  const resolveNoteLabel = isIgnored ? '忽略理由' : '处置结果';
  const resolutionTitle = isDone
    ? '办结记录'
    : isIgnored
      ? '忽略记录'
      : isAdopted
        ? '采纳记录'
        : isAutoExpired
          ? '自动结案记录'
          : '处置记录';
  const canAdopt = isAdoptableActionItem(item);
  const canTransferItem =
    canTransfer &&
    canEdit &&
    Boolean(onTransfer) &&
    (item.status === 'pending' || item.status === 'snoozed');
  const presetCustomerId =
    (item.aiDraft?.kind === 'keep_record' ? item.aiDraft.payload?.customerId : undefined) ||
    item.refId ||
    undefined;

  const busy =
    adopt.isPending || ignore.isPending || done.isPending || reopen.isPending || undo.isPending;

  const closeAfter = () => {
    onOpenChange(false);
    onProcessed?.();
  };

  const handleAdopt = async () => {
    try {
      await adopt.mutateAsync(item.id);
      toast.success('已采纳，跟进记录已写入');
      closeAfter();
    } catch (error) {
      toast.error(getErrorMessage(error, '采纳失败'));
    }
  };

  const handleSupplement = () => {
    if (!drawerStack) {
      toast.error('当前页面不支持就地补录，请前往跟进记录页');
      return;
    }
    if (!presetCustomerId) {
      toast.error('缺少关联客户，无法预填补录');
      return;
    }
    drawerStack.push({
      type: 'keep-record',
      id: '__create__',
      mode: 'create',
      presets: { customerId: presetCustomerId },
      title: '补充跟进记录',
    });
    onOpenChange(false);
  };

  const handleConfirmIgnore = async (resolveNote: string) => {
    try {
      await ignore.mutateAsync({ id: item.id, resolveNote });
      toast.success('已忽略');
      setIgnoreOpen(false);
      closeAfter();
    } catch (error) {
      toast.error(getErrorMessage(error, '忽略失败'));
    }
  };

  const handleConfirmDone = async (
    resolveNote: string,
    doneType?: string,
    keepRecord?: IDoneSalesActionItemKeepRecord
  ) => {
    if (!doneType) return;
    try {
      await done.mutateAsync({ id: item.id, doneType, resolveNote, keepRecord });
      toast.success('已办结');
      setDoneOpen(false);
      closeAfter();
    } catch (error) {
      toast.error(getErrorMessage(error, '办结失败'));
    }
  };

  const handleUndo = async () => {
    try {
      await undo.mutateAsync(item.id);
      toast.success('已撤销，跟进记录已回收');
      closeAfter();
    } catch (error) {
      toast.error(getErrorMessage(error, '撤销失败（仅限当日或管理员）'));
    }
  };

  const handleReopen = async () => {
    try {
      await reopen.mutateAsync(item.id);
      toast.success('已改回待办');
      closeAfter();
    } catch (error) {
      toast.error(getErrorMessage(error, '改回待办失败'));
    }
  };

  const handleGoToEntity = () => {
    const type = refTypeToDrawerType(item.refType);
    if (!drawerStack || !type || !item.refId) {
      toast.error('该待办没有可跳转的关联实体');
      return;
    }
    drawerStack.push({
      type,
      id: item.refId,
      title: item.title,
      // 透传来源待办 → 实体详情顶部挂办结 banner（进攻类办结入口）
      context: { sourceActionItemId: item.id, sourceActionItemTitle: item.title },
    });
    onOpenChange(false);
  };

  const transferButton = canTransferItem ? (
    <Button variant="outline" onClick={() => onTransfer?.(item)} disabled={busy}>
      <Send className="mr-1 h-4 w-4" />
      转交
    </Button>
  ) : null;

  const footer =
    isAdopted && canUndo && canEdit ? (
      <Button variant="destructive" onClick={handleUndo} disabled={busy}>
        撤销采纳
      </Button>
    ) : isDone && canEdit ? (
      <Button variant="outline" onClick={handleReopen} disabled={busy}>
        <RotateCcw className="mr-1 h-4 w-4" />
        改回待办
      </Button>
    ) : isAttack ? (
      <>
        {transferButton}
        {canEdit && item.status === 'pending' && (
          <Button variant="outline" onClick={() => setDoneOpen(true)} disabled={busy}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            标记已办
          </Button>
        )}
        <Button onClick={handleGoToEntity} disabled={busy}>
          去处理
          <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </>
    ) : item.status === 'pending' && canEdit ? (
      <>
        {transferButton}
        <Button variant="outline" onClick={() => setIgnoreOpen(true)} disabled={busy}>
          <XCircle className="mr-1 h-4 w-4" />
          忽略
        </Button>
        <Button variant="outline" onClick={handleSupplement} disabled={busy}>
          <FilePlus2 className="mr-1 h-4 w-4" />
          去补充
        </Button>
        {canAdopt ? (
          <Button onClick={handleAdopt} disabled={busy}>
            <ClipboardCheck className="mr-1 h-4 w-4" />
            采纳
          </Button>
        ) : (
          <Button onClick={() => setDoneOpen(true)} disabled={busy}>
            <CheckCircle2 className="mr-1 h-4 w-4" />
            标记已办
          </Button>
        )}
      </>
    ) : canTransferItem ? (
      <>
        {transferButton}
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          关闭
        </Button>
      </>
    ) : (
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
        关闭
      </Button>
    );

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        variant="drawer"
        title={item.title}
        footer={footer}
      >
        <div className="-mt-4 space-y-4">
          {/* 分类 / 置信度 / 状态 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={item.category} statusMap={salesActionItemCategoryMap} />
            <StatusBadge status={item.confidence} statusMap={salesActionItemConfidenceMap} />
            <StatusBadge status={item.status} statusMap={salesActionItemStatusMap} />
          </div>

          {/* 为什么提醒你 */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
            <div className="mb-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              为什么提醒你
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{item.reason}</p>
          </div>

          {/* 建议动作 */}
          {item.suggestedAction && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
              <div className="mb-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                建议动作
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {item.suggestedAction}
              </p>
            </div>
          )}

          {/* 采纳草稿预览 */}
          <AiDraftPreview aiDraft={item.aiDraft} />

          {/* 证据 */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">关联证据</div>
            <EvidenceList evidence={item.evidence} />
          </div>

          {/* 处置记录（仅已处置时显示，与 reason/suggestion/aiDraft 同视觉权重） */}
          {hasResolution && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                {resolutionTitle}
              </div>
              <dl className="space-y-1.5 text-sm">
                {item.resolvedAt && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">处置时间</dt>
                    <dd className="text-foreground">
                      {safeFormat(item.resolvedAt, 'yyyy-MM-dd HH:mm')}
                    </dd>
                  </div>
                )}
                {resolvedByName && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">处置人</dt>
                    <dd className="text-foreground">{resolvedByName}</dd>
                  </div>
                )}
                {doneTypeDisplay && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">办结类型</dt>
                    <dd className="text-foreground">{doneTypeDisplay}</dd>
                  </div>
                )}
                {resolveNoteDisplay && (
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted-foreground">{resolveNoteLabel}</dt>
                    <dd className="whitespace-pre-wrap break-words text-foreground">
                      {resolveNoteDisplay}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* 事项档案脚注（仅档案性元数据） */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span>创建于 {safeFormat(item.createdAt, 'yyyy-MM-dd HH:mm')}</span>
            {item.employee?.name && <span>收件人 {item.employee.name}</span>}
            {item.remindCount > 0 && <span>累计提醒 {item.remindCount} 次</span>}
          </div>
        </div>
      </ResponsiveDialog>

      <IgnoreDialog
        open={ignoreOpen}
        onOpenChange={setIgnoreOpen}
        onConfirm={handleConfirmIgnore}
        loading={ignore.isPending}
      />

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
