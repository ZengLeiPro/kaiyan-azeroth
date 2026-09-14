import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { OPPORTUNITY_STAGE_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import { OPPORTUNITY_STAGE } from '@ky-azeroth/shared/constants/status-values';
import type { IOpportunityResponse } from '@ky-azeroth/shared/types/opportunity';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

import type { OpportunityProfile } from '../types';
import { BoardCard } from './BoardCard';
import { BoardColumn } from './BoardColumn';
import { ConfirmStageDialog, type ConfirmStageTerminalPayload } from './ConfirmStageDialog';

/** 漏斗顺序：活跃 4 列在前，终态 2 列收起 */
const ACTIVE_STAGES = [
  OPPORTUNITY_STAGE.DISCOVER,
  OPPORTUNITY_STAGE.SOLUTION,
  OPPORTUNITY_STAGE.NEGOTIATION,
  OPPORTUNITY_STAGE.CONTRACT,
] as const;
const TERMINAL_STAGES = [OPPORTUNITY_STAGE.WON, OPPORTUNITY_STAGE.LOST] as const;
const ALL_STAGES = [...ACTIVE_STAGES, ...TERMINAL_STAGES] as const;

const TERMINAL_SET = new Set<string>(TERMINAL_STAGES);
const STAGE_LABEL_SET = new Set(Object.keys(OPPORTUNITY_STAGE_LABELS));

interface BoardViewProps {
  /** 透传 OpportunitiesPage 的列表查询参数（chargerId / 客户 / 关键词等） */
  apiParams: Record<string, unknown>;
  /** 当前用户是否有 edit 权限——决定卡片可否拖拽 */
  canEdit: boolean;
  /** 点击卡片打开商机详情抽屉（复用列表视图的 useCrud） */
  onCardClick?: (opportunity: OpportunityProfile) => void;
}

interface ListResponse {
  items: IOpportunityResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** mutation 入参 */
interface UpdateStageVariables {
  id: string;
  fromStage: string;
  toStage: string;
  version: number;
  /** 拖到「输单流失」时，弹框收集的失单原因（必填） */
  loseReason?: string;
  /** 拖到「输单流失」时，弹框收集的失单原因备注（loseReason='其他' 时必填） */
  loseReasonDetail?: string;
  /** 拖到「输单流失」时，弹框收集的输单日期（可选，空值由后端自动填当前时间） */
  lostDate?: string | null;
}

/** 看板视图主容器：横向滚动 + 跨列拖拽 + 乐观更新 */
export function BoardView({ apiParams, canEdit, onCardClick }: BoardViewProps) {
  const [showTerminal, setShowTerminal] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<UpdateStageVariables | null>(null);
  const [draggingCard, setDraggingCard] = useState<{
    opportunity: OpportunityProfile;
    stage: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const visibleStages = useMemo(() => (showTerminal ? ALL_STAGES : ACTIVE_STAGES), [showTerminal]);

  // queryKey 含 visibleStages 与 apiParams,筛选切换会自然失效缓存
  const queryKey = useMemo(
    () => ['opportunities', 'board', { stages: [...visibleStages], apiParams }] as const,
    [visibleStages, apiParams]
  );

  const { data, isLoading, isError, error, refetch } = useQuery<ListResponse>({
    queryKey,
    queryFn: async () => {
      // 剥离任何残留的 stage 筛选 key（用户在列表视图设过 stage 筛选后切看板的边缘情况），
      // 避免与本视图按 stage 分列冲突。
      const sanitizedParams = stripStageParams(apiParams);
      const res = await api.get<ListResponse>('/opportunities', {
        params: {
          ...sanitizedParams,
          opportunityStage: [...visibleStages],
          pageSize: 500,
          page: 1,
          withProducts: true,
        },
      });
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  // 按 stage 分组
  const grouped = useMemo(() => {
    const map = new Map<string, OpportunityProfile[]>();
    for (const stage of visibleStages) map.set(stage, []);
    for (const item of data?.items ?? []) {
      const stage = item.opportunityStage;
      if (stage && map.has(stage)) {
        map.get(stage)!.push(item as OpportunityProfile);
      }
    }
    return map;
  }, [data, visibleStages]);

  // 拖拽 sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // mutation：调 PUT，乐观更新 + 失败回滚
  const updateStage = useMutation({
    mutationFn: async (variables: UpdateStageVariables) => {
      // 拖到「输单流失」时一并带上 loseReason + lostDate；其他 stage 只传 stage
      const payload: Record<string, unknown> = {
        opportunityStage: variables.toStage,
        version: variables.version,
      };
      if (variables.toStage === '输单流失') {
        if (variables.loseReason !== undefined) payload.loseReason = variables.loseReason;
        if (variables.loseReasonDetail !== undefined)
          payload.loseReasonDetail = variables.loseReasonDetail;
        if (variables.lostDate !== undefined) payload.lostDate = variables.lostDate;
      }
      await api.put(`/opportunities/${variables.id}`, payload);
      return variables;
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['opportunities', 'board'] });
      // 乐观更新所有 board query 缓存（含展开/未展开终态两份）
      const snapshots = queryClient.getQueriesData<ListResponse>({
        queryKey: ['opportunities', 'board'],
      });
      for (const [key, prev] of snapshots) {
        if (!prev) continue;
        const nextItems = prev.items.map((it) =>
          it.id === variables.id
            ? {
                ...it,
                opportunityStage: variables.toStage,
                version: (it.version ?? 1) + 1,
              }
            : it
        );
        queryClient.setQueryData<ListResponse>(key, { ...prev, items: nextItems });
      }
      return { snapshots };
    },
    onError: (err, _variables, context) => {
      // 回滚
      if (context?.snapshots) {
        for (const [key, prev] of context.snapshots) {
          queryClient.setQueryData(key, prev);
        }
      }
      toast.error(getErrorMessage(err, '更新失败，已回滚'));
    },
    onSuccess: (variables) => {
      const stageLabel =
        OPPORTUNITY_STAGE_LABELS[variables.toStage as keyof typeof OPPORTUNITY_STAGE_LABELS] ??
        variables.toStage;
      toast.success(`已移到「${stageLabel}」`, {
        action: {
          label: '撤销',
          onClick: () => {
            const latest = findOpportunityInCache(queryClient, variables.id);
            // @validation-ok 业务规则：撤销前必须能从缓存读取最新版本号（乐观锁需要），非字段验证
            if (!latest) {
              toast.error('无法撤销：找不到最新版本');
              return;
            }
            updateStage.mutate({
              id: variables.id,
              fromStage: variables.toStage,
              toStage: variables.fromStage,
              version: latest.version ?? 1,
            });
          },
        },
      });
    },
    onSettled: () => {
      // 让所有列表/看板缓存重新拉取（包括 useCrud 的 ['/opportunities', ...] 命名空间）
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    },
  });

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const stage = (active.data.current?.stage as string | undefined) ?? '';
    const all = data?.items ?? [];
    const opp = all.find((o) => o.id === active.id);
    if (opp) setDraggingCard({ opportunity: opp as OpportunityProfile, stage });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingCard(null);
    const { active, over } = event;
    if (!over) return;

    const fromStage = (active.data.current?.stage as string | undefined) ?? '';
    // over 可能是另一卡片或列；列上 data.stage = stage，卡片上 data.stage = stage
    const toStage = (over.data.current?.stage as string | undefined) ?? '';
    if (!fromStage || !toStage) return;
    if (!STAGE_LABEL_SET.has(toStage)) return;
    if (fromStage === toStage) return; // 同列内排序不持久化（本期不做）

    const all = data?.items ?? [];
    const opp = all.find((o) => o.id === active.id) as OpportunityProfile | undefined;
    if (!opp) return;
    const version = opp.version ?? 1;

    const variables: UpdateStageVariables = {
      id: opp.id,
      fromStage,
      toStage,
      version,
    };

    if (TERMINAL_SET.has(toStage)) {
      setPendingConfirm(variables);
    } else {
      updateStage.mutate(variables);
    }
  }

  function handleConfirmTerminal(payload?: ConfirmStageTerminalPayload) {
    if (!pendingConfirm) return;
    const variables: UpdateStageVariables = {
      ...pendingConfirm,
      ...(payload?.loseReason !== undefined ? { loseReason: payload.loseReason } : {}),
      ...(payload?.loseReasonDetail !== undefined
        ? { loseReasonDetail: payload.loseReasonDetail }
        : {}),
      ...(payload?.lostDate !== undefined ? { lostDate: payload.lostDate } : {}),
    };
    setPendingConfirm(null);
    updateStage.mutate(variables);
  }

  // 终态展开按钮文案
  const toggleTerminal = () => setShowTerminal((v) => !v);

  return (
    <div className="flex h-full min-h-[480px] flex-col">
      {/* 顶部小工具栏：终态列展开 / 加载状态 */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isLoading ? (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载中
            </span>
          ) : data ? (
            <span>
              共 {data.total} 条商机{data.total >= 500 ? '（已截断到 500）' : ''}
            </span>
          ) : null}
          {!canEdit && <span className="text-muted-foreground">（只读模式：无编辑权限）</span>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={toggleTerminal}>
          {showTerminal ? (
            <>
              <ChevronUp className="mr-1 h-4 w-4" /> 收起赢单 / 输单流失
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-4 w-4" /> 展开赢单 / 输单流失
            </>
          )}
        </Button>
      </div>

      {/* 错误态 */}
      {isError && (
        <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          加载失败：{getErrorMessage(error)}{' '}
          <button type="button" className="ml-2 underline" onClick={() => refetch()}>
            重试
          </button>
        </div>
      )}

      {/* 看板列容器 */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingCard(null)}
      >
        <div
          className={cn(
            'flex flex-1 gap-3 overflow-x-auto pb-2',
            // 让单列高度自动撑满，但不超过视口
            'min-h-0'
          )}
        >
          {isLoading
            ? visibleStages.map((stage) => (
                <div key={stage} className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
                  <div className="border-b px-3 py-2">
                    <Skeleton className="h-5 w-24" />
                  </div>
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                </div>
              ))
            : visibleStages.map((stage) => (
                <BoardColumn
                  key={stage}
                  stage={stage}
                  opportunities={grouped.get(stage) ?? []}
                  draggable={canEdit && !updateStage.isPending}
                  onCardClick={onCardClick}
                />
              ))}
        </div>

        {/* 拖拽时的浮动卡片预览 */}
        <DragOverlay>
          {draggingCard ? (
            <div className="rotate-1 opacity-90">
              <BoardCard
                opportunity={draggingCard.opportunity}
                stage={draggingCard.stage}
                draggable={false}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* 终态确认弹框 */}
      <ConfirmStageDialog
        open={pendingConfirm !== null}
        opportunityName={
          pendingConfirm
            ? (data?.items.find((o) => o.id === pendingConfirm.id)?.opportunityName ?? '')
            : ''
        }
        toStage={pendingConfirm?.toStage ?? ''}
        onConfirm={handleConfirmTerminal}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

/** 剥离传入参数中可能存在的 stage 筛选 key（顶层 + 多种 bracket 形态） */
function stripStageParams(params: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (
      key === 'opportunityStage' ||
      key === 'filters[opportunityStage]' ||
      key === 'filters[opportunityStage][]'
    ) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

/** 在所有 board query 缓存里查找最新的 opportunity（用于撤销时拿到最新 version） */
function findOpportunityInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string
): IOpportunityResponse | undefined {
  const snapshots = queryClient.getQueriesData<ListResponse>({
    queryKey: ['opportunities', 'board'],
  });
  for (const [, prev] of snapshots) {
    const found = prev?.items.find((it) => it.id === id);
    if (found) return found;
  }
  return undefined;
}
