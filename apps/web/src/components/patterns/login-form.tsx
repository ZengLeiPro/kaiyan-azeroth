import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, getErrorMessage } from '@/lib/api';
import {
  buildDingtalkLoginUrl,
  finishDingtalkLogin,
  getDingtalkCallbackFromLocation,
  isDingtalkInApp,
  requestDingtalkInAppCode,
} from '@/lib/dingtalk';
import { getSafeInternalPath } from '@/lib/safe-navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const loginSchema = z.object({
  username: z.string().min(3, '用户名至少3个字符'),
  password: z.string().min(6, '密码至少6个字符'),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

type LoginLocationState = {
  from?: string;
} | null;

function getSafeRedirectPath(value?: string | null): string {
  const path = getSafeInternalPath(value);
  if (path === '/login' || path.startsWith('/login?') || path.startsWith('/login#')) return '/';
  return path;
}

export function LoginForm({ className, ...props }: React.ComponentProps<'div'>) {
  const navigate = useNavigate();
  const location = useLocation();
  const { setTokens, setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDingtalkLoading, setIsDingtalkLoading] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: '',
      password: '',
      rememberMe: false,
    },
  });

  const rememberMe = watch('rememberMe');
  const redirectPath = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const state = location.state as LoginLocationState;
    return getSafeRedirectPath(params.get('redirect') ?? state?.from);
  }, [location.search, location.state]);

  const loginWithDingtalkCode = useCallback(
    async (
      code: string,
      source: 'in_app' | 'web',
      state?: string,
      redirectOverride?: string | null
    ) => {
      setIsDingtalkLoading(true);
      try {
        await finishDingtalkLogin(code, source, state);
        toast.success('钉钉登录成功');
        navigate(getSafeRedirectPath(redirectOverride ?? redirectPath), { replace: true });
      } catch (error) {
        toast.error(getErrorMessage(error));
      } finally {
        setIsDingtalkLoading(false);
      }
    },
    [navigate, redirectPath]
  );

  useEffect(() => {
    try {
      const callback = getDingtalkCallbackFromLocation();
      if (callback) {
        void loginWithDingtalkCode(callback.code, 'web', callback.state, callback.redirectPath);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '钉钉登录失败');
    }

    if (isDingtalkInApp()) {
      setIsDingtalkLoading(true);
      requestDingtalkInAppCode()
        .then((code) => loginWithDingtalkCode(code, 'in_app'))
        .catch((error) => {
          setIsDingtalkLoading(false);
          toast.error(error instanceof Error ? error.message : '钉钉免登失败');
        });
    }
  }, [loginWithDingtalkCode]);

  const handleDingtalkLogin = () => {
    if (isDingtalkInApp()) {
      setIsDingtalkLoading(true);
      requestDingtalkInAppCode()
        .then((code) => loginWithDingtalkCode(code, 'in_app'))
        .catch((error) => {
          setIsDingtalkLoading(false);
          toast.error(error instanceof Error ? error.message : '钉钉免登失败');
        });
      return;
    }
    window.location.href = buildDingtalkLoginUrl(redirectPath);
  };

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    try {
      const response = await api.post('/auth/login', data);
      const { accessToken, refreshToken, expiresIn, user } = response.data;

      // 传递 expiresIn 以计算 token 过期时间
      setTokens(accessToken, refreshToken, expiresIn);
      setUser(user);

      toast.success('登录成功');
      navigate(redirectPath, { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">欢迎回来</CardTitle>
          <CardDescription>请登录您的账号</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid gap-6">
              {/* 用户名 */}
              <div className="grid gap-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="请输入用户名"
                  autoComplete="username"
                  aria-invalid={Boolean(errors.username)}
                  aria-describedby={errors.username ? 'username-error' : undefined}
                  className={cn(
                    errors.username && 'border-destructive focus-visible:ring-destructive'
                  )}
                  {...register('username')}
                />
                {errors.username && (
                  <p id="username-error" className="text-sm text-destructive" role="alert">
                    {errors.username.message}
                  </p>
                )}
              </div>

              {/* 密码 */}
              <div className="grid gap-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    className={cn(
                      'pr-10',
                      errors.password && 'border-destructive focus-visible:ring-destructive'
                    )}
                    {...register('password')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPassword}
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground transition-colors hover:text-foreground" />
                    )}
                  </Button>
                </div>
                {errors.password && (
                  <p id="password-error" className="text-sm text-destructive" role="alert">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {/* 记住我 */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="rememberMe"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setValue('rememberMe', !!checked)}
                />
                <Label
                  htmlFor="rememberMe"
                  className="cursor-pointer text-sm font-normal text-muted-foreground"
                >
                  记住我（保持 30 天登录）
                </Label>
              </div>

              {/* 登录按钮 */}
              <Button type="submit" disabled={isLoading || isDingtalkLoading} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isLoading ? '登录中...' : '登录'}
              </Button>
            </div>
          </form>

          <div className="mt-4 grid gap-4">
            <div className="relative text-center text-sm text-muted-foreground">
              <span className="bg-card px-2">或</span>
            </div>
            <Button
              type="button"
              disabled={isLoading || isDingtalkLoading}
              onClick={handleDingtalkLogin}
              className="w-full bg-[#1677ff] text-white hover:bg-[#0f6bed] active:bg-[#0958d9]"
            >
              {isDingtalkLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isDingtalkLoading ? '钉钉登录中...' : '钉钉登录'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
