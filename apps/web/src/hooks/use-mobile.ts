import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768; // md 断点

// DEV: URL 参数 ?mobile=true 强制移动端模式（用于测试）
const forceMobileParam =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mobile') : null;

function subscribe(callback: () => void) {
  if (forceMobileParam !== null) {
    // 强制模式下不需要监听变化
    return () => {};
  }
  const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function getSnapshot() {
  if (forceMobileParam !== null) {
    return forceMobileParam === 'true';
  }
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
}

function getServerSnapshot() {
  return false; // SSR 默认返回桌面端
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const MOBILE_BREAKPOINT_PX = MOBILE_BREAKPOINT;
