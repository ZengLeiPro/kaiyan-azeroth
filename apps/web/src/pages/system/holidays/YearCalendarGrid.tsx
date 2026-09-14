import { MonthMiniCalendar } from './MonthMiniCalendar';
import type { HolidayDraftMap } from './types';

interface YearCalendarGridProps {
  year: number;
  draftMap: HolidayDraftMap;
  onCellClick: (date: Date) => void;
}

/**
 * 12 月历网格（桌面 4 列 / 平板 3 列 / 手机 2 列）
 */
export function YearCalendarGrid({ year, draftMap, onCellClick }: YearCalendarGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 12 }).map((_, monthIndex) => (
        <MonthMiniCalendar
          key={monthIndex}
          year={year}
          monthIndex={monthIndex}
          draftMap={draftMap}
          onCellClick={onCellClick}
        />
      ))}
    </div>
  );
}
