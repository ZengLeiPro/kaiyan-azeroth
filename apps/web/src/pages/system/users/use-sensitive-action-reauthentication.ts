import axios from 'axios';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getBaseURL, getErrorMessage } from '@/lib/api';
import { serializeTokenRotation } from '@/lib/auth-token-rotation';
import { useAuthStore } from '@/stores/auth';

export function useSensitiveActionReauthentication() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const pendingAction = useRef<(() => Promise<unknown>) | null>(null);
  const applyRefreshResponse = useAuthStore((state) => state.applyRefreshResponse);

  const clearPendingAction = useCallback(() => {
    setDialogOpen(false);
    setPassword('');
    pendingAction.current = null;
  }, []);

  const request = useCallback((action: () => Promise<unknown>) => {
    pendingAction.current = action;
    setPassword('');
    setDialogOpen(true);
    return false;
  }, []);

  const confirm = useCallback(async () => {
    if (!useAuthStore.getState().refreshToken) {
      toast.error('当前会话无效，请重新登录');
      return;
    }

    setLoading(true);
    try {
      await serializeTokenRotation(
        async () => {
          const current = useAuthStore.getState();
          if (!current.refreshToken || !current.accessToken) {
            throw new Error('当前会话无效，请重新登录');
          }
          const response = await axios.post(
            `${getBaseURL()}/auth/reauthenticate`,
            { password },
            { headers: { Authorization: `Bearer ${current.accessToken}` } }
          );
          const result = applyRefreshResponse(current.refreshToken, response.data);
          if (result !== 'applied') throw new Error('重新认证响应已失效，请重试');
        },
        () => useAuthStore.persist.rehydrate()
      );

      const action = pendingAction.current;
      clearPendingAction();
      if (action) await action();
    } catch (error) {
      toast.error(getErrorMessage(error, '重新认证失败'));
    } finally {
      setLoading(false);
    }
  }, [applyRefreshResponse, clearPendingAction, password]);

  const onDialogOpenChange = useCallback(
    (open: boolean) => {
      if (loading) return;
      if (open) setDialogOpen(true);
      else clearPendingAction();
    },
    [clearPendingAction, loading]
  );

  return {
    dialogOpen,
    password,
    setPassword,
    loading,
    request,
    confirm,
    cancel: clearPendingAction,
    onDialogOpenChange,
  };
}
