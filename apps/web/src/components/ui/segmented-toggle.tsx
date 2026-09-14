import { type LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  badge?: number | string;
}

export interface SegmentedToggleProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  options: SegmentedToggleOption<T>[];
  className?: string;
  ariaLabel?: string;
}

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: SegmentedToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex w-max max-w-full items-center rounded-md border bg-background p-0.5',
        className
      )}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        const showBadge = opt.badge !== undefined && opt.badge !== 0 && opt.badge !== '';
        return (
          <Button
            key={opt.value}
            type="button"
            variant={selected ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className="h-7 shrink-0 gap-1 whitespace-nowrap px-2"
          >
            {Icon && <Icon className="h-4 w-4" />}
            <span>{opt.label}</span>
            {showBadge && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-[20px] px-1.5 text-xs">
                {typeof opt.badge === 'number' && opt.badge > 99 ? '99+' : opt.badge}
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
}
