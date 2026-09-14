import { ANALYTICS_DATE_PRESETS, type AnalyticsDatePreset } from '@ky-azeroth/shared/schemas';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { formatDateToLocalDateString, parseLocalDateString } from '@/lib/date-utils';

interface AnalyticsRangeValue {
  preset: AnalyticsDatePreset;
  startDate?: string;
  endDate?: string;
}

interface Props {
  value: AnalyticsRangeValue;
  onChange: (v: AnalyticsRangeValue) => void;
  /** 是否允许 custom 自定义日期 */
  allowCustom?: boolean;
}

const PRESET_LABELS: Record<AnalyticsDatePreset, string> = {
  mtd: '本月至今',
  last30d: '近 30 天',
  qtd: '本季至今',
  ytd: '本年至今',
  custom: '自定义',
};

/**
 * 经营分析页统一日期范围选择器
 *
 * 提供 5 个预设按钮（mtd/last30d/qtd/ytd/custom），custom 时弹出
 * 起止日期输入框。所有 /analytics 子页共用。
 */
export function AnalyticsDateRangePicker({ value, onChange, allowCustom = true }: Props) {
  const presets = allowCustom
    ? ANALYTICS_DATE_PRESETS
    : ANALYTICS_DATE_PRESETS.filter((p) => p !== 'custom');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <Button
          key={p}
          size="sm"
          variant={value.preset === p ? 'default' : 'outline'}
          onClick={() => onChange({ ...value, preset: p })}
        >
          {PRESET_LABELS[p]}
        </Button>
      ))}
      {value.preset === 'custom' && (
        <div className="flex items-center gap-2">
          <DatePicker
            date={parseLocalDateString(value.startDate)}
            onDateChange={(d) =>
              onChange({ ...value, startDate: d ? formatDateToLocalDateString(d) : undefined })
            }
            placeholder="开始"
            dateFormat="yyyy-MM-dd"
            className="h-9 w-[140px]"
          />
          <span className="text-muted-foreground">~</span>
          <DatePicker
            date={parseLocalDateString(value.endDate)}
            onDateChange={(d) =>
              onChange({ ...value, endDate: d ? formatDateToLocalDateString(d) : undefined })
            }
            placeholder="结束"
            dateFormat="yyyy-MM-dd"
            className="h-9 w-[140px]"
          />
        </div>
      )}
    </div>
  );
}

export type { AnalyticsRangeValue };
