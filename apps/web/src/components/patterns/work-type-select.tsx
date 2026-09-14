import { EFFORT_WORK_TYPE_OPTIONS } from '@ky-azeroth/shared/constants';

import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface WorkTypeSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}

export function WorkTypeSelect({
  value,
  onChange,
  placeholder = '选择工时类型',
  className,
}: WorkTypeSelectProps) {
  const options = EFFORT_WORK_TYPE_OPTIONS.map((opt) => ({
    value: opt.value as string,
    label: opt.label,
  }));

  return (
    <Select
      options={options}
      value={value}
      onChange={(v) => onChange(v ?? null)}
      placeholder={placeholder}
      className={cn('h-9', className)}
      searchable={false}
    />
  );
}
