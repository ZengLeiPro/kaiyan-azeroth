/**
 * 客户活动时间线（2026-06-16 投影派改造）
 *
 * 数据源：GET /activities?customerId=xxx（扁平路由约定）
 *  - keep_records / visit_records：原始活动事件
 *  - operation_logs(kind='change', targetCustomerId)：字段级变更
 *
 * 设计：
 *  - 顶部 filter：importance toggle（全部 / 仅里程碑）+ category 多选
 *  - 时间线左轴右卡片，category 决定图标+配色
 *  - 字段级 diff 卡片展开走 ChangeLogPanel 同款渲染（ADMIN 才看 diff，复用既有约定）
 */

import type { ActivityItem, ActivityListResponse } from '@ky-azeroth/shared/schemas/activity';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  Loader2,
  MapPin,
  Phone,
  Receipt,
  RefreshCw,
  Target,
  Undo2,
  User,
  Wallet,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { type DrawerEntityType, useDrawerStackOptional } from '@/components/patterns/drawer-stack';
import { refTypeToDrawerType } from '@/components/patterns/sales-action/constants';
import { api } from '@/lib/api';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

type ActivityCategory = ActivityItem['category'];
type ActivityImportance = ActivityItem['importance'];

interface ActivityTimelinePanelProps {
  customerId: string;
  /** 默认显示几条；展开看全部 */
  initialLimit?: number;
}

const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; icon: typeof Phone; accent: string; bg: string; dot: string }
> = {
  follow_up: {
    label: '跟进',
    icon: Phone,
    accent: 'text-blue-700',
    bg: 'bg-blue-50 border-blue-200',
    dot: 'bg-blue-500',
  },
  visit: {
    label: '签到',
    icon: MapPin,
    accent: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  opportunity: {
    label: '商机',
    icon: Target,
    accent: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-200',
    dot: 'bg-amber-500',
  },
  order: {
    label: '订单',
    icon: FileText,
    accent: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
    dot: 'bg-red-500',
  },
  payment: {
    label: '回款',
    icon: Wallet,
    accent: 'text-yellow-700',
    bg: 'bg-yellow-50 border-yellow-200',
    dot: 'bg-yellow-500',
  },
  refund: {
    label: '退款',
    icon: Undo2,
    accent: 'text-orange-700',
    bg: 'bg-orange-50 border-orange-200',
    dot: 'bg-orange-500',
  },
  invoice: {
    label: '开票',
    icon: Receipt,
    accent: 'text-purple-700',
    bg: 'bg-purple-50 border-purple-200',
    dot: 'bg-purple-500',
  },
  contact: {
    label: '联系人',
    icon: User,
    accent: 'text-slate-700',
    bg: 'bg-slate-50 border-slate-200',
    dot: 'bg-slate-400',
  },
  customer: {
    label: '客户档案',
    icon: Building2,
    accent: 'text-gray-700',
    bg: 'bg-gray-50 border-gray-200',
    dot: 'bg-gray-500',
  },
  todo: {
    label: '待办',
    icon: CheckSquare,
    accent: 'text-indigo-700',
    bg: 'bg-indigo-50 border-indigo-200',
    dot: 'bg-indigo-500',
  },
};

const IMPORTANCE_LABEL: Record<ActivityImportance, string> = {
  milestone: '里程碑',
  normal: '常规',
  trivial: '细节',
};

const ALL_CATEGORIES = Object.keys(CATEGORY_META) as ActivityCategory[];

const DETAIL_ROUTE_BY_TYPE: Partial<Record<DrawerEntityType, string>> = {
  customer: '/crm/customers',
  contact: '/crm/contacts',
  opportunity: '/crm/opportunities',
  'sale-order': '/crm/sale-orders',
  payment: '/crm/payments',
  invoice: '/crm/invoices',
  'keep-record': '/crm/keep-records',
  'visit-record': '/crm/visit-records',
};

export function ActivityTimelinePanel({
  customerId,
  initialLimit = 30,
}: ActivityTimelinePanelProps) {
  const canViewLogs = useAuthStore((state) =>
    state.hasMenuPermission('system', 'operation_logs', 'view')
  );
  const [importanceMode, setImportanceMode] = useState<'all' | 'milestone'>('all');
  const [selectedCategories, setSelectedCategories] = useState<Set<ActivityCategory>>(
    new Set(ALL_CATEGORIES)
  );
  const [limit, setLimit] = useState(initialLimit);

  // 后端 filter 传 importance/category（减少传输量），前端再无需二次过滤
  const importanceParam = importanceMode === 'milestone' ? 'milestone' : undefined;
  const categoryParam =
    selectedCategories.size === ALL_CATEGORIES.length
      ? undefined
      : Array.from(selectedCategories).join(',');

  const query = useQuery({
    queryKey: ['customer-activities', customerId, importanceParam, categoryParam, limit],
    enabled: !!customerId,
    queryFn: async () => {
      const res = await api.get<ActivityListResponse>('/activities', {
        params: {
          customerId,
          importance: importanceParam,
          category: categoryParam,
          limit,
        },
      });
      return res.data;
    },
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = !!query.data?.nextCursor;

  const toggleCategory = (cat: ActivityCategory) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      // 至少保留一个
      if (next.size === 0) return prev;
      return next;
    });
  };

  return (
    <section className="space-y-3">
      {/* ── 工具栏 ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => setImportanceMode('all')}
            className={cn(
              'px-3 py-1 text-xs',
              importanceMode === 'all'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setImportanceMode('milestone')}
            className={cn(
              'px-3 py-1 text-xs',
              importanceMode === 'milestone'
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            仅里程碑
          </button>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <Filter className="mr-1 h-3.5 w-3.5" />
              类别（{selectedCategories.size}/{ALL_CATEGORIES.length}）
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="space-y-1">
              {ALL_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                return (
                  <label
                    key={cat}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted"
                  >
                    <Checkbox
                      checked={selectedCategories.has(cat)}
                      onCheckedChange={() => toggleCategory(cat)}
                    />
                    <Icon className={cn('h-3.5 w-3.5', meta.accent)} />
                    <span className="text-sm">{meta.label}</span>
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex-1" />

        <span className="text-xs text-muted-foreground">共 {total} 条</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => query.refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── 时间线 ───────────────────────────────────────────── */}
      {query.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : query.error ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span>加载活动时间线失败</span>
          <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          暂无活动记录
        </div>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-muted pl-5">
          {items.map((item) => (
            <ActivityTimelineItem key={item.id} item={item} canViewLogs={canViewLogs} />
          ))}
        </ol>
      )}

      {hasMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLimit((prev) => prev + initialLimit)}
          >
            加载更早 {initialLimit} 条
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// ── 单条活动 ─────────────────────────────────────────────────────────

function ActivityTimelineItem({ item, canViewLogs }: { item: ActivityItem; canViewLogs: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const drawerStack = useDrawerStackOptional();
  const meta = CATEGORY_META[item.category];
  const Icon = meta.icon;
  const time = useMemo(() => formatDateTimeDisplay(item.occurredAt) || '-', [item.occurredAt]);
  const hasDiff = canViewLogs && (item.detail?.changes?.length ?? 0) > 0;
  const hasContent = !!item.detail?.content;
  const canExpand = hasDiff || hasContent;
  const detailType = refTypeToDrawerType(item.refType);
  const canOpenDetail = !!detailType && !!item.refId;

  const openDetail = () => {
    if (!detailType || !item.refId) return;
    if (drawerStack) {
      drawerStack.push({
        type: detailType,
        id: item.refId,
        title: item.refName ?? item.summary,
        context: { sourceCustomerId: item.customerId },
      });
      return;
    }

    const route = DETAIL_ROUTE_BY_TYPE[detailType];
    if (route) {
      navigate(`${route}?highlight=${encodeURIComponent(item.refId)}`);
    }
  };

  const toggleExpanded = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setExpanded((prev) => !prev);
  };

  return (
    <li className="relative">
      {/* 时间轴圆点 */}
      <span
        className={cn(
          'absolute -left-[1.625rem] top-2 h-3 w-3 rounded-full ring-2 ring-background',
          item.importance === 'milestone' ? meta.dot : 'bg-muted-foreground/40'
        )}
        aria-hidden
      />
      <article
        className={cn(
          'rounded-md border px-3 py-2',
          meta.bg,
          canOpenDetail && 'cursor-pointer transition-shadow hover:shadow-sm'
        )}
        onClick={canOpenDetail ? openDetail : undefined}
        role={canOpenDetail ? 'button' : undefined}
        tabIndex={canOpenDetail ? 0 : undefined}
        onKeyDown={
          canOpenDetail
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openDetail();
                }
              }
            : undefined
        }
      >
        <header className="flex flex-wrap items-center gap-2">
          <Icon className={cn('h-4 w-4', meta.accent)} />
          <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
            {meta.label}
          </Badge>
          {item.importance !== 'normal' ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
              {IMPORTANCE_LABEL[item.importance]}
            </Badge>
          ) : null}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">{time}</span>
        </header>

        <div className="mt-1.5 flex items-start gap-2 text-sm">
          <span className="flex-1 break-words text-foreground">{item.summary}</span>
          {canExpand ? (
            <button
              type="button"
              onClick={toggleExpanded}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={expanded ? '收起' : '展开'}
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </div>

        {item.actorName ? (
          <div className="mt-1 text-xs text-muted-foreground">由 {item.actorName}</div>
        ) : null}

        {expanded ? (
          <div className="mt-2 space-y-2 border-t border-muted pt-2">
            {hasContent ? (
              <div className="whitespace-pre-wrap break-words text-sm text-foreground">
                {item.detail?.content}
              </div>
            ) : null}
            {hasDiff ? (
              <div className="space-y-1.5">
                {item.detail!.changes!.map((change) => (
                  <div key={change.field} className="grid gap-1 text-xs md:grid-cols-[100px_1fr]">
                    <div className="text-muted-foreground">{change.label}</div>
                    <div className="min-w-0">
                      <span className="break-words text-red-700">{formatValue(change.before)}</span>
                      <span className="px-2 text-muted-foreground">→</span>
                      <span className="break-words text-emerald-700">
                        {formatValue(change.after)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </article>
    </li>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const name = (obj['name'] ?? obj['title'] ?? obj['customerName']) as string | undefined;
    if (typeof name === 'string') return name;
    try {
      return JSON.stringify(value).slice(0, 50);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
