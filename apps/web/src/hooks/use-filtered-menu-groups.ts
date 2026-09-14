import { useMemo } from 'react';

import type { MenuGroup, MenuItem } from '@/constants/menu-config';
import { menuGroups } from '@/constants/menu-config';
import { useAuthStore } from '@/stores/auth';

export function useFilteredMenuGroups(): MenuGroup[] {
  const user = useAuthStore((s) => s.user);

  return useMemo((): MenuGroup[] => {
    if (!user) return [];
    const viewableMenusByModule = new Map<string, Set<string>>();

    user.roles.forEach((role) => {
      role.permissions?.forEach((p) => {
        if (p.view) {
          if (!viewableMenusByModule.has(p.module)) {
            viewableMenusByModule.set(p.module, new Set());
          }
          viewableMenusByModule.get(p.module)?.add(p.menu);
        }
      });
    });

    const canViewItem = (groupKey: string, item: MenuItem) => {
      const permissions = item.permissionAnyOf ?? [
        item.permission ?? { module: groupKey, menu: item.key },
      ];
      return permissions.some((permission) =>
        viewableMenusByModule.get(permission.module)?.has(permission.menu)
      );
    };

    return menuGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canViewItem(group.key, item)),
      }))
      .filter((group) => group.items.length > 0);
  }, [user]);
}
