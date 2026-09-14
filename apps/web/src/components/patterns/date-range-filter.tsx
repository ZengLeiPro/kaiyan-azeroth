import { ChevronDown, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDateToLocalDateString, parseLocalDateString } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

// 快捷选项类型
type QuickOption =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'
  | 'lastYear'
  | 'all';

// 快捷选项配置
const quickOptions: { key: QuickOption; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'yesterday', label: '昨天' },
  { key: 'thisWeek', label: '本周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'thisQuarter', label: '本季' },
  { key: 'lastQuarter', label: '上季' },
  { key: 'thisYear', label: '本年' },
  { key: 'lastYear', label: '上年' },
  { key: 'all', label: '全部' },
];

// 计算日期范围
function getDateRange(option: QuickOption): { start: string; end: string } {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const date = today.getDate();
  const dayOfWeek = today.getDay();

  switch (option) {
    case 'today':
      return {
        start: formatDateToLocalDateString(today),
        end: formatDateToLocalDateString(today),
      };
    case 'yesterday': {
      const yesterday = new Date(year, month, date - 1);
      return {
        start: formatDateToLocalDateString(yesterday),
        end: formatDateToLocalDateString(yesterday),
      };
    }
    case 'thisWeek': {
      // 周一为周起始
      const monday = new Date(year, month, date - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        start: formatDateToLocalDateString(monday),
        end: formatDateToLocalDateString(sunday),
      };
    }
    case 'lastWeek': {
      const lastMonday = new Date(year, month, date - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      return {
        start: formatDateToLocalDateString(lastMonday),
        end: formatDateToLocalDateString(lastSunday),
      };
    }
    case 'thisMonth': {
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      return {
        start: formatDateToLocalDateString(firstDay),
        end: formatDateToLocalDateString(lastDay),
      };
    }
    case 'lastMonth': {
      const firstDay = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0);
      return {
        start: formatDateToLocalDateString(firstDay),
        end: formatDateToLocalDateString(lastDay),
      };
    }
    case 'thisQuarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const firstDay = new Date(year, quarterStartMonth, 1);
      const lastDay = new Date(year, quarterStartMonth + 3, 0);
      return {
        start: formatDateToLocalDateString(firstDay),
        end: formatDateToLocalDateString(lastDay),
      };
    }
    case 'lastQuarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const firstDay = new Date(year, quarterStartMonth - 3, 1);
      const lastDay = new Date(year, quarterStartMonth, 0);
      return {
        start: formatDateToLocalDateString(firstDay),
        end: formatDateToLocalDateString(lastDay),
      };
    }
    case 'thisYear': {
      const firstDay = new Date(year, 0, 1);
      const lastDay = new Date(year, 11, 31);
      return {
        start: formatDateToLocalDateString(firstDay),
        end: formatDateToLocalDateString(lastDay),
      };
    }
    case 'lastYear': {
      const firstDay = new Date(year - 1, 0, 1);
      const lastDay = new Date(year - 1, 11, 31);
      return {
        start: formatDateToLocalDateString(firstDay),
        end: formatDateToLocalDateString(lastDay),
      };
    }
    case 'all':
      return { start: '', end: '' };
    default:
      return { start: '', end: '' };
  }
}

export interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onClear?: () => void;
  className?: string;
  startPlaceholder?: string;
  endPlaceholder?: string;
  label?: string;
  showQuickOptions?: boolean;
}

export function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClear,
  className,
  startPlaceholder = '开始日期',
  endPlaceholder = '结束日期',
  label,
  showQuickOptions = false,
}: DateRangeFilterProps) {
  const hasValue = startDate || endDate;

  // 处理快捷选项点击
  const handleQuickOptionClick = (option: QuickOption) => {
    const { start, end } = getDateRange(option);
    onStartDateChange(start || '');
    onEndDateChange(end || '');
  };

  // 桥接 string yyyy-MM-dd ↔ Date：外部接口保持 string（对调用方零改动），
  // 内部 DatePicker 用 Date。
  const startDateObj = parseLocalDateString(startDate);
  const endDateObj = parseLocalDateString(endDate);

  const handleStartChange = (d: Date | undefined) => {
    onStartDateChange(d ? formatDateToLocalDateString(d) : '');
  };
  const handleEndChange = (d: Date | undefined) => {
    onEndDateChange(d ? formatDateToLocalDateString(d) : '');
  };

  return (
    <div className={cn('flex items-center gap-2', className)} data-testid="date-range-filter">
      {label && <span className="whitespace-nowrap text-sm text-muted-foreground">{label}</span>}
      <div className="flex items-center gap-2">
        <DatePicker
          date={startDateObj}
          onDateChange={handleStartChange}
          placeholder={startPlaceholder}
          dateFormat="yyyy-MM-dd"
          className="h-9 w-[140px]"
          data-testid="date-filter-start"
        />
        <span className="shrink-0 px-1 text-muted-foreground">至</span>
        <DatePicker
          date={endDateObj}
          onDateChange={handleEndChange}
          placeholder={endPlaceholder}
          dateFormat="yyyy-MM-dd"
          className="h-9 w-[140px]"
          data-testid="date-filter-end"
        />

        {/* 快捷选项下拉 */}
        {showQuickOptions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1 px-2"
                title="快捷选项"
                data-testid="date-quick-options-btn"
              >
                <span className="text-xs">快捷</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-24" data-testid="date-quick-options-menu">
              <DropdownMenuLabel className="text-xs">快捷范围</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {quickOptions.map((option) => (
                <DropdownMenuItem
                  key={option.key}
                  onClick={() => handleQuickOptionClick(option.key)}
                  className="cursor-pointer text-xs"
                  data-testid={`date-quick-option-${option.key}`}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {hasValue && onClear && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-9 px-2"
            title="清除日期筛选"
            data-testid="date-filter-clear"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
