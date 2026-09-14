import { LoginForm } from '@/components/patterns/login-form';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { LoginMascots } from './components/LoginMascots';

export function LoginPage() {
  const isMobile = useIsMobile();

  return (
    <div className={cn('grid min-h-svh', !isMobile && 'lg:grid-cols-2')}>
      {/* 左侧：交互装饰角色 - 移动端隐藏 */}
      {!isMobile && (
        <div className="relative hidden overflow-hidden bg-muted lg:block">
          <LoginMascots />
          {/* 品牌文字 */}
          <div className="absolute bottom-8 left-8 z-10">
            <h2 className="text-3xl font-bold text-foreground">Azeroth</h2>
            <p className="mt-2 text-lg text-muted-foreground">企业管理系统</p>
          </div>
        </div>
      )}

      {/* 右侧：登录表单 */}
      <div className={cn('flex flex-col gap-4', isMobile ? 'p-4' : 'p-6 md:p-10')}>
        <div
          className={cn(
            'flex gap-2',
            isMobile ? 'justify-center' : 'justify-center md:justify-start'
          )}
        >
          <div className="flex items-center gap-2 font-medium">
            <div
              className={cn(
                'flex items-center justify-center rounded-md bg-primary text-primary-foreground',
                isMobile ? 'h-8 w-8' : 'h-6 w-6'
              )}
            >
              <span className={cn('font-bold', isMobile ? 'text-sm' : 'text-xs')}>KY</span>
            </div>
            <span className={isMobile ? 'text-lg' : ''}>Azeroth</span>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className={cn('w-full', isMobile ? 'max-w-sm px-4' : 'max-w-xs')}>
            {/* 移动端显示品牌信息 */}
            {isMobile && (
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-bold text-primary">Azeroth</h1>
                <p className="mt-2 text-sm text-muted-foreground">企业管理系统</p>
              </div>
            )}
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
