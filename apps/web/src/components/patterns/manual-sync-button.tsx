import { Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, getErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

export interface ManualSyncButtonProps {
  /** 后端接口路径，相对 `/api/v1`（例如 `/dingtalk-sync/logs`） */
  endpoint: string;
  /** 按钮文案 */
  label: string;
  /** 同步成功后回调（一般传 `crud.refresh`） */
  onSuccess?: () => void;
  /** 自定义成功 toast 文案；返回值会传给 toast.success */
  successMessage?: (data: { count: number; durationMs?: number }) => string;
  /** 默认失败 toast 文案 */
  errorFallback?: string;
  /**
   * 是否限定仅 ADMIN 可见，默认 true。
   * 后端已通过 RequirePermission 做权限拦截的场景可传 false，
   * 让所有能访问该页面的人都能看到按钮（如 SEO 看板）。
   */
  requireAdmin?: boolean;
}

/**
 * 手动同步按钮（默认 ADMIN-only）
 *
 * 点击后向后端发起 POST，期间按钮禁用并显示 loading。
 * 同步可能跑较长时间，per-request 把 axios timeout 拉到 5 分钟覆盖默认 30s。
 */
export function ManualSyncButton({
  endpoint,
  label,
  onSuccess,
  successMessage,
  errorFallback = '同步失败',
  requireAdmin = true,
}: ManualSyncButtonProps) {
  const canSync = useAuthStore((s) => s.hasMenuPermission('system', 'system_config', 'edit'));
  const [loading, setLoading] = useState(false);

  if (requireAdmin && !canSync) return null;

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { data } = await api.post<{ count: number; durationMs?: number }>(
        endpoint,
        {},
        { timeout: 300000 } // 5 分钟，覆盖 lib/api.ts 默认的 30s
      );
      const message = successMessage?.(data) ?? `同步完成，共 ${data.count} 条`;
      toast.success(message);
      onSuccess?.();
    } catch (error) {
      toast.error(getErrorMessage(error, errorFallback));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      className="h-9"
      title={label}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      {loading ? '同步中…' : label}
    </Button>
  );
}
