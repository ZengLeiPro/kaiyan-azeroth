import { ReactNode } from 'react';

import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface MobileBottomBarSpacerProps {
  children: ReactNode;
  className?: string;
  /** 是否有移动端底部固定操作栏（仅移动端生效） */
  hasBottomBar?: boolean;
}

/**
 * 移动端底部操作栏安全区域容器
 * 职责：仅负责为 MobileBottomBar 预留底部空间
 * 注意：页面的基础内边距由 MobileLayout 统一管理
 */
export function MobileBottomBarSpacer({
  children,
  className,
  hasBottomBar = false,
}: MobileBottomBarSpacerProps) {
  const isMobile = useIsMobile();

  // PC 端直接返回
  if (!isMobile) {
    return <>{children}</>;
  }

  // 移动端：如果有底部操作栏，添加额外的底部内边距（32 * 0.25rem = 8rem）
  return <div className={cn(hasBottomBar ? 'pb-32' : '', className)}>{children}</div>;
}

// 底部固定操作栏
export function MobileBottomBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'fixed left-0 right-0 border-t bg-background p-4',
        'flex items-center gap-3',
        // 适配底部导航栏的高度(4rem/64px) + 安全区域
        'bottom-[calc(4rem+env(safe-area-inset-bottom))]',
        className
      )}
    >
      {children}
    </div>
  );
}
