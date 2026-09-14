import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('AppErrorBoundary', '页面渲染失败', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <section
          className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm"
          role="alert"
        >
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
          <h1 className="text-lg font-semibold">页面显示失败</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            系统没有正确显示当前页面。你可以重新加载，已提交的数据不会因此重复提交。
          </p>
          <Button className="mt-5" type="button" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        </section>
      </main>
    );
  }
}
