import { Home, Mail, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

export function ForbiddenPage() {
  const isMobile = useIsMobile();

  return (
    <div
      className={cn(
        'flex min-h-screen items-center justify-center bg-muted/30',
        isMobile ? 'p-4' : 'p-4'
      )}
      data-testid="forbidden-page"
    >
      <div className={cn('text-center', isMobile ? 'max-w-xs' : 'max-w-md')}>
        {/* 403 图标 */}
        <div
          className={cn(
            'mx-auto mb-6 flex items-center justify-center rounded-full bg-destructive/10',
            isMobile ? 'h-24 w-24' : 'h-32 w-32'
          )}
        >
          <ShieldAlert className={cn('text-destructive', isMobile ? 'h-12 w-12' : 'h-16 w-16')} />
        </div>

        {/* 错误码 */}
        <div
          className={cn('mb-2 font-bold text-destructive', isMobile ? 'text-5xl' : 'text-6xl')}
          data-testid="error-code"
        >
          403
        </div>

        {/* 标题 */}
        <h1
          className={cn('mb-2 font-bold', isMobile ? 'text-xl' : 'text-2xl')}
          data-testid="error-title"
        >
          无权限访问
        </h1>
        <p
          className={cn('mb-2 text-muted-foreground', isMobile ? 'text-sm' : '')}
          data-testid="error-description"
        >
          抱歉，您没有权限访问此页面。该页面需要更高级别的访问权限。
        </p>
        <p
          className={cn('mb-8 text-muted-foreground', isMobile ? 'text-xs' : 'text-sm')}
          data-testid="contact-admin"
        >
          如需获取访问权限，请联系系统管理员。
        </p>

        {/* 操作按钮 */}
        <div className={cn('flex items-center justify-center gap-4', isMobile && 'flex-col gap-3')}>
          <a
            href="mailto:security@example.com"
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border bg-card font-medium transition-colors hover:bg-accent',
              isMobile ? 'w-full justify-center px-4 py-3 text-sm' : 'px-4 py-2 text-sm'
            )}
            data-testid="contact-btn"
          >
            <Mail className="h-4 w-4" />
            联系管理员
          </a>
          <Link
            to="/"
            className={cn(
              'inline-flex items-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground transition-colors hover:bg-primary/90',
              isMobile ? 'w-full justify-center px-4 py-3 text-sm' : 'px-4 py-2 text-sm'
            )}
            data-testid="home-btn"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
