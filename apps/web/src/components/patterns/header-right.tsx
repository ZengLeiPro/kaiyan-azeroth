import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useIsMobile } from '@/hooks/use-mobile';
import { useHeaderSlotStore } from '@/stores/header-slot';

export function HeaderRight({ children }: { children: ReactNode }) {
  const slotEl = useHeaderSlotStore((s) => s.slotEl);
  const isMobile = useIsMobile();
  if (isMobile) return <>{children}</>;
  if (!slotEl) return null;
  return createPortal(children, slotEl);
}
