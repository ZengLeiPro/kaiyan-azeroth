import { ReactNode } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, DataTableColumn, DataTableProps } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface ResponsiveDataListProps<T> extends Omit<DataTableProps<T>, 'columns'> {
  columns: DataTableColumn<T>[];
  renderMobileCard: (item: T, index: number) => ReactNode;
  /** @deprecated 请使用 onRowClick 代替 */
  onMobileCardClick?: (item: T) => void;
  /** 行/卡片点击事件，桌面端和移动端统一使用 */
  onRowClick?: (item: T, index: number) => void;
  rowSelection?: {
    selectedKeys: Set<string>;
    onSelectionChange: (keys: Set<string>) => void;
  };
  /** 隐藏分页组件（当分页在外部布局层渲染时使用） */
  hidePagination?: boolean;
}

export function ResponsiveDataList<T>({
  columns,
  data,
  renderMobileCard,
  onMobileCardClick,
  onRowClick,
  rowSelection,
  hidePagination,
  ...tableProps
}: ResponsiveDataListProps<T>) {
  const isMobile = useIsMobile();

  const handleItemClick = (item: T, index: number) => {
    if (onRowClick) {
      onRowClick(item, index);
    } else if (onMobileCardClick) {
      onMobileCardClick(item);
    }
  };

  const hasClickHandler = !!onRowClick || !!onMobileCardClick;

  const getKey = (item: T, index: number) => {
    if (tableProps.getRowKey) return String(tableProps.getRowKey(item, index));
    if (typeof item === 'object' && item !== null && 'id' in item) {
      return String((item as { id: unknown }).id);
    }
    return String(index);
  };

  if (isMobile) {
    const isAllSelected =
      data.length > 0 &&
      data.every((item, index) => rowSelection?.selectedKeys.has(getKey(item, index)));

    return (
      <div className={cn('flex h-full flex-col', tableProps.className)}>
        <div className="min-h-0 flex-1 space-y-3 sm:space-y-4">
          {rowSelection && data.length > 0 && (
            <div className="flex items-center gap-2 px-1">
              <Checkbox
                checked={isAllSelected}
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
              <span className="text-sm text-muted-foreground">全选本页</span>
            </div>
          )}

          {data.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">暂无数据</div>
          ) : (
            data.map((item, index) => {
              const key = getKey(item, index);
              const isSelected = rowSelection?.selectedKeys.has(key);

              return (
                <div key={key} className="flex items-start gap-3 overflow-hidden">
                  {rowSelection && (
                    <div className="shrink-0 pt-4">
                      <Checkbox
                        checked={isSelected}
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
                    </div>
                  )}
                  <div
                    className={cn('min-w-0 flex-1', hasClickHandler && 'active:opacity-80')}
                    onClick={() => hasClickHandler && handleItemClick(item, index)}
                  >
                    {renderMobileCard(item, index)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 移动端分页组件 */}
        {!hidePagination && tableProps.pagination && tableProps.pagination.total > 0 && (
          <div className="mt-4 shrink-0 rounded-lg border bg-card">
            <Pagination
              total={tableProps.pagination.total}
              page={tableProps.pagination.page}
              pageSize={tableProps.pagination.pageSize}
              onPageChange={tableProps.pagination.goToPage}
              onPageSizeChange={tableProps.pagination.changePageSize}
              showPageSizeChanger={true}
              showQuickJumper={true}
              showTotal={true}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={data}
      onRowClick={onRowClick}
      hidePagination={hidePagination}
      {...tableProps}
    />
  );
}
