import { LayoutDashboard, Trash2, TrendingUp } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { menuGroups } from '@/constants/menu-config';
import { useAuthStore } from '@/stores/auth';

const alwaysVisibleSystemItems = [
  {
    name: '工作台',
    path: '/',
    keywords: ['首页', '工作台', 'dashboard', 'home', '概览'],
    category: '工作台',
    icon: LayoutDashboard,
  },
  {
    name: '通知中心',
    path: '/notifications',
    keywords: ['通知', 'notification', '消息'],
    category: '系统',
    icon: TrendingUp,
  },
];

const trashItem = {
  name: '回收站',
  path: '/trash',
  keywords: ['回收站', 'trash', '已删除'],
  category: '系统',
  icon: Trash2,
};

interface SearchableItem {
  name: string;
  path: string;
  keywords: string[];
  category: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const filteredItems = useMemo((): SearchableItem[] => {
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

    const menuItems = menuGroups.flatMap((group) => {
      const allowedMenus = viewableMenusByModule.get(group.key);
      if (!allowedMenus) return [];
      return group.items
        .filter((item) => {
          const permissions = item.permissionAnyOf ?? [
            item.permission ?? { module: group.key, menu: item.key },
          ];
          return permissions.some((permission) =>
            viewableMenusByModule.get(permission.module)?.has(permission.menu)
          );
        })
        .map((item) => ({
          name: item.name,
          path: item.path,
          keywords: [item.name, group.name],
          category: group.name,
          icon: item.icon,
        }));
    });

    const extras = [...alwaysVisibleSystemItems];
    if (viewableMenusByModule.get('crm')?.has('customers')) extras.push(trashItem);
    return [...extras, ...menuItems];
  }, [user]);

  // 按分类分组
  const groupedItems = filteredItems.reduce<Record<string, SearchableItem[]>>((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category]!.push(item);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={(open) => !open && onClose()}>
      <CommandInput placeholder="搜索菜单和功能..." />
      <CommandList>
        <CommandEmpty>未找到匹配的菜单或功能</CommandEmpty>
        {Object.entries(groupedItems).map(([category, items]) => (
          <CommandGroup heading={category} key={category}>
            {items.map((item) => (
              <CommandItem
                key={item.path}
                value={`${item.name} ${item.keywords.join(' ')}`}
                onSelect={() => {
                  navigate(item.path);
                  onClose();
                }}
              >
                <item.icon className="mr-2 h-4 w-4 opacity-70" />
                <span>{item.name}</span>
                <span className="ml-auto text-xs text-muted-foreground opacity-70">
                  {item.path}
                </span>
              </CommandItem>
            ))}
            <CommandSeparator />
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
