import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from './button';
import { Input } from './input';
import { Select } from './select-legacy';

// 分页选项
export const PAGE_SIZE_OPTIONS = [10, 30, 50, 100];

// 分页状态类型
export interface PaginationState {
  page: number;
  pageSize: number;
}

// 分页组件属性
export interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  showPageSizeChanger?: boolean;
  showQuickJumper?: boolean;
  showTotal?: boolean;
}

// usePagination hook
export function usePagination<T>(data: T[], initialPage = 1, initialPageSize = 100) {
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // 计算总页数
  const totalPages = useMemo(() => Math.ceil(data.length / pageSize), [data.length, pageSize]);

  // 获取当前页数据
  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return data.slice(start, end);
  }, [data, page, pageSize]);

  // 切换页码
  const goToPage = (newPage: number) => {
    const validPage = Math.max(1, Math.min(newPage, totalPages || 1));
    setPage(validPage);
  };

  // 切换每页条数
  const changePageSize = (newPageSize: number) => {
    setPageSize(newPageSize);
    // 调整页码，确保当前页有数据
    const newTotalPages = Math.ceil(data.length / newPageSize);
    if (page > newTotalPages) {
      setPage(Math.max(1, newTotalPages));
    }
  };

  // 上一页
  const prevPage = () => {
    if (page > 1) {
      setPage(page - 1);
    }
  };

  // 下一页
  const nextPage = () => {
    if (page < totalPages) {
      setPage(page + 1);
    }
  };

  // 第一页
  const firstPage = () => {
    setPage(1);
  };

  // 最后一页
  const lastPage = () => {
    setPage(totalPages || 1);
  };

  return {
    page,
    pageSize,
    totalPages,
    total: data.length,
    paginatedData,
    goToPage,
    changePageSize,
    prevPage,
    nextPage,
    firstPage,
    lastPage,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

// 分页组件
export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  showPageSizeChanger = true,
  showQuickJumper = true,
  showTotal = true,
}: PaginationProps) {
  const [jumpPage, setJumpPage] = useState('');

  const totalPages = Math.ceil(total / pageSize) || 1;
  const hasPrevPage = page > 1;
  const hasNextPage = page < totalPages;

  // 页码范围计算
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = [];
    const showEllipsis = totalPages > 7;

    if (!showEllipsis) {
      // 总页数不多，显示所有页码
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // 总页数较多，显示首尾和当前页附近的页码
      if (page <= 4) {
        // 靠近开头
        for (let i = 1; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (page >= totalPages - 3) {
        // 靠近结尾
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // 中间位置
        pages.push(1);
        pages.push('ellipsis');
        for (let i = page - 1; i <= page + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  // 处理页码跳转
  const handleJump = () => {
    const pageNum = parseInt(jumpPage, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum);
      setJumpPage('');
    }
  };

  // 处理回车跳转
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleJump();
    }
  };

  // 每页条数选项
  const pageSizeSelectOptions = pageSizeOptions.map((size) => ({
    value: String(size),
    label: String(size),
  }));

  return (
    <>
      {/* 移动端简化布局（md 以下显示） */}
      <div
        className="flex items-center justify-between px-2 py-3 md:hidden"
        data-testid="pagination"
      >
        {/* 左侧：总数和每页条数 */}
        <div className="flex items-center gap-2">
          {showTotal && (
            <span className="text-xs text-muted-foreground">
              共 <span className="font-medium text-foreground">{total}</span> 条
            </span>
          )}
          {showPageSizeChanger && (
            <Select
              value={String(pageSize)}
              onChange={(value) => onPageSizeChange(parseInt(value, 10))}
              options={pageSizeSelectOptions}
              data-testid="page-size-select"
              direction="up"
              className="h-8 w-16 text-xs"
            />
          )}
        </div>

        {/* 右侧：上一页/页码/下一页 */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrevPage}
            data-testid="pagination-prev"
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="min-w-[60px] text-center text-sm">
            {page} / {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNextPage}
            data-testid="pagination-next"
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 桌面端完整布局（md 及以上显示） */}
      <div
        className="hidden items-center justify-between px-2 py-4 md:flex"
        data-testid="pagination"
      >
        {/* 左侧：总数显示 */}
        <div className="flex items-center gap-4">
          {showTotal && (
            <span className="text-sm text-muted-foreground" data-testid="pagination-total">
              共 <span className="font-medium text-foreground">{total}</span>
            </span>
          )}

          {/* 每页条数选择 */}
          {showPageSizeChanger && (
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onChange={(value) => onPageSizeChange(parseInt(value, 10))}
                options={pageSizeSelectOptions}
                data-testid="page-size-select"
                direction="up"
              />
            </div>
          )}
        </div>

        {/* 右侧：页码和跳转 */}
        <div className="flex items-center gap-2">
          {/* 首页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={!hasPrevPage}
            data-testid="pagination-first"
            className="h-8 w-8 p-0"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          {/* 上一页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPrevPage}
            data-testid="pagination-prev"
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* 页码按钮 */}
          <div className="flex items-center gap-1">
            {getPageNumbers().map((pageNum, index) =>
              pageNum === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-2 text-muted-foreground">
                  ...
                </span>
              ) : (
                <Button
                  key={pageNum}
                  variant={pageNum === page ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onPageChange(pageNum)}
                  data-testid={`pagination-page-${pageNum}`}
                  className="h-8 w-8 p-0"
                >
                  {pageNum}
                </Button>
              )
            )}
          </div>

          {/* 下一页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNextPage}
            data-testid="pagination-next"
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* 末页 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(totalPages)}
            disabled={!hasNextPage}
            data-testid="pagination-last"
            className="h-8 w-8 p-0"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>

          {/* 页码跳转 */}
          {showQuickJumper && totalPages > 1 && (
            <div className="ml-2 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">跳至</span>
              <Input
                type="number"
                min={1}
                max={totalPages}
                value={jumpPage}
                onChange={(e) => setJumpPage(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleJump}
                placeholder=""
                className="h-8 w-16 text-center"
                data-testid="pagination-jump-input"
              />
              <span className="text-sm text-muted-foreground">页</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
