import { useIsMobile } from '@/hooks/use-mobile';

import { MainLayout } from './main-layout';
import { MobileLayout } from './mobile-layout';

export function ResponsiveLayout() {
  const isMobile = useIsMobile();

  return isMobile ? <MobileLayout /> : <MainLayout />;
}
