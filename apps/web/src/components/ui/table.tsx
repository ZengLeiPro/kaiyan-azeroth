import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

// 排序方向类型
export type SortDirection = 'asc' | 'desc' | null;

// 排序状态接口
export interface SortState {
  column: string | null;
  direction: SortDirection;
}

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** 容器的额外类名，用于控制滚动行为等 */
  wrapperClassName?: string;
  /** 容器的额外样式 */
  wrapperStyle?: React.CSSProperties;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, wrapperClassName, wrapperStyle, ...props }, ref) => (
    <div className={cn('relative w-full overflow-auto', wrapperClassName)} style={wrapperStyle}>
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
);
Table.displayName = 'Table';

interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  /** 是否固定表头 */
  sticky?: boolean;
}

const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(
  ({ className, sticky, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn('[&_tr]:border-b', sticky && 'sticky top-0 z-10 bg-background', className)}
      {...props}
    />
  )
);
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
      className
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

// 可排序表头组件的属性接口
interface SortableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  sortState: SortState;
  onSort: (key: string) => void;
}

// 可排序表头组件
const SortableTableHead = React.forwardRef<HTMLTableCellElement, SortableTableHeadProps>(
  ({ className, children, sortKey, sortState, onSort, ...props }, ref) => {
    const isActive = sortState.column === sortKey;
    const direction = isActive ? sortState.direction : null;

    const handleClick = () => {
      onSort(sortKey);
    };

    return (
      <th
        ref={ref}
        className={cn(
          'h-10 cursor-pointer select-none px-2 text-left align-middle font-medium text-muted-foreground transition-colors hover:bg-muted/50 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
          isActive && 'text-foreground',
          className
        )}
        onClick={handleClick}
        data-testid={`sort-${sortKey}`}
        {...props}
      >
        <div className="flex items-center gap-1">
          {children}
          <span className="inline-flex">
            {direction === 'asc' ? (
              <ArrowUp className="h-4 w-4" data-testid={`sort-${sortKey}-asc`} />
            ) : direction === 'desc' ? (
              <ArrowDown className="h-4 w-4" data-testid={`sort-${sortKey}-desc`} />
            ) : (
              <ArrowUpDown className="h-4 w-4 opacity-50" />
            )}
          </span>
        </div>
      </th>
    );
  }
);
SortableTableHead.displayName = 'SortableTableHead';

// 排序工具函数
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useSorting<_T = unknown>(
  initialColumn: string | null = null,
  initialDirection: SortDirection = null
) {
  const [sortState, setSortState] = React.useState<SortState>({
    column: initialColumn,
    direction: initialDirection,
  });

  const handleSort = React.useCallback((column: string) => {
    setSortState((prev) => {
      if (prev.column === column) {
        // 同一列：切换方向 (null -> asc -> desc -> null)
        if (prev.direction === null) {
          return { column, direction: 'asc' };
        } else if (prev.direction === 'asc') {
          return { column, direction: 'desc' };
        } else {
          return { column: null, direction: null };
        }
      } else {
        // 新列：从升序开始
        return { column, direction: 'asc' };
      }
    });
  }, []);

  const sortData = React.useCallback(
    <T extends Record<string, unknown>>(
      data: T[],
      getSortValue?: (item: T, column: string) => unknown
    ): T[] => {
      if (!sortState.column || !sortState.direction) {
        return data;
      }

      return [...data].sort((a, b) => {
        const valueA = getSortValue ? getSortValue(a, sortState.column!) : a[sortState.column!];
        const valueB = getSortValue ? getSortValue(b, sortState.column!) : b[sortState.column!];

        let comparison = 0;

        if (valueA === null || valueA === undefined) {
          comparison = 1;
        } else if (valueB === null || valueB === undefined) {
          comparison = -1;
        } else if (typeof valueA === 'string' && typeof valueB === 'string') {
          comparison = valueA.localeCompare(valueB, 'zh-CN');
        } else if (typeof valueA === 'number' && typeof valueB === 'number') {
          comparison = valueA - valueB;
        } else if (valueA instanceof Date && valueB instanceof Date) {
          comparison = valueA.getTime() - valueB.getTime();
        } else {
          comparison = String(valueA).localeCompare(String(valueB), 'zh-CN');
        }

        return sortState.direction === 'desc' ? -comparison : comparison;
      });
    },
    [sortState]
  );

  return { sortState, handleSort, sortData };
}

export {
  SortableTableHead,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
