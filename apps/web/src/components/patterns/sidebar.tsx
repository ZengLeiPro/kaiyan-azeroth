import { ChevronDown, ChevronLeft, LayoutDashboard } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFilteredMenuGroups } from '@/hooks/use-filtered-menu-groups';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredGroupKey, setHoveredGroupKey] = useState<string | null>(null);
  const popoverCloseTimerRef = useRef<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([
    'crm',
    'projects',
    'reports',
    'system',
    'approval',
  ]);
  const filteredMenuGroups = useFilteredMenuGroups();

  // 在所有菜单项中找到与当前路径最精确匹配的项（最长路径优先）
  const activeItemPath = useMemo(() => {
    let bestMatch: string | null = null;
    for (const group of filteredMenuGroups) {
      for (const item of group.items) {
        const isMatch =
          location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        if (isMatch && (!bestMatch || item.path.length > bestMatch.length)) {
          bestMatch = item.path;
        }
      }
    }
    return bestMatch;
  }, [location.pathname, filteredMenuGroups]);

  // 计算当前路径对应的菜单组 key
  const activeGroupKey = useMemo(() => {
    for (const group of filteredMenuGroups) {
      if (group.items.some((item) => item.path === activeItemPath)) {
        return group.key;
      }
    }
    return null;
  }, [activeItemPath, filteredMenuGroups]);

  // 路径变化时自动展开对应菜单组
  useEffect(() => {
    if (activeGroupKey && !expandedGroups.includes(activeGroupKey)) {
      setExpandedGroups((prev) => [...prev, activeGroupKey]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖 activeGroupKey，故意省略 expandedGroups 避免循环更新
  }, [activeGroupKey]);

  useEffect(() => {
    return () => {
      if (popoverCloseTimerRef.current !== null) {
        window.clearTimeout(popoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!collapsed) {
      setHoveredGroupKey(null);
    }
  }, [collapsed]);

  const clearPopoverCloseTimer = () => {
    if (popoverCloseTimerRef.current !== null) {
      window.clearTimeout(popoverCloseTimerRef.current);
      popoverCloseTimerRef.current = null;
    }
  };

  const openGroupPopover = (key: string) => {
    if (!collapsed) return;
    clearPopoverCloseTimer();
    setHoveredGroupKey(key);
  };

  const scheduleGroupPopoverClose = () => {
    clearPopoverCloseTimer();
    popoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredGroupKey(null);
      popoverCloseTimerRef.current = null;
    }, 300);
  };

  const closeGroupPopover = () => {
    clearPopoverCloseTimer();
    setHoveredGroupKey(null);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <aside
      className={cn(
        'relative z-20 flex shrink-0 flex-col border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
      data-testid="sidebar"
      data-collapsed={collapsed}
    >
      {/* Logo */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <span className="text-sm font-bold">KY</span>
            </div>
            <span className="font-semibold">Azeroth</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="h-8 w-8 hover:bg-accent"
          data-testid="sidebar-collapse-btn"
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        </Button>
      </div>

      {/* 菜单 */}
      <nav className="flex-1 overflow-y-auto py-4">
        {/* 工作台（首页快捷入口，置顶） */}
        <div className="mb-1">
          <div className="group relative">
            <Link
              to="/"
              className={cn(
                'flex w-full items-center justify-start gap-3 rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                location.pathname === '/' && 'bg-primary/10 text-primary',
                collapsed && 'justify-center px-2'
              )}
              data-testid="menu-item-dashboard"
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1 text-left">工作台</span>}
            </Link>
            {collapsed && (
              <div
                className="group-hover:opacity-100 pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-popover px-3 py-1.5 text-sm text-popover-foreground opacity-0 shadow-md transition-opacity"
                data-testid="menu-tooltip-dashboard"
              >
                工作台
              </div>
            )}
          </div>
        </div>

        {filteredMenuGroups.map((group) => {
          const Icon = group.icon;
          const isExpanded = expandedGroups.includes(group.key);
          const isActive = group.items.some((item) => item.path === activeItemPath);
          const isPopoverOpen = collapsed && hoveredGroupKey === group.key;

          return (
            <div key={group.key} className="mb-1">
              {/* 分组标题 */}
              <div className="group relative">
                <Popover
                  open={isPopoverOpen}
                  onOpenChange={(open) => {
                    if (open) {
                      openGroupPopover(group.key);
                    } else {
                      closeGroupPopover();
                    }
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (collapsed) {
                          openGroupPopover(group.key);
                          return;
                        }
                        toggleGroup(group.key);
                      }}
                      onMouseEnter={() => openGroupPopover(group.key)}
                      onMouseLeave={scheduleGroupPopoverClose}
                      onFocus={() => openGroupPopover(group.key)}
                      onBlur={scheduleGroupPopoverClose}
                      className={cn(
                        'flex w-full items-center justify-start gap-3 px-4 py-2 text-sm font-medium transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        isActive && 'text-primary',
                        collapsed && 'justify-center px-2',
                        isPopoverOpen && 'bg-accent text-accent-foreground'
                      )}
                      data-testid={`menu-group-${group.key}`}
                      data-expanded={collapsed ? isPopoverOpen : isExpanded}
                      aria-haspopup={collapsed ? 'menu' : undefined}
                      aria-expanded={collapsed ? isPopoverOpen : isExpanded}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1 text-left">{group.name}</span>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 shrink-0 transition-transform',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </>
                      )}
                    </Button>
                  </PopoverTrigger>
                  {collapsed && (
                    <PopoverContent
                      side="right"
                      align="start"
                      sideOffset={4}
                      onMouseEnter={() => openGroupPopover(group.key)}
                      onMouseLeave={scheduleGroupPopoverClose}
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      className="w-52 p-1 before:absolute before:-left-4 before:top-0 before:h-full before:w-4 before:content-['']"
                      data-testid={`menu-popover-${group.key}`}
                    >
                      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                        {group.name}
                      </div>
                      <div className="space-y-0.5">
                        {group.items.map((item) => {
                          const ItemIcon = item.icon;
                          const isItemActive = item.path === activeItemPath;

                          return (
                            <Link
                              key={item.key}
                              to={item.path}
                              onClick={closeGroupPopover}
                              className={cn(
                                'flex items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors',
                                'hover:bg-accent hover:text-accent-foreground',
                                isItemActive && 'bg-primary/10 font-medium text-primary'
                              )}
                              data-testid={`menu-popover-item-${item.key}`}
                            >
                              <ItemIcon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{item.name}</span>
                            </Link>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  )}
                </Popover>
              </div>

              {/* 子菜单 */}
              {!collapsed && isExpanded && (
                <div className="mt-1 space-y-1 pl-11" data-testid={`menu-items-${group.key}`}>
                  {group.items.map((item) => (
                    <Link
                      key={item.key}
                      to={item.path}
                      className={cn(
                        'block rounded-md px-3 py-2 text-sm transition-colors',
                        'hover:bg-accent hover:text-accent-foreground',
                        item.path === activeItemPath && 'bg-primary/10 font-medium text-primary'
                      )}
                      data-testid={`menu-item-${item.key}`}
                    >
                      {item.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 用户面板 */}
      {/* TODO: 添加用户面板 */}
    </aside>
  );
}
