import { AlertCircle, RotateCcw } from 'lucide-react';
import { Component, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

interface DrawerContentErrorBoundaryProps {
  /** 实体入口身份（entry.key）：身份变化时重置错误状态，避免 B 继承 A 的失败 */
  entryKey: string;
  children: ReactNode;
}

interface DrawerContentErrorBoundaryState {
  hasError: boolean;
  /** 记录进入错误态时的 entryKey，用于身份切换时自动复位 */
  errorEntryKey: string | null;
}

/**
 * 抽屉内容的局部渲染错误隔离。
 *
 * 目标：栈顶详情渲染异常时保留应用导航与底层列表，只让当前抽屉显示可恢复错误，
 * 不再让整个 App 落入全屏 AppErrorBoundary。
 *
 * 行为契约：
 * - getDerivedStateFromError 切换错误态并记录 entryKey；
 * - entryKey 变化（从失败记录 A 打开 B）时同步复位，B 正常渲染；
 * - 「重试」将 state 完全复位触发子树重新挂载（重新走 fetch 流程）；
 * - 懒加载 renderer 的 Promise 失败仍由 EntityDetailView 自己处理（它有独立重试），
 *   本边界只隔离业务组件 render/生命周期异常。
 */
export class DrawerContentErrorBoundary extends Component<
  DrawerContentErrorBoundaryProps,
  DrawerContentErrorBoundaryState
> {
  state: DrawerContentErrorBoundaryState = { hasError: false, errorEntryKey: null };

  static getDerivedStateFromError(): Partial<DrawerContentErrorBoundaryState> | null {
    return { hasError: true, errorEntryKey: null };
  }

  // getDerivedStateFromError 无法访问 props；在 render 前用当前 entryKey 校正归属
  render(): ReactNode {
    if (this.state.hasError) {
      // 身份已切换：新 entry 的错误态归零，直接正常渲染（React 会在下次 commit 应用）
      if (this.state.errorEntryKey !== null && this.state.errorEntryKey !== this.props.entryKey) {
        this.state = { hasError: false, errorEntryKey: null };
      } else {
        return (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive"
          >
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
            <span>详情展示失败，请重试。</span>
            <Button
              type="button"
              variant="outline"
              onClick={() => this.setState({ hasError: false, errorEntryKey: null })}
            >
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
              重试
            </Button>
          </div>
        );
      }
    }
    return this.props.children;
  }

  // componentDidCatch 中补记错误归属（getDerivedStateFromError 拿不到 props）
  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    logger.error('DrawerContentErrorBoundary', this.props.entryKey, error, info?.componentStack);
    this.setState((prev) =>
      prev.hasError && prev.errorEntryKey === null
        ? { hasError: true, errorEntryKey: this.props.entryKey }
        : prev
    );
  }
}
