import { ComponentType, lazy } from 'react';

/**
 * Enhanced lazy load with retry mechanism for chunk load errors
 * This handles the "Failed to fetch dynamically imported module" error that occurs after deployments
 */
export function lazyLoad<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (error: unknown) {
      const err = error as Error;
      const isChunkError =
        err?.message?.includes('Failed to fetch dynamically imported module') ||
        err?.message?.includes('Importing a module script failed') ||
        err?.message?.includes('text/html');

      if (isChunkError) {
        const storageKey = `lazy_reload_${window.location.pathname}`;
        const lastReload = sessionStorage.getItem(storageKey);
        const now = Date.now();

        if (!lastReload || now - Number(lastReload) > 10000) {
          sessionStorage.setItem(storageKey, String(now));
          window.location.reload();
          // Return a never-resolving promise to keep Suspense in fallback state while reloading
          return new Promise<{ default: T }>(() => {});
        }
      }

      throw error;
    }
  });
}
