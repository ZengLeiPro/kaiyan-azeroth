import { ReactNode } from 'react';

import { DataTablePagination } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

export interface StandardLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 工具栏区域（顶部） */
  toolbar?: ReactNode;
  /** 主内容区域 */
  children: ReactNode;
  /** 分页配置（固定在底部，不随内容滚动） */
  pagination?: DataTablePagination;
}

export function StandardLayout({
  toolbar,
  children,
  pagination,
  className,
  ...rest
}: StandardLayoutProps) {
  return (
    <div className={cn('flex min-h-full flex-col md:h-full md:min-h-0', className)} {...rest}>
      {toolbar && <div className="mb-4 shrink-0 md:mb-0 md:px-6 md:pb-4 md:pt-6">{toolbar}</div>}
      <div
        className={cn(
          'min-h-0 flex-1',
          'md:flex md:flex-col',
          pagination ? 'md:overflow-hidden' : 'md:overflow-auto md:px-6 md:pb-6'
        )}
      >
        {children}
      </div>
      {pagination && pagination.total > 0 && (
        <div className="mt-2 shrink-0 rounded-lg border bg-card md:mt-0 md:rounded-none md:border-x-0 md:border-b-0">
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
        </div>
      )}
    </div>
  );
}
