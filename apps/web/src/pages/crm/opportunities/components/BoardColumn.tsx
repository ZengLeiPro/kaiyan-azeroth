import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import { opportunityStageMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';

import type { OpportunityProfile } from '../types';
import { BoardCard } from './BoardCard';

interface BoardColumnProps {
  /** stage 值同时作为列 id 和分组键（如 "发现需求"） */
  stage: string;
  opportunities: OpportunityProfile[];
  /** 是否禁用拖拽（无 edit 权限或加载中） */
  draggable: boolean;
  onCardClick?: (opportunity: OpportunityProfile) => void;
}

/**
 * 看板单列：列头（阶段名 + 数量 + 金额合计）+ 卡片堆。
 *
 * - 整列用 `useDroppable({ id: stage })`，确保空列也能接收拖入；
 * - 列内卡片用 `SortableContext` 包裹（同列内拖拽视觉反馈）；
 * - 列宽固定 `w-72`（约 288px），由父级 `flex overflow-x-auto` 横向滚动；
 * - 列内 `overflow-y-auto` 单列纵向独立滚动。
 */
export function BoardColumn({ stage, opportunities, draggable, onCardClick }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage, type: 'column' } });
  const totalAmount = opportunities.reduce(
    (sum, opp) => sum + (opp.opportunityAmount != null ? Number(opp.opportunityAmount) : 0),
    0
  );
  const stageColorClass =
    (opportunityStageMap as Record<string, { color: string } | undefined>)[stage]?.color ??
    'bg-gray-100 text-gray-800';

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
      {/* 列头 */}
      <div className="flex items-baseline justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
              stageColorClass
            )}
          >
            {stage}
          </span>
          <span className="text-xs text-muted-foreground">{opportunities.length}</span>
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {formatTotalAmount(totalAmount)}
        </span>
      </div>

      {/* 卡片堆（droppable 区） */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 space-y-2 overflow-y-auto p-2 transition-colors',
          isOver && 'bg-primary/5'
        )}
      >
        <SortableContext
          items={opportunities.map((o) => o.id)}
          strategy={verticalListSortingStrategy}
        >
          {opportunities.length === 0 ? (
            <div className="flex h-20 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
              拖入此列
            </div>
          ) : (
            opportunities.map((opp) => (
              <BoardCard
                key={opp.id}
                opportunity={opp}
                stage={stage}
                draggable={draggable}
                onClick={onCardClick}
              />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}

function formatTotalAmount(total: number): string {
  if (!Number.isFinite(total) || total === 0) return '¥ 0';
  if (total >= 10000) {
    return `¥ ${(total / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万`;
  }
  return `¥ ${total.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}
