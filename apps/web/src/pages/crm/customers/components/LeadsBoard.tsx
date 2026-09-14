import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  LEAD_PROGRESS_STATUS,
  type LeadProgressStatusValue,
} from '@ky-azeroth/shared/constants/status-values';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  GripVertical,
  Loader2,
  MapPin,
  MoreHorizontal,
  Phone,
  UserRound,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, getErrorMessage } from '@/lib/api';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

import type { CustomerProfile } from '../types';
import { CustomerLeadProgressModal } from './CustomerLeadProgressModal';

const BOARD_COLUMNS: Array<{
  status: LeadProgressStatusValue;
  label: string;
  color: string;
}> = [
  { status: LEAD_PROGRESS_STATUS.ACTIVE, label: 'M · 活跃', color: 'bg-blue-100 text-blue-800' },
  {
    status: LEAD_PROGRESS_STATUS.NO_SHOW,
    label: 'M · 毁约待重启',
    color: 'bg-orange-100 text-orange-800',
  },
  {
    status: LEAD_PROGRESS_STATUS.PENDING_VISIT,
    label: 'S · 待拜访',
    color: 'bg-yellow-100 text-yellow-800',
  },
  {
    status: LEAD_PROGRESS_STATUS.VISITED,
    label: 'S · 已完成演示/拜访',
    color: 'bg-cyan-100 text-cyan-800',
  },
  { status: LEAD_PROGRESS_STATUS.WON, label: 'S · 已成交', color: 'bg-green-100 text-green-800' },
  { status: LEAD_PROGRESS_STATUS.LOST, label: '流失', color: 'bg-red-100 text-red-800' },
];

function isInteractiveDescendant(target: EventTarget | null, currentTarget: Element): boolean {
  if (!(target instanceof Element) || target === currentTarget) return false;
  const interactive = target.closest(
    'a, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable="true"]'
  );
  return Boolean(
    interactive && interactive !== currentTarget && currentTarget.contains(interactive)
  );
}

type ManualStatus = Extract<
  LeadProgressStatusValue,
  'ACTIVE' | 'NO_SHOW' | 'PENDING_VISIT' | 'LOST'
>;

interface CustomerListResponse {
  items: CustomerProfile[];
  total: number;
}

interface LeadsBoardProps {
  apiParams: Record<string, unknown>;
  canEdit: boolean;
  onCardClick: (customer: CustomerProfile) => void;
  onChanged?: () => void;
}

export function LeadsBoard({ apiParams, canEdit, onCardClick, onChanged }: LeadsBoardProps) {
  const [dragging, setDragging] = useState<CustomerProfile | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    customer: CustomerProfile;
    status: ManualStatus;
  } | null>(null);
  const queryClient = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const queryKey = useMemo(() => ['customers', 'leads-board', apiParams] as const, [apiParams]);

  const { data, isLoading, isError, error, refetch } = useQuery<CustomerListResponse>({
    queryKey,
    queryFn: async () => {
      const response = await api.get<CustomerListResponse>('/customers', {
        params: { ...apiParams, pool: 'leads', page: 1, pageSize: 500 },
      });
      return response.data;
    },
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const result = new Map<LeadProgressStatusValue, CustomerProfile[]>();
    for (const column of BOARD_COLUMNS) result.set(column.status, []);
    for (const customer of data?.items ?? []) {
      const status = resolveBoardStatus(customer);
      result.get(status)?.push(customer);
    }
    return result;
  }, [data]);

  const handleDragStart = (event: DragStartEvent) => {
    const customer = event.active.data.current?.customer as CustomerProfile | undefined;
    setDragging(customer ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const customer = event.active.data.current?.customer as CustomerProfile | undefined;
    const targetStatus = event.over?.data.current?.status as LeadProgressStatusValue | undefined;
    if (!customer || !targetStatus || targetStatus === resolveBoardStatus(customer)) return;
    if (
      targetStatus === LEAD_PROGRESS_STATUS.VISITED ||
      targetStatus === LEAD_PROGRESS_STATUS.WON
    ) {
      toast.error(
        targetStatus === LEAD_PROGRESS_STATUS.VISITED
          ? '“已完成演示/拜访”只能由线上演示或真实拜访记录自动产生'
          : '“已成交”只能由商机赢单自动产生'
      );
      return;
    }
    setPendingAction({ customer, status: targetStatus as ManualStatus });
  };

  const handleSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ['customers', 'leads-board'] });
    onChanged?.();
  };

  if (isLoading) {
    return (
      <div className="flex min-h-72 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在加载 Leads 看板…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
        <span>{getErrorMessage(error, 'Leads 看板加载失败')}</span>
        <Button variant="outline" onClick={() => void refetch()}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 text-sm text-muted-foreground">
        共 {data?.total ?? 0} 条线索
        {(data?.total ?? 0) > (data?.items.length ?? 0) ? '（已截断到 500）' : ''}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragCancel={() => setDragging(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-[calc(100vh-280px)] gap-3 overflow-x-auto pb-3">
          {BOARD_COLUMNS.map((column) => (
            <LeadBoardColumn
              key={column.status}
              {...column}
              customers={grouped.get(column.status) ?? []}
              canEdit={canEdit}
              onCardClick={onCardClick}
              onSchedule={(customer) =>
                setPendingAction({ customer, status: LEAD_PROGRESS_STATUS.PENDING_VISIT })
              }
              onMove={(customer, status) => setPendingAction({ customer, status })}
            />
          ))}
        </div>
        <DragOverlay>{dragging ? <LeadCardBody customer={dragging} overlay /> : null}</DragOverlay>
      </DndContext>

      {pendingAction && typeof pendingAction.customer.version === 'number' && (
        <CustomerLeadProgressModal
          customerId={pendingAction.customer.id}
          customerName={pendingAction.customer.customerName}
          currentVersion={pendingAction.customer.version}
          currentAppointmentAt={pendingAction.customer.leadAppointmentAt}
          targetStatus={pendingAction.status}
          open
          onOpenChange={(open) => {
            if (!open) setPendingAction(null);
          }}
          onSuccess={() => void handleSuccess()}
        />
      )}
    </>
  );
}

function LeadBoardColumn({
  status,
  label,
  color,
  customers,
  canEdit,
  onCardClick,
  onSchedule,
  onMove,
}: (typeof BOARD_COLUMNS)[number] & {
  customers: CustomerProfile[];
  canEdit: boolean;
  onCardClick: (customer: CustomerProfile) => void;
  onSchedule: (customer: CustomerProfile) => void;
  onMove: (customer: CustomerProfile, status: ManualStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lead-column-${status}`,
    data: { status, type: 'column' },
  });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/40">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', color)}>{label}</span>
        <span className="text-xs text-muted-foreground">{customers.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 space-y-2 overflow-y-auto p-2 transition-colors',
          isOver && 'bg-primary/5'
        )}
      >
        {customers.map((customer) => (
          <LeadBoardCard
            key={customer.id}
            customer={customer}
            canEdit={canEdit}
            onClick={() => onCardClick(customer)}
            onSchedule={() => onSchedule(customer)}
            onMove={(targetStatus) => onMove(customer, targetStatus)}
          />
        ))}
        {customers.length === 0 && (
          <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            暂无线索
          </div>
        )}
      </div>
    </div>
  );
}

function LeadBoardCard({
  customer,
  canEdit,
  onClick,
  onSchedule,
  onMove,
}: {
  customer: CustomerProfile;
  canEdit: boolean;
  onClick: () => void;
  onSchedule: () => void;
  onMove: (status: ManualStatus) => void;
}) {
  const status = resolveBoardStatus(customer);
  const draggable = canEdit && status !== LEAD_PROGRESS_STATUS.WON;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: customer.id,
      data: { customer, status, type: 'card' },
      disabled: !draggable,
    });
  const dragHandle = draggable ? (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7 cursor-grab touch-none active:cursor-grabbing"
      {...attributes}
      {...listeners}
      aria-label={`拖动 ${customer.customerName} 调整线索状态`}
    >
      <GripVertical className="h-4 w-4" />
    </Button>
  ) : undefined;

  return (
    <div
      ref={setNodeRef}
      style={
        transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
      }
      className={cn(isDragging && 'opacity-30')}
    >
      <LeadCardBody
        customer={customer}
        onClick={onClick}
        onSchedule={canEdit ? onSchedule : undefined}
        onMove={canEdit ? onMove : undefined}
        dragHandle={dragHandle}
      />
    </div>
  );
}

function LeadCardBody({
  customer,
  overlay = false,
  onClick,
  onSchedule,
  onMove,
  dragHandle,
}: {
  customer: CustomerProfile;
  overlay?: boolean;
  onClick?: () => void;
  onSchedule?: () => void;
  onMove?: (status: ManualStatus) => void;
  dragHandle?: ReactNode;
}) {
  const status = resolveBoardStatus(customer);
  const canSchedule = status !== LEAD_PROGRESS_STATUS.WON && status !== LEAD_PROGRESS_STATUS.LOST;

  return (
    <div
      className={cn(
        'rounded-md border bg-background p-3 shadow-sm',
        overlay && 'w-72 rotate-1 shadow-lg',
        onClick && 'cursor-pointer hover:border-primary/40'
      )}
      onClick={(event) => {
        if (!isInteractiveDescendant(event.target, event.currentTarget)) onClick?.();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {onClick ? (
            <button
              type="button"
              className="block max-w-full truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={customer.customerName}
              onClick={(event) => {
                event.stopPropagation();
                onClick();
              }}
            >
              {customer.customerName}
            </button>
          ) : (
            <div className="truncate text-sm font-medium" title={customer.customerName}>
              {customer.customerName}
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {[customer.industry, customer.customerLevel ? `${customer.customerLevel}级` : null]
              .filter(Boolean)
              .join(' · ') || '未补客户画像'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {dragHandle}
          {canSchedule && onSchedule && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title={status === LEAD_PROGRESS_STATUS.PENDING_VISIT ? '修改预约时间' : '安排拜访'}
              aria-label={
                status === LEAD_PROGRESS_STATUS.PENDING_VISIT ? '修改预约时间' : '安排拜访'
              }
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSchedule();
              }}
            >
              <CalendarClock className="h-4 w-4" />
            </Button>
          )}
          {onMove && status !== LEAD_PROGRESS_STATUS.WON && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="更改线索状态"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                {BOARD_COLUMNS.filter(
                  (column) =>
                    column.status !== status &&
                    (column.status === LEAD_PROGRESS_STATUS.ACTIVE ||
                      column.status === LEAD_PROGRESS_STATUS.NO_SHOW ||
                      column.status === LEAD_PROGRESS_STATUS.PENDING_VISIT ||
                      column.status === LEAD_PROGRESS_STATUS.LOST)
                ).map((column) => (
                  <DropdownMenuItem
                    key={column.status}
                    onClick={() => onMove(column.status as ManualStatus)}
                  >
                    移到「{column.label}」
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <UserRound className="h-3.5 w-3.5" />
          <span>{customer.chargerName || '未分配负责人'}</span>
        </div>
        {status === LEAD_PROGRESS_STATUS.PENDING_VISIT && (
          <div className="flex items-center gap-1.5 text-amber-700">
            <CalendarClock className="h-3.5 w-3.5" />
            <span>
              {customer.leadAppointmentAt
                ? formatDateTimeDisplay(customer.leadAppointmentAt) || '预约时间待补录'
                : '预约时间待补录'}
            </span>
          </div>
        )}
        {customer.city && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            <span>{customer.city}</span>
          </div>
        )}
        {customer.lastKeepRecordTime && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" />
            <span>最近跟进 {formatDateTimeDisplay(customer.lastKeepRecordTime) || '-'}</span>
          </div>
        )}
        {(status === LEAD_PROGRESS_STATUS.NO_SHOW || status === LEAD_PROGRESS_STATUS.LOST) &&
          customer.leadProgressReason && (
            <div className="line-clamp-2 border-t pt-1.5" title={customer.leadProgressReason}>
              {customer.leadProgressReason}
            </div>
          )}
      </div>
    </div>
  );
}

function resolveBoardStatus(customer: CustomerProfile): LeadProgressStatusValue {
  return (
    customer.leadProgressStatus ??
    (customer.leadStage === 'SQL'
      ? LEAD_PROGRESS_STATUS.PENDING_VISIT
      : LEAD_PROGRESS_STATUS.ACTIVE)
  );
}
