import { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { FormModeProvider } from './form-field';

export interface DrawerCreateShellProps {
  /** 提交回调；通常来自 useDrawerCreate.handleSubmit */
  onSubmit: () => Promise<boolean> | boolean;
  /** 取消回调；通常 = drawerStack.pop */
  onCancel?: () => void;
  /** 提交中状态 */
  submitting?: boolean;
  /** fields 内容；建议直接复用各实体已有的 renderXxxFields */
  children: ReactNode;
}

/**
 * 抽屉栈内创建表单的统一外壳。
 *
 * - FormModeProvider mode='create' → 让各 fields 走编辑态渲染（FormField 内部会感知）
 * - 桌面端双列网格、移动端单列堆叠（与 FormDialog 一致）
 * - 底部固定"取消 / 创建"按钮组
 */
export function DrawerCreateShell({
  onSubmit,
  onCancel,
  submitting,
  children,
}: DrawerCreateShellProps) {
  const isMobile = useIsMobile();

  const handleSubmitClick = () => {
    void onSubmit();
  };

  return (
    <FormModeProvider mode="create">
      <div className="flex flex-col gap-6">
        <div className={cn(isMobile ? 'space-y-4' : 'grid grid-cols-2 gap-x-4 gap-y-4')}>
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t pt-4">
          {onCancel && (
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button type="button" size="sm" disabled={submitting} onClick={handleSubmitClick}>
            {submitting ? '处理中...' : '创建'}
          </Button>
        </div>
      </div>
    </FormModeProvider>
  );
}
