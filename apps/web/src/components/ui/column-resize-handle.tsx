import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ColumnResizeHandleProps {
  columnKey: string;
  currentWidth: number;
  minWidth?: number;
  maxWidth?: number;
  onResize: (key: string, width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
  disabled?: boolean;
  /** 自定义类名（一般无需覆盖） */
  className?: string;
}

/**
 * 列宽拖拽手柄
 *
 * 设计要点：
 * - 挂在 `<th>` 的右侧，`position: absolute right-0 top-0`
 * - 悬浮/聚焦时显出 2px 视觉指示条，命中区 6px
 * - PointerEvents 兼容鼠标/触屏/笔
 * - 拖拽中通过 requestAnimationFrame 合并 move，避免每帧多次 setState
 * - `stopPropagation` 避免触发父 th 的 onClick 排序
 * - 键盘：Tab 到手柄，左右方向键 ±10px；Shift+方向键 ±20px
 * - **卸载兜底**：拖拽途中组件卸载/路由切换时，强制清理 body style 和 window 监听器
 *   （如果不清理，鼠标会卡在 col-resize、无法选中文本、拖拽事件仍会响应）
 */
export function ColumnResizeHandle({
  columnKey,
  currentWidth,
  minWidth = 60,
  maxWidth = 1200,
  onResize,
  onResizeStart,
  onResizeEnd,
  disabled,
  className,
}: ColumnResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false);
  const stateRef = React.useRef({ startX: 0, startWidth: 0, rafId: 0 });
  // 活跃的清理函数（拖拽过程中才有值）：组件卸载时强制执行
  const cleanupRef = React.useRef<(() => void) | null>(null);

  // 组件卸载兜底：中断未结束的拖拽会话
  React.useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      stateRef.current = {
        startX: e.clientX,
        startWidth: currentWidth,
        rafId: 0,
      };
      setDragging(true);
      onResizeStart?.();

      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      // 捕获 pointer，保证指针移出 handle 区域后仍能收到事件
      const target = e.currentTarget;
      const pointerId = e.pointerId;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // 某些环境（如 jsdom）可能不支持；忽略
      }

      const handleMove = (ev: PointerEvent) => {
        if (stateRef.current.rafId) {
          cancelAnimationFrame(stateRef.current.rafId);
        }
        stateRef.current.rafId = requestAnimationFrame(() => {
          const delta = ev.clientX - stateRef.current.startX;
          const next = Math.min(maxWidth, Math.max(minWidth, stateRef.current.startWidth + delta));
          onResize(columnKey, next);
        });
      };

      const cleanup = () => {
        if (stateRef.current.rafId) cancelAnimationFrame(stateRef.current.rafId);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        window.removeEventListener('blur', cleanup);
        try {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {
          // ignore
        }
        cleanupRef.current = null;
        setDragging(false);
        onResizeEnd?.();
      };

      cleanupRef.current = cleanup;
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
      // window blur（切换 tab / alt-tab）时也收尾，避免脏状态
      window.addEventListener('blur', cleanup);
    },
    [columnKey, currentWidth, minWidth, maxWidth, onResize, onResizeStart, onResizeEnd, disabled]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (disabled) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 20 : 10;
      const delta = e.key === 'ArrowRight' ? step : -step;
      const next = Math.min(maxWidth, Math.max(minWidth, currentWidth + delta));
      onResize(columnKey, next);
    },
    [columnKey, currentWidth, minWidth, maxWidth, onResize, disabled]
  );

  const handleDoubleClick = React.useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    // 双击手柄阻止排序
    e.stopPropagation();
  }, []);

  const handleClick = React.useCallback((e: React.MouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
  }, []);

  if (disabled) return null;

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`调整列 ${columnKey} 宽度`}
      tabIndex={0}
      data-dragging={dragging ? 'true' : undefined}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        // 布局：贴在 th 右边缘，高度撑满表头
        'absolute right-0 top-0 z-10 flex h-full w-1.5 items-center justify-center',
        // 光标/选择
        'cursor-col-resize select-none',
        // 默认透明，hover/focus/drag 时显现
        'opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100',
        // 2px 视觉指示条
        'after:absolute after:right-0 after:top-0 after:h-full after:w-[2px] after:bg-primary/60',
        dragging && 'opacity-100 after:bg-primary',
        className
      )}
    />
  );
}
