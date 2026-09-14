import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useRegisterSW } from 'virtual:pwa-register/react';

import {
  logAppUpdateApplyFailure,
  logAppUpdateCheckFailure,
  logAppUpdateRegistrationFailure,
} from '@/lib/app-update';

// 每 10 分钟主动调用 registration.update() 探测一次新版本，作为
// visibilitychange 事件之外的兜底——覆盖“用户长时间不切走 tab”场景。
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const TOAST_ID = 'app-update-prompt';

/**
 * 全局应用更新提示组件（update-on-navigation 模式）
 *
 * 检测策略：
 * 1. 用户切回 tab（visibilitychange）时探测
 * 2. 每 10 分钟轮询探测（兜底）
 *
 * 应用策略：
 * - 检测到 waiting SW 后立即显示不自动消失的更新提示，让用户自主刷新。
 * - 若用户未点击提示而先进行 React Router 路由跳转，则通过 hard navigation
 *   消耗 waiting SW，避免继续带着旧版权限和路由配置运行。
 */
export function AppUpdatePrompt() {
  const location = useLocation();
  const initialPathRef = useRef(location.pathname);
  const consumedRef = useRef(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const triggerCheck = () => {
        registration.update().catch((err) => {
          // 网络抖动是常态，不喧哗
          logAppUpdateCheckFailure(err);
        });
      };

      const onVisibility = () => {
        if (document.visibilityState === 'visible') {
          triggerCheck();
        }
      };

      document.addEventListener('visibilitychange', onVisibility);
      const timer = window.setInterval(triggerCheck, CHECK_INTERVAL_MS);

      // SPA 长会话不会真正卸载，这里仅为热更/HMR 时清理避免泄漏。
      // vite-plugin-pwa 的 onRegisteredSW 不直接消费返回值，但保留是无害的。
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.clearInterval(timer);
      };
    },
    onRegisterError(error) {
      logAppUpdateRegistrationFailure(error);
    },
  });

  // 1) 路由跳转 → 硬跳转到目标 URL，触发浏览器 fresh navigation 让 waiting SW 接管。
  useEffect(() => {
    if (!needRefresh || consumedRef.current) return;
    // 忽略首次挂载时的 useLocation 触发。
    if (location.pathname === initialPathRef.current) return;
    consumedRef.current = true;
    // 说明：这里不用 updateServiceWorker(true) + controllerchange，而是直接
    // window.location.href = 目标路径。理由：hard navigation 会 unload
    // 当前唯一 client，waiting SW 的 activate 条件（无旧 client）自然满足，
    // 新请求自然走新 SW。这是 Workbox 官方 “update on next navigation” 做法。
    window.location.href = location.pathname + location.search + location.hash;
  }, [location, needRefresh]);

  // 2) 检测到 waiting SW → 立即提示用户刷新。
  useEffect(() => {
    if (!needRefresh) return;

    toast('系统已更新', {
      id: TOAST_ID,
      description: '检测到新版本，点击刷新加载最新内容',
      duration: Infinity,
      action: {
        label: '立即刷新',
        onClick: () => {
          setNeedRefresh(false);
          toast.dismiss(TOAST_ID);
          updateServiceWorker(true).catch((err) => {
            logAppUpdateApplyFailure(err);
            window.location.reload();
          });
        },
      },
      cancel: {
        label: '稍后',
        onClick: () => setNeedRefresh(false),
      },
    });

    return () => {
      toast.dismiss(TOAST_ID);
    };
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

  return null;
}
