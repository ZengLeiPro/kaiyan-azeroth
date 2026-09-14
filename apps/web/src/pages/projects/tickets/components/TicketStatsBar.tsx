import type { IProjectTicketStats } from '@ky-azeroth/shared/types/project-ticket';
import { AlertTriangle, CheckCircle2, Clock, PlayCircle, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface TicketStatsBarProps {
  stats: IProjectTicketStats | null;
  activeStatus?: string | null;
  onStatusClick?: (status: string | null) => void;
}

interface StatItem {
  key: string;
  label: string;
  value: number;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
  filterValue: string | null;
}

export function TicketStatsBar({ stats, activeStatus, onStatusClick }: TicketStatsBarProps) {
  const items: StatItem[] = [
    {
      key: 'pending',
      label: '待处理',
      value: stats?.pending ?? 0,
      color: 'text-amber-600',
      icon: Clock,
      filterValue: 'PENDING',
    },
    {
      key: 'in_progress',
      label: '处理中',
      value: stats?.inProgress ?? 0,
      color: 'text-blue-600',
      icon: PlayCircle,
      filterValue: 'IN_PROGRESS',
    },
    {
      key: 'completed',
      label: '已完成',
      value: stats?.completed ?? 0,
      color: 'text-green-600',
      icon: CheckCircle2,
      filterValue: 'COMPLETED',
    },
    {
      key: 'closed',
      label: '已关闭',
      value: stats?.closed ?? 0,
      color: 'text-gray-600',
      icon: CheckCircle2,
      filterValue: 'CLOSED',
    },
    {
      key: 'cancelled',
      label: '已取消',
      value: stats?.cancelled ?? 0,
      color: 'text-gray-400',
      icon: XCircle,
      filterValue: 'CANCELLED',
    },
    {
      key: 'overdue',
      label: '已超期',
      value: stats?.overdue ?? 0,
      color: 'text-red-600',
      icon: AlertTriangle,
      filterValue: 'OVERDUE',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeStatus === item.filterValue;
        return (
          <button
            type="button"
            key={item.key}
            onClick={() => {
              if (!onStatusClick) return;
              onStatusClick(isActive ? null : item.filterValue);
            }}
            className={cn(
              'flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-all',
              'hover:border-primary/40 hover:bg-accent',
              isActive && 'border-primary bg-primary/5 ring-1 ring-primary/30'
            )}
          >
            <Icon className={cn('h-5 w-5 shrink-0', item.color)} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-muted-foreground">{item.label}</div>
              <div className={cn('text-xl font-semibold tabular-nums', item.color)}>
                {item.value}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
