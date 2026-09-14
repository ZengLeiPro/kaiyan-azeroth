import { logger } from '@/lib/logger';

export function logAppUpdateCheckFailure(error: unknown): void {
  logger.info('AppUpdatePrompt', 'SW update check failed', error);
}

export function logAppUpdateRegistrationFailure(error: unknown): void {
  logger.error('AppUpdatePrompt', 'SW 注册失败', error);
}

export function logAppUpdateApplyFailure(error: unknown): void {
  logger.error('AppUpdatePrompt', 'SW 更新失败，回退为普通刷新', error);
}

export function getAppUpdateUrl(currentUrl: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  const returnPath = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  return `/update.html#return=${encodeURIComponent(returnPath)}`;
}

export function openAppUpdate() {
  window.location.assign(getAppUpdateUrl(window.location));
}
