import { ChevronRight, LogOut, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useFilteredMenuGroups } from '@/hooks/use-filtered-menu-groups';
import { openAppUpdate } from '@/lib/app-update';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useMobileSideMenu } from '@/stores/mobile-menu';

export function MobileSideMenu() {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { isOpen, close } = useMobileSideMenu();
  const filteredMenuGroups = useFilteredMenuGroups();

  return (
    <Sheet open={isOpen} onOpenChange={close}>
      <SheetContent side="left" className="flex h-full w-[240px] flex-col p-0">
        <SheetHeader className="border-b p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <span className="text-lg font-bold">
                {(user?.employee?.name ?? user?.username)?.charAt(0).toUpperCase() ?? 'U'}
              </span>
            </div>
            <div>
              <SheetTitle className="text-left">
                {user?.employee?.name ?? user?.username ?? '用户'}
              </SheetTitle>
              <SheetDescription className="sr-only">导航菜单</SheetDescription>
              <p className="text-sm text-muted-foreground">
                {user?.roles?.some((r) => r.code === 'ADMIN') ? '系统管理员' : '普通用户'}
              </p>
            </div>
          </div>
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto py-2">
          {filteredMenuGroups.map((group) => (
            <div key={group.key} className="mb-2">
              <div className="px-4 py-2 text-xs font-medium text-muted-foreground">
                {group.name}
              </div>
              {group.items.map((item) => {
                const isActive =
                  location.pathname === item.path || location.pathname.startsWith(item.path + '/');

                return (
                  <Link
                    key={item.key}
                    to={item.path}
                    onClick={close}
                    className={cn(
                      'flex items-center justify-between px-4 py-3',
                      'transition-colors active:bg-accent',
                      isActive && 'bg-primary/10 text-primary'
                    )}
                  >
                    <span className="text-sm">{item.name}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t p-4">
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={openAppUpdate}>
            <RefreshCw className="h-4 w-4" />
            立即检查更新
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => {
              logout();
              close();
            }}
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
