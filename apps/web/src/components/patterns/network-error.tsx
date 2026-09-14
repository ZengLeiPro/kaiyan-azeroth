import { RefreshCw, WifiOff } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useNetworkError } from '@/stores/network-error';

// 网络错误弹窗组件
export function NetworkErrorDialog() {
  const { hasError, errorMessage, canRetry, retry, dismiss } = useNetworkError();

  const handleRetry = (e: React.MouseEvent) => {
    e.preventDefault();
    retry();
  };

  return (
    <AlertDialog open={hasError} onOpenChange={(open) => !open && dismiss()}>
      <AlertDialogContent data-testid="network-error-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <WifiOff className="h-5 w-5 text-destructive" />
            网络连接失败
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="network-error-message">
            {errorMessage || '无法连接到服务器，请检查您的网络连接后重试。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismiss} data-testid="network-error-dismiss">
            关闭
          </AlertDialogCancel>
          {canRetry && (
            <AlertDialogAction onClick={handleRetry} data-testid="network-error-retry">
              <RefreshCw className="mr-2 h-4 w-4" />
              重试
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
