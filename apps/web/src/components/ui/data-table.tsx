import { AlertCircle, PackageOpen, RotateCcw } from 'lucide-react';
import { Fragment, ReactNode, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { ColumnResizeHandle } from '@/components/ui/column-resize-handle';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import {
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { type ColumnWidthSpec, useColumnWidths } from '@/hooks/use-column-widths';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

/** 统一列最小宽度（px），所有可拖拽列使用同一下限 */
const COLUMN_MIN_WIDTH = 80;
/** 默认列宽度（px），当 col.width 未提供且用户未拖拽时使用 */
const DEFAULT_COL_WIDTH = 160;
/** 无行选择列时，给首个业务列补一点左侧呼吸感，避免标题贴边 */
const LEADING_CONTENT_GUTTER_CLASS = 'pl-4';

/** 把 `string | number | undefined` 的 width 统一转为数值 px；无法解析时返回 undefined */
function coerceNumericWidth(v: string | number | undefined): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 虚拟列（行选择、操作列等）约定以 `_` 开头；这些列不参与 resize */
function isVirtualColumn(key: string): boolean {
  return key.startsWith('_');
}

/** 操作列固定在表格右侧，兼容通用 `_actions` 和历史页面里的 `actions` */
function isActionColumn(key: string): boolean {
  return key === '_actions' || key === 'actions';
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

/**
 * 列定义
 */
export interface DataTableColumn<T> {
  /** 列的唯一标识 */
  key: string;
  /** 列标题 */
  header: string | ReactNode;
  width?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  ellipsis?: boolean;
  /** 对齐方式 */
  align?: 'left' | 'center' | 'right';
  /** 是否可排序 */
  sortable?: boolean;
  /** 排序字段（如果与 key 不同） */
  sortKey?: string;
  /** 自定义渲染函数 */
  render?: (item: T, index: number) => ReactNode;
  /** 自定义单元格类名 */
  cellClassName?: string | ((item: T, index: number) => string | undefined);
  /** 访问器函数（用于获取单元格值） */
  accessor?: (item: T) => unknown;
  /**
   * 该列是否允许用户拖拽调整宽度。
   * - 缺省时：`key` 不以 `_` 开头即可 resize
   * - 显式 `false`：彻底关闭（如 `_selection` / `_actions` 虚拟列）
   */
  resizable?: boolean;
}

/**
 * 分页信息接口
 */
export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  goToPage: (page: number) => void;
  changePageSize: (pageSize: number) => void;
}

/**
 * 排序信息接口
 */
export interface DataTableSorting {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  changeSort: (field: string, order?: 'asc' | 'desc') => void;
}

/**
 * DataTable 组件属性
 */
export interface DataTableProps<T> {
  /** 数据列表 */
  data: T[];
  /** 列定义 */
  columns: DataTableColumn<T>[];
  /** 加载状态 */
  loading?: boolean;
  /** 最近一次列表请求错误；组件只展示脱敏后的通用文案 */
  error?: unknown;
  /** 错误态重试回调 */
  onRetry?: () => void;
  /** 当前数据是否为请求失败后保留的旧快照；省略时由 error + 非空数据推断 */
  stale?: boolean;
  /** 分页配置（不提供则不显示分页） */
  pagination?: DataTablePagination;
  /** 排序配置 */
  sorting?: DataTableSorting;
  /** 空状态配置 */
  emptyState?: {
    icon?: ReactNode;
    title?: string;
    description?: string;
    action?: ReactNode;
  };
  /** 加载骨架屏行数 */
  skeletonRows?: number;
  /** 行点击事件 */
  onRowClick?: (item: T, index: number) => void;
  /** 获取行的唯一 key */
  getRowKey?: (item: T, index: number) => string | number;
  /** 自定义类名 */
  className?: string;
  /** 自定义行类名 */
  rowClassName?: string | ((item: T, index: number) => string | undefined);
  /** 隐藏分页组件（当分页在外部布局层渲染时使用） */
  hidePagination?: boolean;
  /** 固定表头，表身滚动 */
  stickyHeader?: boolean;
  /** 表格最大高度（启用 stickyHeader 时生效），默认 calc(100vh - 300px) */
  maxHeight?: string;
  /**
   * 列宽持久化的命名空间 id。
   * 同路径下出现多个 DataTable 时必须传入唯一 id（如 ApprovalsPage 的 tab key），
   * 否则它们会共享同一 localStorage key 互相污染。
   */
  storageId?: string;
}

/**
 * 通用数据表格组件
 *
 * @example
 * ```tsx
 * <DataTable
 *   data={products}
 *   columns={[
 *     { key: 'name', header: '产品名称', sortable: true },
 *     { key: 'price', header: '价格', align: 'right', render: (item) => `¥${item.price}` },
 *   ]}
 *   pagination={pagination}
 *   loading={loading}
 * />
 * ```
 */
export function DataTable<T>({
  data,
  columns,
  loading = false,
  error,
  onRetry,
  stale,
  pagination,
  sorting,
  emptyState,
  skeletonRows = 5,
  onRowClick,
  getRowKey,
  className,
  rowClassName,
  hidePagination = false,
  stickyHeader = false,
  maxHeight,
  storageId,
}: DataTableProps<T>) {
  const isMobile = useIsMobile();

  /**
   * 可 resize 列的宽度规格（供 `useColumnWidths` 消费）。
   * 虚拟列（_selection/_actions）和显式 `resizable: false` 的列不参与。
   */
  const widthSpecs = useMemo<ColumnWidthSpec[]>(() => {
    return columns
      .filter((c) => c.resizable !== false && !isVirtualColumn(c.key) && !isActionColumn(c.key))
      .map((c) => ({
        key: c.key,
        defaultWidth: coerceNumericWidth(c.width),
        minWidth: COLUMN_MIN_WIDTH,
        maxWidth: coerceNumericWidth(c.maxWidth),
      }));
  }, [columns]);

  const { widths, onResize } = useColumnWidths(widthSpecs, { storageId });

  /**
   * 每一列的最终显示宽度（数值 px）。
   * 优先级：用户拖拽值 > col.width > DEFAULT_COL_WIDTH
   */
  const finalWidths = useMemo<number[]>(() => {
    return columns.map((c) => {
      if (c.resizable === false || isVirtualColumn(c.key) || isActionColumn(c.key)) {
        return coerceNumericWidth(c.width) ?? DEFAULT_COL_WIDTH;
      }
      const override = widths[c.key];
      if (override !== undefined) return override;
      return coerceNumericWidth(c.width) ?? DEFAULT_COL_WIDTH;
    });
  }, [columns, widths]);

  const hasActionColumn = useMemo(() => columns.some((c) => isActionColumn(c.key)), [columns]);
  const hasSelectionColumn = useMemo(() => columns.some((c) => c.key === '_selection'), [columns]);
  const firstContentColumnKey = useMemo(
    () => columns.find((c) => !isVirtualColumn(c.key) && !isActionColumn(c.key))?.key ?? null,
    [columns]
  );

  /** 表格最小宽度 = 各列最终宽度之和，确保横向滚动条在总宽超容器时出现 */
  const tableMinWidth = useMemo(() => {
    return finalWidths.reduce((sum, w) => sum + w, 0);
  }, [finalWidths]);

  const defaultGetRowKey = (item: T, index: number) => {
    if (getRowKey) return getRowKey(item, index);
    if (typeof item === 'object' && item !== null && 'id' in item) {
      return String((item as { id: unknown }).id);
    }
    return index;
  };

  const handleSort = (columnKey: string) => {
    if (!sorting) return;

    const column = columns.find((col) => col.key === columnKey);
    if (!column?.sortable) return;

    const sortKey = column.sortKey || columnKey;

    // 切换排序方向：null -> asc -> desc -> null
    if (sorting.sortBy === sortKey) {
      const nextOrder =
        sorting.sortOrder === 'asc' ? 'desc' : sorting.sortOrder === 'desc' ? undefined : 'asc';
      if (nextOrder) {
        sorting.changeSort(sortKey, nextOrder);
      } else {
        // 清除排序
        sorting.changeSort('', undefined);
      }
    } else {
      sorting.changeSort(sortKey, 'asc');
    }
  };

  const hasStaleData = Boolean(error && data.length > 0 && (stale ?? true));
  const showInitialLoading = loading && data.length === 0 && !error;
  const showBlockingError = Boolean(error && !hasStaleData);

  const renderCell = (item: T, column: DataTableColumn<T>, index: number) => {
    if (column.render) {
      return column.render(item, index);
    }

    if (column.accessor) {
      const value = column.accessor(item);
      return value !== null && value !== undefined ? String(value) : '-';
    }

    // 默认访问器：使用 key 访问对象属性
    if (typeof item === 'object' && item !== null && column.key in item) {
      const value = (item as Record<string, unknown>)[column.key];
      return value !== null && value !== undefined ? String(value) : '-';
    }

    return '-';
  };

  return (
    <div className={cn('flex flex-col', stickyHeader && 'h-full', className)}>
      <div
        className={cn(
          'rounded-lg border bg-card md:rounded-none md:border-x-0 md:border-b-0',
          stickyHeader && 'flex min-h-0 flex-1 flex-col'
        )}
      >
        {hasStaleData && (
          <div
            role="alert"
            className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">数据刷新失败，当前显示上次加载结果。</span>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                重试
              </Button>
            )}
          </div>
        )}
        <Table
          aria-busy={loading}
          style={{ width: '100%', minWidth: tableMinWidth, tableLayout: 'fixed' }}
          wrapperClassName={stickyHeader ? 'flex-1 overflow-auto' : undefined}
          wrapperStyle={stickyHeader && maxHeight ? { maxHeight } : undefined}
        >
          {/* colgroup 统一控制列宽；操作列存在时插入吸收列，避免表格富余宽度撑大业务列 */}
          <colgroup>
            {columns.map((column, idx) => (
              <Fragment key={column.key}>
                {hasActionColumn && isActionColumn(column.key) && <col style={{ width: 'auto' }} />}
                <col style={{ width: finalWidths[idx] }} />
              </Fragment>
            ))}
          </colgroup>
          <TableHeader sticky={stickyHeader}>
            <TableRow>
              {columns.map((column, idx) => {
                const alignClass =
                  column.align === 'right'
                    ? 'text-right'
                    : column.align === 'center'
                      ? 'text-center'
                      : '';
                const actionColumn = isActionColumn(column.key);
                const leadingContentGutterClass =
                  !hasSelectionColumn && column.key === firstContentColumnKey
                    ? LEADING_CONTENT_GUTTER_CLASS
                    : '';
                const stickyActionClass = actionColumn
                  ? 'sticky right-0 z-20 border-l bg-card shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.24)]'
                  : '';

                const canResize =
                  column.resizable !== false &&
                  !isVirtualColumn(column.key) &&
                  !actionColumn &&
                  !isMobile;
                const resizeHandle = canResize ? (
                  <ColumnResizeHandle
                    columnKey={column.key}
                    currentWidth={finalWidths[idx] ?? DEFAULT_COL_WIDTH}
                    minWidth={COLUMN_MIN_WIDTH}
                    maxWidth={coerceNumericWidth(column.maxWidth)}
                    onResize={onResize}
                  />
                ) : null;

                const headerCell =
                  column.sortable && sorting ? (
                    <SortableTableHead
                      key={column.key}
                      sortKey={column.sortKey || column.key}
                      sortState={{
                        column: sorting.sortBy || null,
                        direction: sorting.sortOrder || null,
                      }}
                      onSort={handleSort}
                      className={cn(
                        'relative',
                        alignClass,
                        leadingContentGutterClass,
                        stickyActionClass
                      )}
                    >
                      {column.header}
                      {resizeHandle}
                    </SortableTableHead>
                  ) : (
                    <TableHead
                      key={column.key}
                      className={cn(
                        'relative',
                        alignClass,
                        leadingContentGutterClass,
                        stickyActionClass
                      )}
                    >
                      {column.header}
                      {resizeHandle}
                    </TableHead>
                  );

                return (
                  <Fragment key={column.key}>
                    {hasActionColumn && actionColumn && (
                      <TableHead aria-hidden="true" className="p-0" />
                    )}
                    {headerCell}
                  </Fragment>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showInitialLoading ? (
              <TableRowSkeleton
                columns={columns.length + (hasActionColumn ? 1 : 0)}
                rows={skeletonRows}
              />
            ) : showBlockingError ? (
              <TableRow>
                <TableCell colSpan={columns.length + (hasActionColumn ? 1 : 0)} className="p-0">
                  <div role="alert">
                    <EmptyState
                      variant="error"
                      title="数据加载失败"
                      description="暂时无法获取数据，请稍后重试。"
                    >
                      {onRetry && (
                        <Button type="button" variant="outline" onClick={onRetry}>
                          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                          重试
                        </Button>
                      )}
                    </EmptyState>
                  </div>
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (hasActionColumn ? 1 : 0)} className="p-0">
                  <EmptyState
                    icon={
                      emptyState?.icon || (
                        <PackageOpen className="h-12 w-12 text-muted-foreground/50" />
                      )
                    }
                    title={emptyState?.title || '暂无数据'}
                    description={emptyState?.description || '没有找到任何记录'}
                  >
                    {emptyState?.action}
                  </EmptyState>
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, index) => {
                const rowKey = defaultGetRowKey(item, index);
                const customRowClassName =
                  typeof rowClassName === 'function' ? rowClassName(item, index) : rowClassName;
                return (
                  <TableRow
                    key={rowKey}
                    onClick={(event) => {
                      if (!isInteractiveDescendant(event.target, event.currentTarget)) {
                        onRowClick?.(item, index);
                      }
                    }}
                    className={cn(
                      onRowClick && 'cursor-pointer transition-colors hover:bg-muted/50',
                      customRowClassName
                    )}
                  >
                    {columns.map((column) => {
                      const alignClass =
                        column.align === 'right'
                          ? 'text-right'
                          : column.align === 'center'
                            ? 'text-center'
                            : '';

                      const content = renderCell(item, column, index);
                      const isEllipsis = column.ellipsis ?? true;
                      const actionColumn = isActionColumn(column.key);
                      const detailCell = Boolean(
                        onRowClick && column.key === firstContentColumnKey
                      );
                      const detailLabel =
                        typeof content === 'string' || typeof content === 'number'
                          ? `查看${content}详情`
                          : `查看第 ${index + 1} 行详情`;
                      const leadingContentGutterClass =
                        !hasSelectionColumn && column.key === firstContentColumnKey
                          ? LEADING_CONTENT_GUTTER_CLASS
                          : '';
                      const customCellClassName =
                        typeof column.cellClassName === 'function'
                          ? column.cellClassName(item, index)
                          : column.cellClassName;
                      const stickyActionClass = actionColumn
                        ? 'sticky right-0 z-10 border-l bg-card shadow-[-8px_0_8px_-8px_rgba(15,23,42,0.18)]'
                        : '';

                      const cell = (
                        <TableCell
                          key={column.key}
                          className={cn(
                            alignClass,
                            isEllipsis && 'truncate',
                            detailCell && 'relative',
                            leadingContentGutterClass,
                            customCellClassName,
                            stickyActionClass
                          )}
                        >
                          {detailCell && (
                            <button
                              type="button"
                              aria-label={detailLabel}
                              className="pointer-events-none absolute left-2 top-1/2 z-30 -translate-y-1/2 rounded-sm bg-background px-2 py-1 text-xs opacity-0 shadow-sm focus:pointer-events-auto focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
                              onClick={(event) => {
                                event.stopPropagation();
                                onRowClick?.(item, index);
                              }}
                            >
                              查看详情
                            </button>
                          )}
                          {isEllipsis ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="truncate">{content}</div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="max-w-xs break-words">{content}</div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            content
                          )}
                        </TableCell>
                      );

                      return (
                        <Fragment key={column.key}>
                          {hasActionColumn && actionColumn && (
                            <TableCell aria-hidden="true" className="p-0" />
                          )}
                          {cell}
                        </Fragment>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* 分页组件 */}
        {!hidePagination && pagination && pagination.total > 0 && (
          <Pagination
            total={pagination.total}
            page={pagination.page}
            pageSize={pagination.pageSize}
            onPageChange={pagination.goToPage}
            onPageSizeChange={pagination.changePageSize}
            showPageSizeChanger={true}
            showQuickJumper={true}
            showTotal={true}
          />
        )}
      </div>
    </div>
  );
}
