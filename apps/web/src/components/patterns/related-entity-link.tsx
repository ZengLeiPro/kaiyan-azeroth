import type { MouseEvent, ReactNode } from 'react';

import { type DrawerEntityType, useDrawerStackOptional } from '@/components/patterns/drawer-stack';
import { cn } from '@/lib/utils';

export interface RelatedEntityLinkProps {
  entityType: DrawerEntityType;
  id?: string | null;
  label?: ReactNode;
  title?: string;
  className?: string;
}

/**
 * 详情查看态的关联实体入口。
 *
 * 在 DrawerStackProvider 内点击时叠层打开目标实体详情；缺少 id 或不在栈环境时退化为普通文本。
 */
export function RelatedEntityLink({
  entityType,
  id,
  label,
  title,
  className,
}: RelatedEntityLinkProps) {
  const drawerStack = useDrawerStackOptional();
  const hasLabel = label !== null && label !== undefined && label !== '';

  if (!hasLabel) {
    return <span className="text-muted-foreground">-</span>;
  }

  if (!id || !drawerStack) {
    return <span className={className}>{label}</span>;
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    drawerStack.push({
      type: entityType,
      id,
      title: title ?? (typeof label === 'string' ? label : undefined),
    });
  };

  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className
      )}
      onClick={handleClick}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
