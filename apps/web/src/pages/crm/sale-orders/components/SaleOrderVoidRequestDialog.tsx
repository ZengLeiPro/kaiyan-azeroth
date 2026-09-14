import {
  SALE_ORDER_VOID_PROJECT_ACTION,
  type SaleOrderVoidPreviewOutput,
} from '@ky-azeroth/shared/schemas/sale-order';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

interface SaleOrderVoidRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId?: string | null;
  recordVersion?: number | null;
  recordName?: string | null;
  onSuccess?: () => void;
}

export function SaleOrderVoidRequestDialog({
  open,
  onOpenChange,
  recordId,
  recordVersion,
  recordName,
  onSuccess,
}: SaleOrderVoidRequestDialogProps) {
  const [preview, setPreview] = useState<SaleOrderVoidPreviewOutput | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [projectRollbackConfirmed, setProjectRollbackConfirmed] = useState(false);

  useEffect(() => {
    if (!open || !recordId) {
      setPreview(null);
      setPreviewError(null);
      setReason('');
      setProjectRollbackConfirmed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setPreviewError(null);
    setProjectRollbackConfirmed(false);
    api
      .get<SaleOrderVoidPreviewOutput>(`/sale-orders/${recordId}/void-preview`)
      .then(({ data }) => {
        if (!cancelled) setPreview(data);
      })
      .catch((error) => {
        if (!cancelled) setPreviewError(getErrorMessage(error, '加载纠错作废预检失败'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, recordId]);

  const canSubmit =
    Boolean(preview?.canSubmit) &&
    (!preview?.requiresProjectAction || projectRollbackConfirmed) &&
    Boolean(reason.trim()) &&
    recordVersion != null &&
    !loading &&
    !submitting;

  const handleSubmit = async () => {
    if (!recordId || recordVersion == null || !canSubmit || !preview) return;

    setSubmitting(true);
    try {
      await api.post(`/sale-orders/${recordId}/void-request`, {
        reason: reason.trim(),
        version: recordVersion,
        ...(preview.requiresProjectAction
          ? { projectAction: SALE_ORDER_VOID_PROJECT_ACTION.ROLLBACK_TO_OPPORTUNITY }
          : {}),
      });
      toast.success('纠错作废申请已提交，审批通过后将原子处理全部依赖');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(getErrorMessage(error, '提交纠错作废申请失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>合同订单纠错作废</DialogTitle>
          <DialogDescription>
            {recordName ? `单据：${recordName}。` : ''}
            仅用于重复录入、录错订单等内部纠错；真实交易终止应走退款与发票冲红，不能用本操作抹掉资金事实。
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在核对回款、发票、项目与财务流水…
          </div>
        )}

        {previewError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>预检失败</AlertTitle>
            <AlertDescription>{previewError}</AlertDescription>
          </Alert>
        )}

        {preview && (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <DependencyCard
                title="回款与退款"
                lines={[
                  `已审批 ${preview.payments.approvedCount} 笔：审批通过后作废`,
                  `草稿/驳回 ${preview.payments.removableCount} 笔：审批通过后删除`,
                  `已收 ¥${formatAmount(preview.payments.approvedInAmount)} / 已退 ¥${formatAmount(preview.payments.approvedOutAmount)}`,
                ]}
              />
              <DependencyCard
                title="发票"
                lines={[
                  `已作废/已冲红 ${preview.invoices.preservedCount} 笔：保留审计记录`,
                  `无票号草稿/驳回 ${preview.invoices.removableCount} 笔：审批通过后删除`,
                  `需先处理 ${preview.invoices.blockingCount} 笔`,
                ]}
              />
            </div>

            {preview.project && (
              <div className="rounded-lg border p-4 text-sm">
                <div className="font-medium">关联项目：{preview.project.name}</div>
                <div className="mt-1 text-muted-foreground">
                  当前阶段：{preview.project.status}；工单 {preview.project.activeTicketCount}{' '}
                  个；工时 {preview.project.effortRecordCount} 条；同商机其他有效订单{' '}
                  {preview.project.otherSaleOrderCount} 份
                </div>
                {preview.requiresProjectAction && (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-md bg-muted/50 p-3">
                    <Checkbox
                      checked={projectRollbackConfirmed}
                      onCheckedChange={(checked) => setProjectRollbackConfirmed(checked === true)}
                    />
                    <span>我确认该项目也是误建链路，审批通过后解除订单绑定并回退到“商机中”</span>
                  </label>
                )}
              </div>
            )}

            {preview.blockers.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>暂时不能提交</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 pl-5">
                    {preview.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="sale-order-void-reason">
                纠错原因 <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="sale-order-void-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="请写明误建/重复录入的事实与核对依据，便于审批和审计"
                rows={4}
                maxLength={500}
                disabled={submitting || !preview?.canSubmit}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? '提交中…' : '提交纠错作废审批'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DependencyCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium">{title}</div>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
