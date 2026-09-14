import { AlertCircle, RotateCcw } from 'lucide-react';
import { ReactNode, useCallback, useMemo } from 'react';

import { ResponsiveDataList } from '@/components/mobile/ResponsiveDataList';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DataTable,
  DataTableColumn,
  DataTablePagination,
  DataTableSorting,
} from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ColumnConfig } from '@/hooks/use-column-visibility';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { RowAction, RowActionsMenu } from './row-actions-menu';

export interface CrudTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  loading?: boolean;
  /** 最近一次列表请求错误；错误详情不会直接渲染，避免泄露服务端信息 */
  error?: unknown;
  /** 错误态重试回调 */
  onRetry?: () => void;
  /** 当前 data 是否为失败后保留的旧快照 */
  stale?: boolean;
  pagination?: DataTablePagination;
  sorting?: DataTableSorting;
  onRowClick?: (item: T, index: number) => void;
  renderMobileCard?: (item: T, index: number) => ReactNode;
  emptyState?: {
    icon?: ReactNode;
    title?: string;
    description?: string;
    action?: ReactNode;
  };
  getRowKey?: (item: T, index: number) => string | number;
  className?: string;
  rowClassName?: string | ((item: T, index: number) => string | undefined);
  rowSelection?: {
    selectedKeys: Set<string>;
    onSelectionChange: (keys: Set<string>) => void;
  };
  columnVisibility?: {
    columns: ColumnConfig[];
    onToggle: (key: string) => void;
    onShowAll: () => void;
  };
  /** 隐藏分页组件（当分页在外部布局层渲染时使用） */
  hidePagination?: boolean;
  /** 固定表头，表身滚动（默认启用） */
  stickyHeader?: boolean;
  /** 表格最大高度（启用 stickyHeader 时生效），默认 calc(100vh - 280px) */
  maxHeight?: string;
  /**
   * 行操作列表
   * 提供后会在表格最后追加"操作"列，显示下拉菜单。
   * 使用 createStandardActions() 快速创建查看/编辑/删除操作。
   */
  actions?: RowAction<T>[];
  /**
   * 列宽持久化的命名空间 id。
   * 同路径下多个 CrudTable/DataTable 时必须传入唯一 id，避免共享 localStorage 导致串表。
   */
  storageId?: string;
}

export function CrudTable<T>({
  data,
  columns,
  loading,
  error,
  onRetry,
  stale,
  pagination,
  sorting,
  onRowClick,
  renderMobileCard,
  emptyState,
  getRowKey,
  className,
  rowClassName,
  rowSelection,
  columnVisibility,
  hidePagination,
  stickyHeader = true,
  maxHeight,
  actions,
  storageId,
}: CrudTableProps<T>) {
  const isMobile = useIsMobile();

  const getKey = useCallback(
    (item: T, index: number) => {
      if (getRowKey) return String(getRowKey(item, index));
      if (typeof item === 'object' && item !== null && 'id' in item) {
        return String((item as { id: unknown }).id);
      }
      return String(index);
    },
    [getRowKey]
  );

  const visibleColumns = useMemo(() => {
    if (!columnVisibility) return columns;
    const cfg = columnVisibility.columns;
    const visibilityMap = new Map(cfg.map((c) => [c.key, c.visible]));
    // columnVisibility.columns 数组顺序 = 用户配置的列顺序（hook 已 applyOrder 过）
    // 用 index 作为排序权重；schema 里有但 cfg 里没有的列（新加列）追加到末尾
    const orderIndex = new Map(cfg.map((c, i) => [c.key, i]));
    const fallback = cfg.length;
    return columns
      .filter((col) => visibilityMap.get(col.key) !== false)
      .slice()
      .sort((a, b) => {
        const oa = orderIndex.get(a.key) ?? fallback;
        const ob = orderIndex.get(b.key) ?? fallback;
        return oa - ob;
      });
  }, [columns, columnVisibility]);

  const finalColumns = useMemo(() => {
    let cols = visibleColumns;

    // 添加行选择列
    if (rowSelection) {
      const selectionColumn: DataTableColumn<T> = {
        key: '_selection',
        width: '40px',
        minWidth: '40px',
        maxWidth: '40px',
        align: 'center',
        ellipsis: false,
        header: (
          <Checkbox
            checked={
              data.length > 0 &&
              data.every((item, index) => rowSelection.selectedKeys.has(getKey(item, index)))
            }
            onCheckedChange={(checked) => {
              if (checked) {
                const allKeys = data.map((item, index) => getKey(item, index));
                rowSelection.onSelectionChange(new Set(allKeys));
              } else {
                rowSelection.onSelectionChange(new Set());
              }
            }}
            aria-label="Select all"
          />
        ),
        render: (item, index) => {
          const key = getKey(item, index);
          return (
            <Checkbox
              checked={rowSelection.selectedKeys.has(key)}
              onCheckedChange={(checked) => {
                const newSet = new Set(rowSelection.selectedKeys);
                if (checked) {
                  newSet.add(key);
                } else {
                  newSet.delete(key);
                }
                rowSelection.onSelectionChange(newSet);
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label="Select row"
            />
          );
        },
      };

      cols = [selectionColumn, ...cols];
    }

    // 添加操作列
    if (actions && actions.length > 0) {
      const actionsColumn: DataTableColumn<T> = {
        key: '_actions',
        header: '操作',
        width: '64px',
        minWidth: '64px',
        maxWidth: '64px',
        align: 'center',
        ellipsis: false,
        render: (item) => <RowActionsMenu item={item} actions={actions} />,
      };

      cols = [...cols, actionsColumn];
    }

    return cols;
  }, [visibleColumns, rowSelection, data, getKey, actions]);

  // 只有在移动端且提供了 renderMobileCard 时才使用 ResponsiveDataList
  if (renderMobileCard && isMobile) {
    const hasStaleData = Boolean(error && data.length > 0 && (stale ?? true));

    if (error && !hasStaleData) {
      return (
        <div className={className} role="alert">
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
      );
    }

    return (
      <div className={cn('space-y-2', className)}>
        {hasStaleData && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          >
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">数据刷新失败，当前显示上次加载结果。</span>
            {onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                重试
              </Button>
            )}
          </div>
        )}
        <ResponsiveDataList
          data={data}
          columns={columns}
          loading={loading && data.length === 0}
          pagination={pagination}
          sorting={sorting}
          onRowClick={onRowClick}
          renderMobileCard={renderMobileCard}
          getRowKey={getRowKey}
          emptyState={emptyState}
          rowSelection={rowSelection}
          hidePagination={hidePagination}
        />
      </div>
    );
  }

  return (
    <div className={cn('h-full md:min-h-0 md:flex-1', className)}>
      <DataTable
        data={data}
        columns={finalColumns}
        loading={loading}
        error={error}
        onRetry={onRetry}
        stale={stale}
        pagination={pagination}
        sorting={sorting}
        onRowClick={onRowClick}
        getRowKey={getRowKey}
        rowClassName={rowClassName}
        emptyState={emptyState}
        hidePagination={hidePagination}
        stickyHeader={stickyHeader}
        maxHeight={maxHeight}
        storageId={storageId}
      />
    </div>
  );
}
