import {
  ChevronDown,
  Filter,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { ExportButton, type ExportFormat } from './export-button';
import { FilterContext } from './filter-context';

export interface StandardToolbarProps {
  /** 搜索配置 */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** 自定义筛选插槽 */
  filters?: ReactNode;
  /** 自定义操作插槽 */
  actions?: ReactNode;
  /** 桌面端渲染在搜索按钮左侧的操作槽（如视图切换） */
  leadingActions?: ReactNode;
  /** 创建按钮处理器 */
  onCreate?: () => void;
  createLabel?: string;
  /** 导出按钮处理器 */
  onExport?: (format: ExportFormat) => void | Promise<void>;
  /** 导出中状态 */
  exportLoading?: boolean;
  /** 导入按钮处理器 */
  onImport?: () => void;
  /** 筛选搜索处理器（提供后渲染到右侧操作区） */
  onSearch?: () => void;
  /** 筛选重置处理器（提供后渲染到右侧操作区） */
  onReset?: () => void;
  /** 批量操作配置 */
  bulkSelection?: {
    selectedCount: number;
    onClearSelection: () => void;
    onBulkEdit?: () => void;
    onBulkDelete?: () => void;
    actions?: ReactNode;
  };
  /** 自定义类名 */
  className?: string;
}

export function StandardToolbar({
  search,
  filters,
  actions,
  leadingActions,
  onCreate,
  createLabel = '新建',
  onExport,
  exportLoading,
  onImport,
  onSearch,
  onReset,
  bulkSelection,
  className,
}: StandardToolbarProps) {
  const isMobile = useIsMobile();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // 桌面端：检测筛选区域是否溢出单行高度
  useEffect(() => {
    if (isMobile) return;
    const el = filtersRef.current;
    if (!el) return;
    const check = () => {
      // h-9 (36px) + buffer → 单行内容不超过 44px
      const overflows = el.scrollHeight > 44;
      setIsOverflowing(overflows);
      if (!overflows) setIsExpanded(false);
    };
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isMobile]);

  // 当 onSearch/onReset 由 StandardToolbar 接管时，隐藏 filters 中内嵌的 FilterActions
  const hideInlineFilterActions = Boolean(onSearch || onReset);

  if (bulkSelection && bulkSelection.selectedCount > 0) {
    return (
      <div
        className={cn(
          'flex h-[72px] items-center justify-between rounded-md border border-primary/20 bg-primary/5 px-4 text-primary animate-in fade-in slide-in-from-top-2',
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={bulkSelection.onClearSelection}
            className="h-8 w-8 p-0 hover:bg-primary/10"
          >
            <X className="h-4 w-4" />
          </Button>
          <span className="font-medium">已选择 {bulkSelection.selectedCount} 项</span>
        </div>
        <div className="flex items-center gap-2">
          {bulkSelection.actions}
          {bulkSelection.onBulkEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={bulkSelection.onBulkEdit}
              className="border-primary/20 bg-background hover:bg-primary/10"
            >
              <Pencil className="mr-2 h-4 w-4" />
              编辑
            </Button>
          )}
          {bulkSelection.onBulkDelete && (
            <Button variant="destructive" size="sm" onClick={bulkSelection.onBulkDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </Button>
          )}
        </div>
      </div>
    );
  }

  // 移动端布局
  if (isMobile) {
    return (
      <div className={cn('space-y-3', className)}>
        {(leadingActions || actions) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {leadingActions && <div className="flex items-center gap-2">{leadingActions}</div>}
            {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* 搜索框 */}
          {search && (
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={search.placeholder || '搜索...'}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                className="pl-8"
              />
            </div>
          )}

          {/* 没有搜索框时用空白填充，让按钮右对齐 */}
          {!search && <div className="flex-1" />}

          {/* 筛选按钮 */}
          {filters && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => setFilterSheetOpen(true)}
              className="h-10 w-10 shrink-0"
            >
              <Filter className="h-4 w-4" />
            </Button>
          )}

          {/* 新建按钮 */}
          {onCreate && (
            <Button size="icon" onClick={onCreate} className="h-10 w-10 shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* 筛选底部抽屉 */}
        {filters && (
          <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
            <SheetContent
              side="bottom"
              className="h-auto max-h-[80vh] overflow-y-auto rounded-t-xl"
            >
              <SheetHeader className="pb-4">
                <SheetTitle>筛选条件</SheetTitle>
              </SheetHeader>
              {/* 移动端筛选布局：垂直堆叠，组件全宽 */}
              <FilterContext.Provider value={{ closeFilterSheet: () => setFilterSheetOpen(false) }}>
                <div
                  className={cn(
                    'space-y-4 pb-4 [&_.flex-wrap]:flex-col [&_.flex-wrap]:items-stretch [&_.gap-4]:gap-3 [&_.w-24]:w-full [&_.w-28]:w-full [&_.w-32]:w-full [&_.w-36]:w-full [&_.w-40]:w-full [&_.w-44]:w-full [&_.w-48]:w-full [&_.w-56]:w-full [&_.w-64]:w-full [&_button[role=combobox]]:w-full [&_input]:w-full',
                    hideInlineFilterActions
                      ? "[&_.filter-search-btn]:hidden [&_button[title='重置筛选']]:hidden"
                      : "[&>div>.filter-search-btn]:w-full [&>div>button[title='重置筛选']]:w-full"
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onSearch?.();
                      setFilterSheetOpen(false);
                    }
                  }}
                >
                  {filters}
                </div>
              </FilterContext.Provider>
              {/* 当 onSearch/onReset 由 StandardToolbar 接管时，渲染全宽搜索/重置按钮 */}
              {hideInlineFilterActions && (
                <div className="flex gap-3 pb-4">
                  {onSearch && (
                    <Button
                      onClick={() => {
                        onSearch();
                        setFilterSheetOpen(false);
                      }}
                      className="filter-search-btn flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Search className="mr-2 h-4 w-4" />
                      搜索
                    </Button>
                  )}
                  {onReset && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        onReset();
                        setFilterSheetOpen(false);
                      }}
                      className="flex-1"
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      重置
                    </Button>
                  )}
                </div>
              )}
            </SheetContent>
          </Sheet>
        )}
      </div>
    );
  }

  // 桌面端布局（可折叠筛选栏）
  return (
    <div className={className}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div
          ref={filtersRef}
          className={cn(
            'flex flex-wrap items-center gap-2',
            !isExpanded && 'max-h-10 overflow-hidden',
            hideInlineFilterActions &&
              "[&_.filter-search-btn]:hidden [&_button[title='重置筛选']]:hidden"
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSearch?.();
            }
          }}
        >
          {search && (
            <div className="relative w-48">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={search.placeholder || '搜索...'}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                className="pl-8"
              />
            </div>
          )}
          {filters}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isOverflowing && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-9 w-9"
              title={isExpanded ? '收起筛选' : '展开筛选'}
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
              />
            </Button>
          )}
          {leadingActions}
          {onSearch && (
            <Button
              size="icon"
              onClick={onSearch}
              className="filter-search-btn bg-primary text-primary-foreground hover:bg-primary/90"
              title="搜索"
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
          {onReset && (
            <Button variant="outline" size="icon" onClick={onReset} title="重置筛选">
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          {onExport && <ExportButton onExport={onExport} loading={exportLoading} className="h-9" />}
          {onImport && (
            <Button variant="outline" size="sm" onClick={onImport} className="h-9">
              <Upload className="mr-2 h-4 w-4" />
              导入
            </Button>
          )}
          {actions}
          {onCreate && (
            <Button size="icon" onClick={onCreate} title={createLabel}>
              <Plus className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
