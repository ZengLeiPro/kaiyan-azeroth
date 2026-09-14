import { AlertTriangle, Clock } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useRateLimitError } from '@/stores/rate-limit';

// 速率限制 Toast 组件
export function RateLimitToast() {
  const { isLimited, message, retryAfter, dismiss } = useRateLimitError();

  useEffect(() => {
    if (isLimited) {
      toast.warning('请求过于频繁', {
        id: 'rate-limit-toast',
        description: (
          <div className="flex flex-col gap-1">
            <span>{message || '请稍后再试'}</span>
            {retryAfter > 0 && (
              <span className="text-xs text-muted-foreground">{retryAfter} 秒后可重试</span>
            )}
          </div>
        ),
        duration: Infinity, // keep open until dismissed or resolved
        action: {
          label: '关闭',
          onClick: dismiss,
        },
        onDismiss: dismiss,
      });
    } else {
      toast.dismiss('rate-limit-toast');
    }
  }, [isLimited, message, retryAfter, dismiss]);

  return null;
}

// 速率限制弹窗组件（用于严重限流情况）
export function RateLimitDialog() {
  const { isLimited, message, retryAfter, dismiss } = useRateLimitError();

  if (!isLimited) return null;

  return (
    <AlertDialog open={isLimited} onOpenChange={(open) => !open && dismiss()}>
      <AlertDialogContent data-testid="rate-limit-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            请求过于频繁
          </AlertDialogTitle>
          <AlertDialogDescription
            className="flex flex-col gap-2"
            data-testid="rate-limit-dialog-message"
          >
            <span>{message || '您的请求过于频繁，请稍后再试。'}</span>
            {retryAfter > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2 text-amber-700">
                <Clock className="h-4 w-4" />
                <span className="font-medium" data-testid="rate-limit-dialog-countdown">
                  {retryAfter} 秒后可重试
                </span>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss} data-testid="rate-limit-dialog-dismiss">
            我知道了
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
