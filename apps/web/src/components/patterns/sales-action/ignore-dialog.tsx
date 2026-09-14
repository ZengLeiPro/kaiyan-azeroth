/**
 * 销售待办处置备注：必填理由/结果表单（AlertDialog）。
 * resolveNote 必填；空内容禁用确认按钮，后端 schema 也会兜底拦截。
 */
import { KEEP_RECORD_STATUS_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import {
  KEEP_RECORD_TYPE_OPTIONS,
  SALES_ACTION_ITEM_DONE_TYPE,
} from '@ky-azeroth/shared/constants/status-values';
import { useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getNowDateTimeLocalString, localInputToIso } from '@/lib/date-utils';

interface DoneTypeOption {
  value: string;
  label: string;
}

interface DoneKeepRecordPayload {
  contactId?: string | null;
  keepRecordType: string;
  keepRecordTime: string;
  keepRecordContent: string;
  keepRecordStatus: string;
}

interface IgnoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认处置，返回备注；调用方负责发请求 + toast */
  onConfirm: (
    resolveNote: string,
    doneType?: string,
    keepRecord?: DoneKeepRecordPayload
  ) => Promise<void>;
  loading?: boolean;
  title?: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmText?: string;
  loadingText?: string;
  doneTypeOptions?: DoneTypeOption[];
  doneTypeLabel?: string;
  doneTypePlaceholder?: string;
  requireDoneType?: boolean;
}

const keepRecordStatusOptions = Object.entries(KEEP_RECORD_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function IgnoreDialog({
  open,
  onOpenChange,
  onConfirm,
  loading = false,
  title = '忽略待办',
  description = '请填写忽略理由（必填，便于后续审计）。',
  label = '忽略理由',
  placeholder = '例如：该商机已通过电话推进，无需补录',
  confirmText = '确认忽略',
  loadingText = '处理中...',
  doneTypeOptions,
  doneTypeLabel = '办结类型',
  doneTypePlaceholder = '请选择办结类型',
  requireDoneType = false,
}: IgnoreDialogProps) {
  const [note, setNote] = useState('');
  const [doneType, setDoneType] = useState('');
  const [keepRecordType, setKeepRecordType] = useState('dingtalk');
  const [keepRecordStatus, setKeepRecordStatus] = useState('客户维护');
  const [keepRecordTime, setKeepRecordTime] = useState(getNowDateTimeLocalString());
  const showDoneType = Boolean(doneTypeOptions?.length);
  const showKeepRecordFields = doneType === SALES_ACTION_ITEM_DONE_TYPE.FOLLOW_RECORDED;

  // 关闭时清空
  useEffect(() => {
    if (!open) {
      setNote('');
      setDoneType('');
      setKeepRecordType('dingtalk');
      setKeepRecordStatus('客户维护');
      setKeepRecordTime(getNowDateTimeLocalString());
    }
  }, [open]);

  const handleConfirm = async () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    if (requireDoneType && !doneType) return;
    if (showKeepRecordFields) {
      const isoTime = localInputToIso(keepRecordTime);
      if (!keepRecordType || !keepRecordStatus || !isoTime) return;
      await onConfirm(trimmed, doneType || undefined, {
        keepRecordType,
        keepRecordTime: isoTime,
        keepRecordContent: trimmed,
        keepRecordStatus,
      });
      return;
    }
    await onConfirm(trimmed, doneType || undefined);
  };

  const canConfirm =
    Boolean(note.trim()) &&
    (!requireDoneType || Boolean(doneType)) &&
    (!showKeepRecordFields ||
      (Boolean(keepRecordType) && Boolean(keepRecordStatus) && Boolean(keepRecordTime)));

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && loading) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
          {showDoneType && (
            <div className="space-y-2">
              <Label htmlFor="sales-action-done-type">
                {doneTypeLabel} {requireDoneType && <span className="text-destructive">*</span>}
              </Label>
              <Select
                value={doneType}
                onChange={(value) => setDoneType(value ?? '')}
                options={doneTypeOptions ?? []}
                placeholder={doneTypePlaceholder}
                disabled={loading}
                searchable={false}
                data-testid="sales-action-done-type-select"
              />
            </div>
          )}
          {showKeepRecordFields && (
            <div className="grid gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sales-action-keep-record-type">
                  跟进方式 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={keepRecordType}
                  onChange={(value) => setKeepRecordType(value ?? '')}
                  options={KEEP_RECORD_TYPE_OPTIONS}
                  placeholder="请选择跟进方式"
                  disabled={loading}
                  searchable={false}
                  data-testid="sales-action-keep-record-type-select"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sales-action-keep-record-status">
                  跟进状态 <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={keepRecordStatus}
                  onChange={(value) => setKeepRecordStatus(value ?? '')}
                  options={keepRecordStatusOptions}
                  placeholder="请选择跟进状态"
                  disabled={loading}
                  searchable={false}
                  data-testid="sales-action-keep-record-status-select"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sales-action-keep-record-time">
                  跟进时间 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="sales-action-keep-record-time"
                  type="datetime-local"
                  value={keepRecordTime}
                  onChange={(e) => setKeepRecordTime(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="sales-action-ignore-note">
              {showKeepRecordFields ? '跟进内容' : label}{' '}
              <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="sales-action-ignore-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                showKeepRecordFields ? '例如：已电话沟通，客户确认下周三安排演示' : placeholder
              }
              rows={3}
              disabled={loading}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !canConfirm}>
            {loading ? loadingText : confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
