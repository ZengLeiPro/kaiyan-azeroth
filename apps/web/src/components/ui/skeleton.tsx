import * as React from 'react';

import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 骨架屏变体 */
  variant?: 'default' | 'circular' | 'text' | 'rectangular';
  /** 动画效果 */
  animation?: 'pulse' | 'wave' | 'none';
  /** 宽度 */
  width?: string | number;
  /** 高度 */
  height?: string | number;
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  (
    { className, variant = 'default', animation = 'pulse', width, height, style, ...props },
    ref
  ) => {
    const variantClasses = {
      default: 'rounded-md',
      circular: 'rounded-full',
      text: 'rounded h-4 w-full',
      rectangular: 'rounded-none',
    };

    const animationClasses = {
      pulse: 'animate-pulse',
      wave: 'animate-shimmer',
      none: '',
    };

    return (
      <div
        ref={ref}
        className={cn('bg-muted', variantClasses[variant], animationClasses[animation], className)}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
          ...style,
        }}
        data-testid="skeleton"
        {...props}
      />
    );
  }
);
Skeleton.displayName = 'Skeleton';

// 表格行骨架屏
interface TableRowSkeletonProps {
  columns: number;
  rows?: number;
}

const TableRowSkeleton = ({ columns, rows = 5 }: TableRowSkeletonProps) => {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b" data-testid="skeleton-table-row">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <td key={colIndex} className="p-4">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
};
TableRowSkeleton.displayName = 'TableRowSkeleton';

// 卡片骨架屏
const CardSkeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn('space-y-3 rounded-lg border bg-card p-4', className)}
      data-testid="skeleton-card"
      {...props}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
};
CardSkeleton.displayName = 'CardSkeleton';

// 列表项骨架屏
const ListItemSkeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn('flex items-center space-x-4 border-b p-4', className)}
      data-testid="skeleton-list-item"
      {...props}
    >
      <Skeleton variant="circular" className="h-10 w-10" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
};
ListItemSkeleton.displayName = 'ListItemSkeleton';

// 表单骨架屏
const FormSkeleton = ({ fields = 4 }: { fields?: number }) => {
  return (
    <div className="space-y-6" data-testid="skeleton-form">
      {Array.from({ length: fields }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <div className="flex justify-end space-x-2 pt-4">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-20" />
      </div>
    </div>
  );
};
FormSkeleton.displayName = 'FormSkeleton';

// 页面骨架屏 - 带统计卡片和表格
interface PageSkeletonProps {
  /** 统计卡片数量 */
  statsCards?: number;
  /** 表格列数 */
  tableColumns?: number;
  /** 表格行数 */
  tableRows?: number;
  /** 是否显示搜索栏 */
  showSearch?: boolean;
  /** 是否显示操作按钮 */
  showActions?: boolean;
}

const PageSkeleton = ({
  statsCards = 4,
  tableColumns = 6,
  tableRows = 5,
  showSearch = true,
  showActions = true,
}: PageSkeletonProps) => {
  return (
    <div className="space-y-6" data-testid="skeleton-page">
      {/* 页面标题和操作栏 */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        {showActions && (
          <div className="flex items-center gap-4">
            {showSearch && <Skeleton className="h-10 w-64" />}
            <Skeleton className="h-10 w-24" />
          </div>
        )}
      </div>

      {/* 统计卡片 */}
      {statsCards > 0 && (
        <div
          className={cn(
            'grid gap-4',
            statsCards === 2
              ? 'grid-cols-2'
              : statsCards === 3
                ? 'grid-cols-3'
                : statsCards >= 4
                  ? 'grid-cols-4'
                  : 'grid-cols-1'
          )}
        >
          {Array.from({ length: statsCards }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      )}

      {/* 表格 */}
      <div className="rounded-lg border bg-card">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-muted/50">
              {Array.from({ length: tableColumns }).map((_, index) => (
                <th key={index} className="p-4 text-left">
                  <Skeleton className="h-4 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <TableRowSkeleton columns={tableColumns} rows={tableRows} />
          </tbody>
        </table>
      </div>
    </div>
  );
};
PageSkeleton.displayName = 'PageSkeleton';

export { CardSkeleton, FormSkeleton, ListItemSkeleton, PageSkeleton, Skeleton, TableRowSkeleton };
