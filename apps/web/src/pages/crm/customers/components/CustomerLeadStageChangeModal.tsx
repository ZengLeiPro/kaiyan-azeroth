/**
 * 客户线索阶段（MQL/SQL）变更审批申请 Modal
 *
 * 触发：所有角色（含 ADMIN）在客户详情点「申请改 MQL/SQL」按钮
 *      2026-06 改造后 ADMIN 也走此审批入口（PUT 直改 leadStage 路径已封死）；
 *      若审批人=申请人本人，后端 autoPassSelfTasksAndAdvance 会自动通过。
 * 提交：POST /customers/:id/lead-stage-change-request
 * 成功：toast 提示"已提交审批，等待审批通过后生效"，关闭 modal，刷新客户详情
 * 失败：弹错误 toast；后端拒因：(a) 同一客户已有 pending 变更审批 (b) 阶段未变化 (c) version 冲突
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { api, getErrorMessage } from '@/lib/api';

type LeadStage = 'MQL' | 'SQL';

const LEAD_STAGE_REASON_TEMPLATE = `1. KP 身份确认：
通话/沟通对象：
是否为决策人/核心影响人：
依据：

2. 客户画像匹配：
匹配画像卡：
行业/规模/产值/数字化程度：
痛点类型：

3. 痛点明确挖掘：
客户口述具体痛点：
对应可解决领域：

4. 已约定具体时间：
会议日期/时段：
形式（线上/线下）：
参与人（含 KP）：
会议内容：
对接人联系方式：
钉钉日程/面销同步情况：`;

interface CustomerLeadStageChangeModalProps {
  /** 客户 id */
  customerId: string;
  /** 客户名（标题展示用） */
  customerName: string;
  /** 客户当前 leadStage，'无' / 'MQL' / 'SQL'；用于禁用"已是该阶段"的选项 */
  currentLeadStage: string | null;
  /** 客户当前 version（乐观锁；从客户详情取） */
  currentVersion: number;
  /** Modal 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onOpenChange: (open: boolean) => void;
  /** 提交成功回调（用于父组件刷新客户详情） */
  onSuccess?: () => void;
}

export function CustomerLeadStageChangeModal({
  customerId,
  customerName,
  currentLeadStage,
  currentVersion,
  open,
  onOpenChange,
  onSuccess,
}: CustomerLeadStageChangeModalProps) {
  const [targetStage, setTargetStage] = useState<LeadStage>(() =>
    currentLeadStage === 'MQL' ? 'SQL' : 'MQL'
  );
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && reason.trim().length === 0) {
      setReason(LEAD_STAGE_REASON_TEMPLATE);
    }
  }, [open, reason]);
  const [submitting, setSubmitting] = useState(false);

  const fromLabel = currentLeadStage ?? '无';
  const sameAsCurrent = currentLeadStage === targetStage;

  const handleSubmit = async () => {
    if (sameAsCurrent) {
      toast.error('目标阶段与当前阶段相同，请重新选择');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/customers/${customerId}/lead-stage-change-request`, {
        leadStage: targetStage,
        reason: reason.trim() || undefined,
        version: currentVersion,
      });
      toast.success(`已提交审批：${fromLabel} → ${targetStage}，等待审批通过后生效`);
      setReason('');
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>申请变更线索阶段</DialogTitle>
          <DialogDescription>
            客户：<span className="font-medium">{customerName}</span>
            <br />
            当前阶段：<span className="font-medium">{fromLabel}</span>
            <br />
            提交后由审批人审核通过即生效。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="mb-2 block">目标阶段</Label>
            <RadioGroup
              value={targetStage}
              onValueChange={(v) => setTargetStage(v as LeadStage)}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="MQL"
                  id="lead-stage-mql"
                  disabled={currentLeadStage === 'MQL'}
                />
                <Label htmlFor="lead-stage-mql" className="cursor-pointer">
                  MQL (营销合格)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="SQL"
                  id="lead-stage-sql"
                  disabled={currentLeadStage === 'SQL'}
                />
                <Label htmlFor="lead-stage-sql" className="cursor-pointer">
                  SQL (销售合格)
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Label htmlFor="lead-stage-reason">提交备注（建议按四要素填写）</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReason(LEAD_STAGE_REASON_TEMPLATE)}
                disabled={submitting}
              >
                填入模板
              </Button>
            </div>
            <Textarea
              id="lead-stage-reason"
              placeholder={LEAD_STAGE_REASON_TEMPLATE}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              rows={14}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || sameAsCurrent}>
            {submitting ? '提交中…' : '提交审批'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
