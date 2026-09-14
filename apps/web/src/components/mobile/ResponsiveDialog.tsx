import { ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
  // 桌面端 Dialog 的最大宽度
  desktopMaxWidth?: string;
  // 变体：dialog(居中弹窗) | drawer(右侧抽屉)
  variant?: 'dialog' | 'drawer';
  // 隐藏右上角关闭按钮（X），按钮放在 headerAction 中自行处理关闭
  hideCloseButton?: boolean;
  /**
   * 桌面端 Dialog 的 modal 属性（dialog variant 生效）：
   * - false（默认）：无 overlay 遮罩，背景可交互。适合需嵌套 Popover/Select 的业务表单 Drawer
   * - true：标准 modal，渲染 overlay 拦截背景交互+焦点陷阱。适合简单确认框（DeleteConfirm 等），
   *   防止 dropdown 关闭事件冒泡触发 outside-click 把刚打开的 dialog 立即关掉
   */
  modal?: boolean;
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerAction,
  desktopMaxWidth = 'max-w-[920px]',
  variant = 'dialog',
  hideCloseButton,
  modal = false,
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  // 移动端始终使用底部抽屉
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton={hideCloseButton}
          className="flex h-[90vh] flex-col overflow-hidden rounded-xl p-0"
        >
          <SheetHeader className="flex-shrink-0 border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <SheetTitle>{title}</SheetTitle>
              {headerAction}
            </div>
            {description ? (
              <SheetDescription>{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{title}</SheetDescription>
            )}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && (
            <SheetFooter className="flex-shrink-0 border-t bg-background px-4 py-3">
              {footer}
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  // 桌面端：drawer 变体使用右侧抽屉
  if (variant === 'drawer') {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          hideCloseButton={hideCloseButton}
          className={cn(
            'flex w-full flex-col overflow-hidden p-0',
            desktopMaxWidth || 'max-w-[920px]'
          )}
        >
          <SheetHeader className="flex-shrink-0 border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <SheetTitle>{title}</SheetTitle>
              {headerAction}
            </div>
            {description ? (
              <SheetDescription>{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{title}</SheetDescription>
            )}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">{children}</div>
          </div>
          {footer && (
            <SheetFooter className="flex-shrink-0 border-t px-6 py-4">{footer}</SheetFooter>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  // 桌面端：默认使用居中弹窗
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent className={`${desktopMaxWidth} max-h-[90vh] overflow-y-auto pb-6`}>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{title}</DialogTitle>
            {headerAction}
          </div>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
