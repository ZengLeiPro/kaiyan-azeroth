import type { OperationLogResponse } from '@ky-azeroth/shared/schemas/system';
import { useQuery } from '@tanstack/react-query';
import { History, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ServerPaginationResponse } from '@/hooks/use-server-pagination';
import { api } from '@/lib/api';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

export interface ChangeLogTarget {
  module: string;
  target: string | null | undefined;
}

interface ChangeLogPanelProps {
  target?: ChangeLogTarget;
}

interface FieldChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

interface ChangeLogDetails {
  kind?: string;
  targetName?: string | null;
  changes?: FieldChange[];
  [key: string]: unknown;
}

const ACTION_LABELS: Record<string, string> = {
  create: '新建',
  update: '更新',
  delete: '删除',
  claim: '认领',
  restore: '恢复',
  'red-void': '冲红',
  'submit-approval': '提交审批',
  'submit-refund': '提交退款审批',
  'batch-transfer': '批量转交',
  'batch-update': '批量编辑',
  'batch-delete': '批量删除',
  'batch-add-collab': '批量加协作人',
  'batch-remove-collab': '批量移除协作人',
  'batch-approve': '批量审批',
  'merge-invoice': '合并开票',
};

const HIDDEN_CHANGE_FIELDS = new Set([
  'customer',
  'customers',
  'contact',
  'contacts',
  'charger',
  'creator',
  'updater',
  'saleOrder',
  'saleOrders',
  'opportunity',
  'opportunities',
  'payments',
  'invoices',
  'keepRecords',
  'visitRecords',
  'projects',
  'relatedPayment',
]);

export function ChangeLogPanel({ target }: ChangeLogPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const canViewLogs = useAuthStore((state) =>
    state.hasMenuPermission('system', 'operation_logs', 'view')
  );
  const enabled = canViewLogs && !!target?.module && !!target.target;

  useEffect(() => {
    setShowAll(false);
  }, [target?.module, target?.target]);

  const query = useQuery({
    queryKey: ['change-logs', target?.module, target?.target],
    enabled,
    queryFn: async () => {
      const res = await api.get<ServerPaginationResponse<OperationLogResponse>>('/operation-logs', {
        params: {
          module: target?.module,
          target: target?.target,
          kind: 'change',
          page: 1,
          pageSize: 100,
        },
      });
      return res.data;
    },
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasTarget = !!target?.module && !!target.target;
  const visibleItems = showAll ? items : items.slice(0, 2);
  const hasMore = !showAll && total > visibleItems.length;

  if (!canViewLogs || !hasTarget) return null;

  return (
    <section className="border-t pt-4">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">更改记录</span>
          {total > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
              {total}
            </Badge>
          ) : null}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {query.isLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中...
          </div>
        ) : query.error ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <span>加载更改记录失败</span>
            <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
            暂无更改记录
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {visibleItems.map((log) => (
                <ChangeLogItem key={log.id} log={log} />
              ))}
            </div>
            {hasMore ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowAll(true)}>
                更多
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

const CHANGE_COLLAPSE_THRESHOLD = 6;

function ChangeLogItem({ log }: { log: OperationLogResponse }) {
  const [expanded, setExpanded] = useState(false);
  const details = (log.details ?? {}) as ChangeLogDetails;
  const changes = Array.isArray(details.changes)
    ? details.changes.filter((change) => !HIDDEN_CHANGE_FIELDS.has(change.field))
    : [];
  const collapsedChanges = changes.slice(0, CHANGE_COLLAPSE_THRESHOLD);
  const visibleChanges = expanded ? changes : collapsedChanges;
  const hiddenCount = Math.max(changes.length - collapsedChanges.length, 0);
  const actionLabel = ACTION_LABELS[log.action] ?? log.action;
  const operator = log.operatorName ?? log.operator ?? '未知操作人';
  const createdAt = useMemo(() => formatDateTimeDisplay(log.createdAt) || '-', [log.createdAt]);

  return (
    <article className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge className={cn('h-5 px-1.5 text-[11px]', actionColor(log.action))}>
            {actionLabel}
          </Badge>
          <span className="truncate text-sm font-medium">{operator}</span>
        </div>
        <time className="font-mono text-xs text-muted-foreground">{createdAt}</time>
      </div>

      {visibleChanges.length > 0 ? (
        <div className="mt-3 space-y-2">
          {visibleChanges.map((change) => (
            <div key={change.field} className="grid gap-1 text-sm md:grid-cols-[120px_1fr]">
              <div className="text-muted-foreground">{change.label}</div>
              <div className="min-w-0">
                <span className="break-words text-red-700">{formatValue(change.before)}</span>
                <span className="px-2 text-muted-foreground">→</span>
                <span className="break-words text-emerald-700">{formatValue(change.after)}</span>
              </div>
            </div>
          ))}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {expanded ? '收起' : `另有 ${hiddenCount} 项变更，点击展开`}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 text-sm text-muted-foreground">无字段级差异</div>
      )}
    </article>
  );
}

function actionColor(action: string | undefined): string {
  switch (action) {
    case 'create':
    case 'restore':
      return 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100';
    case 'delete':
    case 'red-void':
    case 'batch-delete':
      return 'bg-red-100 text-red-800 hover:bg-red-100';
    case 'claim':
    case 'batch-transfer':
    case 'batch-remove-collab':
    case 'submit-approval':
    case 'submit-refund':
      return 'bg-amber-100 text-amber-800 hover:bg-amber-100';
    default:
      return 'bg-blue-100 text-blue-800 hover:bg-blue-100';
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return formatArrayValue(value);
  if (typeof value === 'object') return formatObjectValue(value as Record<string, unknown>);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatArrayValue(value: unknown[]): string {
  if (value.length === 0) return '空';
  const names = value
    .map((item) => (isRecord(item) ? pickDisplayName(item) : formatValue(item)))
    .filter((item): item is string => Boolean(item));

  if (names.length > 0) {
    const visible = names.slice(0, 3).join('、');
    const suffix = names.length > 3 ? ` 等 ${names.length} 项` : '';
    return `${value.length} 项：${visible}${suffix}`;
  }

  return `${value.length} 项`;
}

function formatObjectValue(value: Record<string, unknown>): string {
  const name = pickDisplayName(value);
  if (name) return name;
  const entries = Object.entries(value).filter(
    ([, child]) => child !== null && child !== undefined
  );
  if (entries.length === 0) return '空对象';
  const summary = entries
    .slice(0, 3)
    .map(([key, child]) => `${key}: ${formatValue(child)}`)
    .join('，');
  return entries.length > 3 ? `${summary} 等 ${entries.length} 项` : summary;
}

function pickDisplayName(value: Record<string, unknown>): string | null {
  const candidateKeys = [
    'customerName',
    'contactName',
    'opportunityName',
    'orderTitle',
    'productName',
    'serialNumber',
    'invoiceNumber',
    'name',
    'title',
  ];
  for (const key of candidateKeys) {
    const child = value[key];
    if (typeof child === 'string' && child.trim()) return child;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
