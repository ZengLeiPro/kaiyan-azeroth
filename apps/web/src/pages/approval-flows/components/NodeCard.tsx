import { X } from 'lucide-react';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface NodeCardProps {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  color: 'blue' | 'green' | 'gray' | 'orange';
  selected?: boolean;
  deletable?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
}

const colorClasses = {
  blue: {
    header: 'bg-primary',
    border: 'border-primary/20',
    selectedBorder: 'border-primary',
  },
  green: {
    header: 'bg-green-500',
    border: 'border-green-200',
    selectedBorder: 'border-green-500',
  },
  gray: {
    header: 'bg-gray-400',
    border: 'border-gray-200',
    selectedBorder: 'border-gray-400',
  },
  orange: {
    header: 'bg-orange-500',
    border: 'border-orange-200',
    selectedBorder: 'border-orange-500',
  },
};

export function NodeCard({
  title,
  subtitle,
  icon,
  color,
  selected = false,
  deletable = false,
  onClick,
  onDelete,
  children,
}: NodeCardProps) {
  const colors = colorClasses[color];
  const hasContent = !!(subtitle || children);

  return (
    <div
      className={cn(
        'w-64 rounded-lg border-2 bg-background shadow-sm transition-all',
        onClick && 'cursor-pointer hover:shadow-md',
        selected ? colors.selectedBorder : colors.border
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2',
          hasContent ? 'rounded-t-md' : 'rounded-md',
          colors.header
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-white">{icon}</span>
          <span className="text-sm font-medium text-white">{title}</span>
        </div>
        {deletable && onDelete && (
          <button
            className="text-white/80 transition-colors hover:text-white"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      {hasContent && (
        <div className="px-3 py-2">
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
          {children}
        </div>
      )}
    </div>
  );
}
