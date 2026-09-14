import { ReactNode } from 'react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface MobileCardField {
  label?: string;
  value: ReactNode;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
  fullWidth?: boolean;
}

function isInteractiveDescendant(target: EventTarget | null, currentTarget: Element): boolean {
  if (!(target instanceof Element) || target === currentTarget) return false;
  const interactive = target.closest(
    'a, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable="true"]'
  );
  return Boolean(
    interactive && interactive !== currentTarget && currentTarget.contains(interactive)
  );
}

export interface GenericMobileCardProps {
  title: ReactNode;
  icon?: ReactNode;
  status?: ReactNode;
  fields?: MobileCardField[];
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  onClick?: () => void;
  testId?: string;
  /** 固定字段行数，不足时用空行填充，确保卡片高度一致 */
  fixedFieldRows?: number;
}

export function GenericMobileCard({
  title,
  icon,
  status,
  fields,
  children,
  footer,
  className,
  onClick,
  testId,
  fixedFieldRows,
}: GenericMobileCardProps) {
  // 计算需要填充的空行数
  const actualFieldCount = fields?.length || 0;
  const emptyRowsCount = fixedFieldRows ? Math.max(0, fixedFieldRows - actualFieldCount) : 0;

  return (
    <Card
      className={cn(
        'w-full overflow-hidden transition-colors',
        onClick && 'cursor-pointer hover:bg-muted/50',
        className
      )}
      onClick={(event) => {
        if (!isInteractiveDescendant(event.target, event.currentTarget)) onClick?.();
      }}
      data-testid={testId}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            {icon && <span className="flex-shrink-0 text-muted-foreground">{icon}</span>}
            {onClick ? (
              <button
                type="button"
                className="truncate rounded-sm text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={(event) => {
                  event.stopPropagation();
                  onClick();
                }}
              >
                {title}
              </button>
            ) : (
              <span className="truncate font-medium">{title}</span>
            )}
          </div>
          {status && <div className="ml-2 flex-shrink-0">{status}</div>}
        </div>
      </CardHeader>
      <CardContent className="space-y-1 overflow-hidden text-sm text-muted-foreground">
        {fields?.map((field, index) => (
          <div
            key={index}
            className={cn(
              'flex overflow-hidden',
              field.fullWidth ? 'flex-col items-start gap-1' : 'items-center justify-between',
              field.className
            )}
          >
            {field.label && (
              <span className={cn('mr-2 shrink-0 whitespace-nowrap', field.labelClassName)}>
                {field.label}
                {field.fullWidth ? '' : ':'}
              </span>
            )}
            <span
              className={cn(
                'min-w-0 flex-1',
                !field.fullWidth && 'truncate text-right',
                field.fullWidth && 'w-full whitespace-pre-wrap break-words',
                field.valueClassName
              )}
            >
              {field.value}
            </span>
          </div>
        ))}
        {/* 填充空行以保持卡片高度一致 */}
        {Array.from({ length: emptyRowsCount }).map((_, index) => (
          <div key={`empty-${index}`} className="h-5">
            &nbsp;
          </div>
        ))}
        {children}
        {footer && <div className="mt-2 text-xs">{footer}</div>}
      </CardContent>
    </Card>
  );
}
