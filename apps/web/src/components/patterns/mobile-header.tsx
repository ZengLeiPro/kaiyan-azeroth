import { Bell, Menu } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { menuGroups } from '@/constants/menu-config';
import { useMobileSideMenu } from '@/stores/mobile-menu';

export function MobileHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { open: openMenu } = useMobileSideMenu();

  // 根据当前路径获取页面标题
  const getCurrentTitle = (): string => {
    for (const group of menuGroups) {
      const item = group.items.find(
        (i) => location.pathname === i.path || location.pathname.startsWith(i.path + '/')
      );
      if (item) return item.name;
    }
    return 'Azeroth';
  };

  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={openMenu}
        className="h-10 w-10"
        data-testid="mobile-menu-btn"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <h1 className="text-lg font-semibold">{getCurrentTitle()}</h1>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate('/notifications')}
        className="h-10 w-10"
      >
        <Bell className="h-5 w-5" />
      </Button>
    </header>
  );
}
