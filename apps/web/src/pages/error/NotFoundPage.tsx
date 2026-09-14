import { ArrowLeft, FileQuestion, Home } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export function NotFoundPage() {
  const isMobile = useIsMobile();

  return (
    <div
      className={cn(
        'flex min-h-screen items-center justify-center bg-muted/30',
        isMobile ? 'p-4' : 'p-4'
      )}
      data-testid="not-found-page"
    >
      <div className={cn('text-center', isMobile ? 'max-w-xs' : 'max-w-md')}>
        {/* 404 图标 */}
        <div
          className={cn(
            'mx-auto mb-6 flex items-center justify-center rounded-full bg-muted',
            isMobile ? 'h-24 w-24' : 'h-32 w-32'
          )}
        >
          <FileQuestion
            className={cn('text-muted-foreground', isMobile ? 'h-12 w-12' : 'h-16 w-16')}
          />
        </div>

        {/* 错误码 */}
        <div
          className={cn('mb-2 font-bold text-primary', isMobile ? 'text-5xl' : 'text-6xl')}
          data-testid="error-code"
        >
          404
        </div>

        {/* 标题 */}
        <h1
          className={cn('mb-2 font-bold', isMobile ? 'text-xl' : 'text-2xl')}
          data-testid="error-title"
        >
          页面不存在
        </h1>
        <p
          className={cn('mb-8 text-muted-foreground', isMobile ? 'text-sm' : '')}
          data-testid="error-description"
        >
          抱歉，您访问的页面不存在或已被移除。请检查 URL 是否正确，或返回首页继续浏览。
        </p>

        {/* 操作按钮 */}
        <div className={cn('flex items-center justify-center gap-4', isMobile && 'flex-col gap-3')}>
          <Button
            variant="outline"
            onClick={() => window.history.back()}
            className={cn('gap-2', isMobile && 'w-full py-3')}
            data-testid="back-btn"
          >
            <ArrowLeft className="h-4 w-4" />
            返回上一页
          </Button>
          <Button asChild className={cn('gap-2', isMobile && 'w-full py-3')} data-testid="home-btn">
            <Link to="/">
              <Home className="h-4 w-4" />
              返回首页
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
