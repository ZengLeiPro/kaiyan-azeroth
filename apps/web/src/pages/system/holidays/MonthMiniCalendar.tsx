import { buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

import type { HolidayDraftMap } from './types';
import { isWeekend, toIso } from './types';

interface MonthMiniCalendarProps {
  year: number;
  monthIndex: number; // 0-11
  draftMap: HolidayDraftMap;
  onCellClick: (date: Date) => void;
}

/**
 * 单月迷你日历（点击日期循环切换 HOLIDAY/WORKDAY/默认）。
 * 基于 react-day-picker v9 的 modifiers + modifiersClassNames 着色。
 * 月份标题与导航走外层（border-b 月份名头），日历自身隐藏 caption + nav。
 */
export function MonthMiniCalendar({
  year,
  monthIndex,
  draftMap,
  onCellClick,
}: MonthMiniCalendarProps) {
  const monthStart = new Date(year, monthIndex, 1);

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">{monthIndex + 1} 月</div>
      <Calendar
        mode="single"
        month={monthStart}
        showOutsideDays={false}
        hideNavigation
        className="p-2 [--cell-size:2.25rem]"
        classNames={{
          // 隐藏顶部的月份标题（外层 border-b 月份名已承担）
          month_caption: 'hidden',
          nav: 'hidden',
          month: 'space-y-2 w-full',
          weekdays: 'flex w-full',
          weekday: 'flex-1 text-muted-foreground font-normal text-[0.8rem]',
          week: 'mt-1 flex w-full',
          // 拥抱 v9 默认 table 渲染：day 是外层格子，day_button 是内层按钮
          day: 'flex-1 aspect-square text-center text-sm p-0 relative focus-within:relative focus-within:z-20',
          day_button: cn(
            buttonVariants({ variant: 'ghost' }),
            'h-full w-full p-0 font-normal aria-selected:opacity-100'
          ),
        }}
        modifiers={{
          weekendDefault: (d) => isWeekend(d) && !draftMap.has(toIso(d)),
          holiday: (d) => draftMap.get(toIso(d))?.type === 'HOLIDAY',
          workdayMakeup: (d) => draftMap.get(toIso(d))?.type === 'WORKDAY',
        }}
        modifiersClassNames={{
          // 周末与法定节假日/调休补班对齐为 X/15 底 + ring X/25 的统一构造，
          // 不再用 bg-muted/60（muted 本身浅 + 无 ring，视觉饱和度低于红蓝两色）。
          // v9 modifier 应用在外层 day（td），字重通过 [&_button] 子选择器穿透到内层
          // day_button，否则会被 day_button 的 font-normal 覆盖。
          weekendDefault: cn(
            'bg-muted-foreground/15 text-muted-foreground ring-1 ring-muted-foreground/25'
          ),
          holiday: cn(
            'bg-destructive/10 text-destructive ring-1 ring-destructive/30 [&_button]:font-medium'
          ),
          workdayMakeup: cn(
            'bg-primary/10 text-primary ring-1 ring-primary/30 [&_button]:font-medium'
          ),
        }}
        onDayClick={(d, modifiers) => {
          // outside 月份的格子已被 showOutsideDays=false 隐藏；保险再判一次
          if (modifiers.outside) return;
          onCellClick(d);
        }}
      />
    </div>
  );
}
