import { OPPORTUNITY_LOSE_REASON } from '@ky-azeroth/shared/constants/status-values';
import { useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDateToLocalDateString } from '@/lib/date-utils';

const loseReasonOptions = Object.values(OPPORTUNITY_LOSE_REASON).map((value) => ({
  value,
  label: value,
}));

export interface ConfirmStageTerminalPayload {
  /** stage='输单流失' 时必填，'赢单' 时不传 */
  loseReason?: string;
  /** 选「其他」时承载的自由文本备注 */
  loseReasonDetail?: string;
  /** stage='输单流失' 时可选，空值由后端自动填当前时间。'赢单' 时不传 */
  lostDate?: string | null;
}

interface ConfirmStageDialogProps {
  open: boolean;
  /** 商机名称（用于提示文案） */
  opportunityName: string;
  /** 目标 stage（赢单 / 输单流失） */
  toStage: string;
  /** 输单流失场景需要承载 reason + date；赢单场景不传额外字段 */
  onConfirm: (payload?: ConfirmStageTerminalPayload) => void;
  onCancel: () => void;
}

/**
 * 拖拽到终态列（赢单 / 输单流失）时的确认弹框。
 *
 * 终态变更会影响业绩归属与漏斗统计，强制二次确认。
 * 输单流失场景需要内嵌失单原因（必填）和输单日期（默认 today，可改）。
 */
export function ConfirmStageDialog({
  open,
  opportunityName,
  toStage,
  onConfirm,
  onCancel,
}: ConfirmStageDialogProps) {
  const isWin = toStage === '赢单';
  const isLost = toStage === '输单流失';
  const intent = isWin ? '标记为赢单' : '标记为输单流失';

  const [loseReason, setLoseReason] = useState('');
  const [loseReasonDetail, setLoseReasonDetail] = useState('');
  const [lostDate, setLostDate] = useState<Date | undefined>(() => new Date());

  // 每次打开重置内嵌字段（避免上次输入残留到下一次拖拽）
  useEffect(() => {
    if (open && isLost) {
      setLoseReason('');
      setLoseReasonDetail('');
      setLostDate(new Date());
    }
  }, [open, isLost]);

  // 选「其他」时 detail 必填，否则只要 loseReason 非空
  const canConfirm =
    !isLost ||
    (loseReason.trim().length > 0 && (loseReason !== '其他' || loseReasonDetail.trim().length > 0));

  function handleConfirm() {
    if (!canConfirm) return;
    if (isLost) {
      onConfirm({
        loseReason: loseReason.trim(),
        loseReasonDetail: loseReason === '其他' ? loseReasonDetail.trim() : undefined,
        lostDate: lostDate ? formatDateToLocalDateString(lostDate) : null,
      });
    } else {
      onConfirm();
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认{intent}？</AlertDialogTitle>
          <AlertDialogDescription>
            将商机「{opportunityName}」移到「{toStage}
            」阶段。该操作影响业绩归属和漏斗统计，确认后可在列表视图中改回。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLost && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-lose-reason">
                失单原因 <span className="text-destructive">*</span>
              </Label>
              <Select
                options={[{ value: '', label: '请选择' }, ...loseReasonOptions]}
                value={loseReason}
                onValueChange={(v) => {
                  setLoseReason(v);
                  if (v !== '其他') setLoseReasonDetail('');
                }}
              />
            </div>
            {loseReason === '其他' && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-lose-reason-detail">
                  失单原因说明 <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="confirm-lose-reason-detail"
                  placeholder="请填写具体的失单原因说明"
                  value={loseReasonDetail}
                  onChange={(e) => setLoseReasonDetail(e.target.value)}
                  rows={3}
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-lost-date">输单日期</Label>
              <DatePicker
                date={lostDate}
                onDateChange={(date) => setLostDate(date ?? undefined)}
                placeholder="默认为今天，可改"
                className="w-full"
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={!canConfirm}>
            确认{intent}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
