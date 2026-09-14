import { Loader2, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

import { DeleteConfirm, type DeleteConfirmProps } from '@/components/patterns/delete-confirm';
import { FormModeProvider } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import type { DrawerDetailMode } from '@/hooks/use-drawer-entity-detail';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { ChangeLogPanel, type ChangeLogTarget } from '../change-log-panel';

export interface EntityDetailBodyProps {
  mode: DrawerDetailMode;
  loading?: boolean;
  error?: string | null;
  /** 数据是否成功加载（用于区分「正在加载」与「加载完成但 data=null」） */
  hasData: boolean;
  /** 加载失败时用于"重试"按钮 */
  onRetry?: () => void;
  /** 删除确认弹窗 props，由 useDrawerEntityDetail 提供 */
  deleteConfirmProps: DeleteConfirmProps;
  /** 字段 JSX（由各实体的 renderXxxFields 输出） */
  children: ReactNode;
  /**
   * 是否使用默认的 grid-cols-2 布局。客户详情这种自己有 Tab 结构的页面应传 false，
   * 由 children 自己控制布局。
   */
  useGridLayout?: boolean;
  /** 加载失败时的兜底文案，默认"记录不存在" */
  notFoundHint?: string;
  /** 详情底部更改记录目标。仅 view 模式展示。 */
  changeLogTarget?: ChangeLogTarget;
}

/**
 * 二级抽屉详情视图的通用外壳：处理 loading/error/空态、外层 FormModeProvider、DeleteConfirm 渲染。
 *
 * 各实体的 DetailView 只需要：构造 hook → 透传 hook 返回到本组件 → 把字段 JSX 作为 children。
 */
export function EntityDetailBody({
  mode,
  loading,
  error,
  hasData,
  onRetry,
  deleteConfirmProps,
  children,
  useGridLayout = true,
  notFoundHint = '记录不存在',
  changeLogTarget,
}: EntityDetailBodyProps) {
  const isMobile = useIsMobile();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  if (error || !hasData) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6">
        <p className="text-sm text-destructive">{error ?? notFoundHint}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            重试
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <FormModeProvider mode={mode}>
        {useGridLayout ? (
          <div className={cn(isMobile ? 'space-y-4' : 'grid grid-cols-2 gap-x-4 gap-y-4')}>
            {children}
          </div>
        ) : (
          children
        )}
      </FormModeProvider>
      {mode === 'view' ? <ChangeLogPanel target={changeLogTarget} /> : null}
      <DeleteConfirm {...deleteConfirmProps} />
    </>
  );
}
