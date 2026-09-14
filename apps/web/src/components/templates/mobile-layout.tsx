import { Outlet } from 'react-router-dom';

import { MobileBottomNav } from '@/components/patterns/mobile-bottom-nav';
import { MobileHeader } from '@/components/patterns/mobile-header';
import { MobileSideMenu } from '@/components/patterns/mobile-side-menu';
import { useTokenManager } from '@/hooks/use-token-manager';

export function MobileLayout() {
  useTokenManager();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <MobileHeader />

      <main className="flex-1 overflow-auto bg-muted/30 px-4 pb-4 pt-4">
        <Outlet />
      </main>

      <MobileBottomNav />

      <MobileSideMenu />
    </div>
  );
}
