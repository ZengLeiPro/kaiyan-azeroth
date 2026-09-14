import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import type { DayEffort } from '../types';
import { getNextWorkDate } from '../types';

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface WeekStatusBarProps {
  weekDates: string[];
  dayEfforts: Map<string, DayEffort>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** 哪些日期有关联的明日计划（键是计划的 targetDate） */
  planDates?: Set<string>;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

function getDayOfWeekIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  // Convert Sun=0,Mon=1...Sat=6 -> Mon=0...Sun=6
  return day === 0 ? 6 : day - 1;
}

export function WeekStatusBar({
  weekDates,
  dayEfforts,
  selectedDate,
  onSelectDate,
  planDates,
}: WeekStatusBarProps) {
  const isMobile = useIsMobile();

  return (
    <div className={cn('flex items-center gap-2', isMobile && 'overflow-x-auto pb-2')}>
      {weekDates.map((date) => {
        const dayEffort = dayEfforts.get(date);
        const isSelected = date === selectedDate;
        const weekend = isWeekend(date);
        const dayIdx = getDayOfWeekIndex(date);
        const label = DAY_LABELS[dayIdx] ?? '';
        const dayNum = date.slice(8, 10);
        const totalHours = dayEffort?.totalHours ?? 0;
        const status = dayEffort?.status ?? 'empty';
        const hasPlan = planDates?.has(getNextWorkDate(date)) ?? false;

        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDate(date)}
            className={cn(
              'relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 transition-colors',
              'min-w-[3rem] shrink-0',
              isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'
            )}
          >
            <span className="text-xs text-muted-foreground">周{label}</span>
            <span className="text-sm font-medium">{dayNum}</span>
            <StatusDot status={status} weekend={weekend} />
            {totalHours > 0 && (
              <span className="text-[10px] text-muted-foreground">{totalHours.toFixed(1)}h</span>
            )}
            {hasPlan && (
              <span className="absolute -right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function StatusDot({ status, weekend }: { status: DayEffort['status']; weekend: boolean }) {
  if (weekend && status === 'empty') {
    // Weekend with no entries: gray dash
    return (
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="h-0.5 w-3 rounded-full bg-muted-foreground/40" />
      </span>
    );
  }

  if (status === 'complete') {
    // >= 8h: green filled circle
    return (
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
      </span>
    );
  }

  if (status === 'partial') {
    // < 8h: orange ring
    return (
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-orange-500" />
      </span>
    );
  }

  // Workday but empty: red exclamation
  if (!weekend && status === 'empty') {
    return (
      <span className="flex h-5 w-5 items-center justify-center text-xs font-bold text-red-500">
        !
      </span>
    );
  }

  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <span className="h-0.5 w-3 rounded-full bg-muted-foreground/40" />
    </span>
  );
}
