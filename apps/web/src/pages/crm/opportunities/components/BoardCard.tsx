import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { OpportunityProfile } from '../types';

interface BoardCardProps {
  opportunity: OpportunityProfile;
  /** 当前所在列（stage），随卡片落入 dnd 数据，用于在 onDragEnd 中识别源列 */
  stage: string;
  /** 是否禁用拖拽（无 edit 权限时） */
  draggable: boolean;
  onClick?: (opportunity: OpportunityProfile) => void;
}

const FALLBACK = '-';

/**
 * 看板卡片：客户名 / 商机名 / 金额 / 负责人 / 预计成交日期。
 *
 * 数据用 dnd-kit `useSortable`（含 `data.stage` 用于识别源列）；样式参照
 * `mobile-list-card.tsx` 的 shadcn Card 密度。
 */
export function BoardCard({ opportunity, stage, draggable, onClick }: BoardCardProps) {
  const sortable = useSortable({
    id: opportunity.id,
    data: { stage, type: 'card' },
    disabled: !draggable,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const customerName = opportunity.customer?.customerName ?? FALLBACK;
  const productLine =
    opportunity.products
      ?.map((p) => p.productName)
      .filter(Boolean)
      .join(' / ') ?? '';
  const amount = formatAmount(opportunity.opportunityAmount);
  const charger = opportunity.chargerName ?? FALLBACK;
  const chargerInitial = charger.length > 0 && charger !== FALLBACK ? charger.slice(-1) : '?';
  const chargerAvatar = opportunity.chargerAvatar ?? null;
  const dealDate = opportunity.expectedDealDate;
  const overdue = isOverdue(dealDate);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group rounded-md border bg-card p-3 shadow-sm transition-shadow',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50 shadow-lg',
        'hover:shadow-md'
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // dnd-kit 会在 distance:4 才触发拖拽，未越过阈值时此点击不会被吞
        if (isDragging) return;
        e.stopPropagation();
        onClick?.(opportunity);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.(opportunity);
        }
      }}
    >
      <div className="truncate text-sm font-medium text-foreground" title={customerName}>
        {customerName}
      </div>
      {productLine ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={productLine}>
          {productLine}
        </div>
      ) : null}
      <div className="mt-2 text-sm font-semibold text-foreground">{amount}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-1.5">
          {chargerAvatar ? (
            <img
              src={chargerAvatar}
              alt={charger}
              className="h-5 w-5 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
              {chargerInitial}
            </span>
          )}
          <span className="truncate text-muted-foreground" title={charger}>
            {charger}
          </span>
        </div>
        {dealDate ? (
          <div
            className={cn(
              'flex shrink-0 items-center gap-1',
              overdue ? 'text-red-600' : 'text-muted-foreground'
            )}
            title={overdue ? '预计成交日期已逾期' : '预计成交日期'}
          >
            <Calendar className="h-3 w-3" />
            <span>{formatShortDate(dealDate)}</span>
            {overdue && (
              <span className="rounded bg-red-100 px-1 py-0.5 text-[10px] leading-none text-red-700">
                逾期
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatAmount(value: unknown): string {
  if (value == null || value === '') return '¥ -';
  const num = Number(value);
  if (!Number.isFinite(num)) return '¥ -';
  return `¥ ${num.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

/** 解析 expectedDealDate（"YYYY-MM-DD" 或 ISO），返回 Date 或 null */
function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOverdue(value: string | null | undefined): boolean {
  const d = parseDate(value);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  return target.getTime() < today.getTime();
}

function formatShortDate(value: string): string {
  const d = parseDate(value);
  if (!d) return value;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}`;
}
