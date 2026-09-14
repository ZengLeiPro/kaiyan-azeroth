import type {
  CustomerDuplicateMatchField,
  ICustomerDuplicateMatch,
} from '@ky-azeroth/shared/types/customer';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ResponsiveDialog } from '@/components/mobile/ResponsiveDialog';
import { RelatedEntityLink } from '@/components/patterns/related-entity-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTimeDisplay } from '@/lib/date-utils';

const MATCHED_FIELD_LABELS: Partial<Record<CustomerDuplicateMatchField, string>> = {
  customerName: '客户名称',
  contactPhone: '联系人电话',
  uncId: '统一信用代码',
  organizationId: '组织ID',
};

interface CustomerDuplicateWarningDialogProps {
  open: boolean;
  duplicates: ICustomerDuplicateMatch[];
  /**
   * 是否允许强制新建：
   * - true（软重复）：展示「取消 / 确认新建」+ 可选原因输入框。
   * - false（硬阻断：完全同名 / 统一信用代码 / 联系电话 / 组织ID 精准重复）：仅展示「我知道了」。
   */
  forceable: boolean;
  /** 用户取消 / 关闭（不创建） */
  onCancel: () => void;
  /** 仅 forceable=true 时可用：用户确认仍然创建（带 forceCreate=true + 可选原因重试） */
  onConfirmCreate: (reason?: string) => void;
}

/**
 * 查重命中时的预警弹卡（软可强制 + 硬阻断两态）。
 *
 * 触发链路：CustomersPage 提交建客户表单 → 后端 service.create 调 checkDuplicates 分级：
 * - 软重复（仅名称模糊命中、非完全同名、无精准命中）→ 409 code='DUPLICATE_CUSTOMER'
 *   + forceable=true → 本卡展示列表 + 可选原因，用户「确认新建」走 forceCreate=true 重试，
 *   或「取消」放弃。
 * - 硬重复（完全同名 / uncId / contactPhone / organizationId 精准命中）→ 409
 *   code='DUPLICATE_CUSTOMER_BLOCKED' + forceable=false → 本卡仅展示阻断说明 + 「我知道了」，
 *   无法强制创建。
 */
export function CustomerDuplicateWarningDialog({
  open,
  duplicates,
  forceable,
  onCancel,
  onConfirmCreate,
}: CustomerDuplicateWarningDialogProps) {
  const [reason, setReason] = useState('');

  // 每次打开弹卡时重置原因输入框，避免上一次的残留
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const title = forceable
    ? `检测到 ${duplicates.length} 个疑似重复客户`
    : `检测到 ${duplicates.length} 个精准重复客户，无法新建`;

  const description = forceable
    ? '请先查看下方列表，确认无重复后再选择'
    : '存在精准重复，系统已阻止创建';

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={title}
      description={description}
      desktopMaxWidth="max-w-[760px]"
      modal
      footer={
        forceable ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onCancel}>
              取消（先不建）
            </Button>
            <Button
              variant="destructive"
              onClick={() => onConfirmCreate(reason.trim() ? reason.trim() : undefined)}
            >
              确认新建
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onCancel}>
              我知道了
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        {forceable ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              建议先在 CRM
              列表里搜下方客户，看是否就是要建的那位。如果同名是不同公司（例如同集团多分公司），可以「确认新建」继续。
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              存在完全同名 / 统一信用代码 / 联系电话 / 组织ID
              精准重复，系统已阻止创建。请改用已有客户，或修改客户名称/统一信用代码后重试。
            </span>
          </div>
        )}

        <ul className="divide-y rounded-md border">
          {duplicates.map((dup) => (
            <li key={dup.id} className="space-y-1 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                {/* accessible（公海/自己范围内）→ 穿透打开详情抽屉；别人私海保持纯文本 */}
                {dup.accessible ? (
                  <RelatedEntityLink
                    entityType="customer"
                    id={dup.id}
                    label={dup.customerName}
                    title={dup.customerName}
                  />
                ) : (
                  <span className="font-medium">{dup.customerName}</span>
                )}
                <span className="text-xs text-muted-foreground">{dup.serialNumber}</span>
                <Badge variant={dup.pool === 'public' ? 'secondary' : 'default'}>
                  {dup.pool === 'public' ? '公海' : '私海'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {dup.chargerName && <span>负责人：{dup.chargerName}</span>}
                {dup.createdAt && <span>创建：{formatDateTimeDisplay(dup.createdAt) || '-'}</span>}
              </div>
              {dup.matchedFields.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {dup.matchedFields.map((field) => (
                    <Badge key={field} variant="outline" className="text-[10px]">
                      命中：{MATCHED_FIELD_LABELS[field] ?? field}
                    </Badge>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {forceable && (
          <div className="space-y-1">
            <label
              htmlFor="force-create-reason"
              className="text-sm font-medium text-muted-foreground"
            >
              强制新建原因（选填）
            </label>
            <textarea
              id="force-create-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={200}
              rows={2}
              placeholder="例如：同集团不同分公司，需独立建档"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}
