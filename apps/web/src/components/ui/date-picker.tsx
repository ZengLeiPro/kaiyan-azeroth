import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { Calendar as CalendarIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  date?: Date;
  onDateChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /**
   * trigger 按钮上日期显示格式（date-fns format token）。
   * 默认 `'PPP'`（中文长格式，如「2026年6月15日」），适合表单字段。
   * 筛选区/紧凑布局建议传 `'yyyy-MM-dd'`。
   */
  dateFormat?: string;
  /**
   * 覆盖 trigger 按钮的 data-testid（默认 `'date-picker-trigger'`）。
   * 用于多个 DatePicker 同屏时区分（如 range 起止）。
   */
  'data-testid'?: string;
}

export function DatePicker({
  date,
  onDateChange,
  placeholder = '选择日期',
  className,
  disabled = false,
  dateFormat = 'PPP',
  'data-testid': dataTestId = 'date-picker-trigger',
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = (selectedDate: Date | undefined) => {
    onDateChange?.(selectedDate);
    setOpen(false);
  };

  // 年份下拉范围：今年-10 ~ 今年+10（默认全开启 dropdown 体验，跨年场景友好）
  const currentYear = new Date().getFullYear();
  const startMonth = React.useMemo(() => new Date(currentYear - 10, 0, 1), [currentYear]);
  const endMonth = React.useMemo(() => new Date(currentYear + 10, 11, 31), [currentYear]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-[240px] justify-start text-left font-normal',
            !date && 'text-muted-foreground',
            className
          )}
          disabled={disabled}
          data-testid={dataTestId}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, dateFormat, { locale: zhCN }) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto min-w-[336px] p-0"
        align="start"
        data-testid="date-picker-popover"
      >
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          autoFocus
          captionLayout="dropdown"
          startMonth={startMonth}
          endMonth={endMonth}
          data-testid="date-picker-calendar"
        />
      </PopoverContent>
    </Popover>
  );
}
