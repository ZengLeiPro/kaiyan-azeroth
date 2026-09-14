import { ArrowLeft, X } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { useBeforeCloseRunner } from './before-close-context';
import { type DrawerEntityType, useDrawerStack } from './context';
import { DrawerContentErrorBoundary } from './DrawerContentErrorBoundary';
import { getEntityRenderer } from './entity-registry';
import { EntityDetailView } from './EntityDetailView';
import { useHeaderActionsHost } from './header-actions-context';

const ENTITY_TYPE_LABEL: Record<DrawerEntityType, string> = {
  customer: '客户',
  'sale-order': '订单',
  opportunity: '商机',
  payment: '回款',
  invoice: '发票',
  'keep-record': '跟进',
  'visit-record': '拜访',
  contact: '联系人',
};

function entryDisplayTitle(entry: {
  type: DrawerEntityType;
  title?: string;
  mode?: 'detail' | 'create';
}): string {
  if (entry.title) return entry.title;
  const renderer = getEntityRenderer(entry.type);
  if (entry.mode === 'create') {
    return renderer?.defaultCreateTitle ?? `新建${ENTITY_TYPE_LABEL[entry.type] ?? '记录'}`;
  }
  return renderer?.defaultTitle ?? ENTITY_TYPE_LABEL[entry.type] ?? '详情';
}

function getSourceCustomerName(entry: { context?: Record<string, unknown> } | undefined) {
  const value = entry?.context?.sourceCustomerName;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 全局叠加抽屉宿主：单一 Sheet 实例 + 内部按 stack 状态渲染栈顶视图。
 *
 * 设计要点：
 * - 一个 Sheet（不是多 Sheet 叠加）；栈空时关闭。
 * - Header：有上一层或来源客户时显示纯左箭头 + 标题 + actions + 关闭 X；
 *   标题下方优先显示来源客户名，否则多层时显示面包屑。
 * - Header actions：栈顶 detail view 通过 useSetDrawerHeaderActions 注入（编辑/删除/保存/取消）。
 * - Before-close guard：detail view 在 edit + dirty 时注册 canProceed 回调；ESC/X/返回/遮罩
 *   外部点击都统一走 tryClose/tryPop/tryClear 包装，先询问 guard 再执行。
 * - Body：栈顶 entry.key 作为 React key 触发新 view 挂载。lastAction 决定 slide 动画方向。
 * - 桌面端右侧抽屉、移动端底部抽屉。
 */
export function DrawerStackHost() {
  const { stack, lastAction, pop, clear } = useDrawerStack();
  const { actions: headerActions } = useHeaderActionsHost();
  const runGuard = useBeforeCloseRunner();
  const isMobile = useIsMobile();

  const open = stack.length > 0;
  const top = stack[stack.length - 1];
  const prev = stack.length >= 2 ? stack[stack.length - 2] : undefined;
  const sourceCustomerName = getSourceCustomerName(top);
  const showBackButton = !!prev || !!sourceCustomerName;

  const breadcrumb = useMemo(
    () =>
      stack
        .map((e) => entryDisplayTitle(e))
        .map((t) => (t.length > 14 ? `${t.slice(0, 14)}…` : t))
        .join(' › '),
    [stack]
  );

  const tryPop = useCallback(async () => {
    if (await runGuard()) pop();
  }, [pop, runGuard]);

  const tryClear = useCallback(async () => {
    if (await runGuard()) clear();
  }, [clear, runGuard]);

  const tryBack = useCallback(async () => {
    if (prev) {
      await tryPop();
      return;
    }
    await tryClear();
  }, [prev, tryClear, tryPop]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return;
      void (async () => {
        if (await runGuard()) clear();
      })();
    },
    [clear, runGuard]
  );

  if (!top) {
    return null;
  }

  const sheetSide = isMobile ? 'bottom' : 'right';
  const sheetSizeClass = isMobile
    ? 'flex h-[90vh] flex-col overflow-hidden rounded-xl p-0'
    : 'flex w-full flex-col overflow-hidden p-0 max-w-[920px]';

  const transitionClass =
    lastAction === 'pop'
      ? 'animate-in slide-in-from-left-8 fade-in-0 duration-200'
      : 'animate-in slide-in-from-right-8 fade-in-0 duration-200';

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side={sheetSide}
        hideCloseButton
        // 透明遮罩：DrawerStackHost 一律叠在另一个抽屉/对话框之上，底层 Sheet/Dialog 已有 bg-black/50。
        overlayClassName="bg-transparent"
        className={sheetSizeClass}
        onEscapeKeyDown={(e) => {
          // 统一拦截 ESC：先调 guard，再决定 pop（栈深 > 1）或 clear（栈深 = 1）
          e.preventDefault();
          void (async () => {
            if (!(await runGuard())) return;
            if (stack.length > 1) {
              pop();
            } else {
              clear();
            }
          })();
        }}
        onInteractOutside={(e) => {
          // 点遮罩外部时也要走 guard。直接 preventDefault 阻止 Radix 默认关闭，
          // 然后用 runGuard 决定是否 clear。
          e.preventDefault();
          void tryClear();
        }}
      >
        <SheetHeader className={cn('flex-shrink-0 border-b', isMobile ? 'px-4 py-3' : 'px-6 py-4')}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {showBackButton && (
                <button
                  type="button"
                  onClick={tryBack}
                  className="flex flex-shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={sourceCustomerName ? `返回 ${sourceCustomerName}` : '返回上一层'}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <SheetTitle className="min-w-0 truncate">{entryDisplayTitle(top)}</SheetTitle>
            </div>
            {headerActions && (
              <div className="flex flex-shrink-0 items-center gap-1">{headerActions}</div>
            )}
            <button
              type="button"
              onClick={tryClear}
              className="flex flex-shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {sourceCustomerName ? (
            <SheetDescription className="truncate text-xs">{sourceCustomerName}</SheetDescription>
          ) : stack.length > 1 ? (
            <SheetDescription className="truncate text-xs">{breadcrumb}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{entryDisplayTitle(top)}</SheetDescription>
          )}
        </SheetHeader>

        <div className={cn('flex-1 overflow-y-auto', isMobile ? 'px-4 py-4' : 'px-6 py-6')}>
          <div key={top.key} className={transitionClass}>
            <DrawerContentErrorBoundary entryKey={top.key}>
              <EntityDetailView entry={top} />
            </DrawerContentErrorBoundary>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
