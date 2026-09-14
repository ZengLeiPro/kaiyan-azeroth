import { Factory, Home, Package, Store, User } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { cn } from '@/lib/utils';

const navItems = [
  { icon: Home, label: '工作台', path: '/' },
  { icon: Store, label: '门店', path: '/store-order-request' },
  { icon: Factory, label: '生产', path: '/production-plans' },
  { icon: Package, label: '库存', path: '/inventory' },
  { icon: User, label: '我的', path: '/profile' },
];

export function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="flex h-16 items-center justify-around border-t bg-card px-2 pb-safe">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          location.pathname === item.path ||
          (item.path !== '/' && location.pathname.startsWith(item.path));

        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 py-2',
              'transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
            data-testid={`nav-${item.label}`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-xs">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
