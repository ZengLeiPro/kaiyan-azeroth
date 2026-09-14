/**
 * 销售数据闭环：证据（evidence）+ 采纳草稿（aiDraft）渲染
 *
 * - evidence（数组，五来源）：
 *   - dingtalk_msg → 「来自 X群 · 发送人 · yyyy-MM-dd HH:mm」+ excerpt
 *   - doc → 标题 + 链接
 *   - calendar → 摘要 + 时间
 *   - crm → 「来自 CRM · 表名」+ excerpt（缺口侦探主来源：商机逾期/应收静默/赢单无跟进等）
 *   - website → 官网留资来源页 + excerpt
 * - aiDraft（kind='keep_record'）→ 渲染成跟进记录卡片预览（客户/类型/时间/内容）
 *
 * shape 见接口契约 §4 / 勘察 09 §1.5。
 */
import {
  canonicalHttpUrlSchema,
  sanitizeSalesActionEvidence,
} from '@ky-azeroth/shared/schemas/sales-action-item';
import type { ISalesActionItemAiDraft } from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import { CalendarDays, Database, FileText, Globe2, MessageSquare } from 'lucide-react';

import { cn } from '@/lib/utils';

function safeFormat(iso: string | undefined | null, pattern: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, pattern);
}

/** 证据列表 */
export function EvidenceList({ evidence, className }: { evidence: unknown; className?: string }) {
  const safeEvidence = sanitizeSalesActionEvidence(evidence);
  if (!safeEvidence || safeEvidence.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>暂无关联证据</p>;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {safeEvidence.map((ev, idx) => {
        if (ev.type === 'dingtalk_msg') {
          return (
            <div key={idx} className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  来自 {ev.conversationTitle || '钉钉'} · {ev.sender || '-'} ·{' '}
                  {safeFormat(ev.sentAt, 'yyyy-MM-dd HH:mm')}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {ev.excerpt || '-'}
              </p>
            </div>
          );
        }
        if (ev.type === 'doc') {
          const parsedHref = canonicalHttpUrlSchema.safeParse(ev.url);
          const href = parsedHref.success ? parsedHref.data : null;
          const label = ev.title || '-';
          return (
            <div key={idx} className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span>钉钉文档</span>
              </div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-primary hover:underline"
                >
                  {label}
                </a>
              ) : (
                <span className="break-all text-sm text-foreground">{label}</span>
              )}
            </div>
          );
        }
        if (ev.type === 'calendar') {
          return (
            <div key={idx} className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                <span>日程 · {safeFormat(ev.start, 'yyyy-MM-dd HH:mm')}</span>
              </div>
              <p className="text-sm text-foreground">{ev.summary || '-'}</p>
            </div>
          );
        }
        if (ev.type === 'website') {
          return (
            <div key={idx} className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Globe2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  官网留资 · {ev.path || '-'}
                  {ev.recordedAt ? ` · ${safeFormat(ev.recordedAt, 'yyyy-MM-dd HH:mm')}` : ''}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {ev.excerpt || '-'}
              </p>
            </div>
          );
        }
        // crm —— 缺口侦探主来源（依据来自存量 CRM：商机逾期/应收静默/赢单无跟进/客户沉睡等）
        return (
          <div key={idx} className="rounded-lg border bg-muted/40 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Database className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                来自 CRM · {ev.table || '-'}
                {ev.recordedAt ? ` · ${safeFormat(ev.recordedAt, 'yyyy-MM-dd HH:mm')}` : ''}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {ev.excerpt || '-'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** 采纳草稿（跟进记录）预览卡片 */
export function AiDraftPreview({
  aiDraft,
  className,
}: {
  aiDraft: ISalesActionItemAiDraft | null | undefined;
  className?: string;
}) {
  if (!aiDraft || aiDraft.kind !== 'keep_record') return null;
  const p = aiDraft.payload;

  return (
    <div
      className={cn(
        'rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-950/30',
        className
      )}
    >
      <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-300">
        采纳后将写入以下跟进记录
      </div>
      <dl className="space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">客户</dt>
          <dd className="break-words text-foreground">{aiDraft.matchedFullName || '-'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">类型</dt>
          <dd className="text-foreground">{p?.keepRecordType || '-'}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">时间</dt>
          <dd className="text-foreground">{safeFormat(p?.keepRecordTime, 'yyyy-MM-dd HH:mm')}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">内容</dt>
          <dd className="whitespace-pre-wrap break-words text-foreground">
            {p?.keepRecordContent || '-'}
          </dd>
        </div>
      </dl>
    </div>
  );
}
