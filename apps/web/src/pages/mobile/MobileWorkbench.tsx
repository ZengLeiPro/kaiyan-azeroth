import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  ATTACK_CARD_ICON,
  ATTACK_CARD_ICON_BG,
  ATTACK_CARD_ICON_FG,
  ATTACK_CATEGORIES,
  DEFENSE_CARD_ICON,
  DEFENSE_CARD_ICON_BG,
  DEFENSE_CARD_ICON_FG,
  DEFENSE_CATEGORIES,
  useAdminActionItemCount,
  useMyActionItemCount,
} from '@/components/patterns/sales-action';
import { Card, CardContent } from '@/components/ui/card';
import { useFilteredMenuGroups } from '@/hooks/use-filtered-menu-groups';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  crm: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    border: 'border-blue-100',
  },
  projects: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    border: 'border-emerald-100',
  },
  reports: {
    bg: 'bg-violet-50',
    text: 'text-violet-600',
    border: 'border-violet-100',
  },
  organization: {
    bg: 'bg-orange-50',
    text: 'text-orange-600',
    border: 'border-orange-100',
  },
  approval: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-600',
    border: 'border-cyan-100',
  },
  system: {
    bg: 'bg-zinc-50',
    text: 'text-zinc-600',
    border: 'border-zinc-100',
  },
};

const DEFAULT_STYLE = {
  bg: 'bg-gray-50',
  text: 'text-gray-600',
  border: 'border-gray-100',
};

/**
 * 移动端销售待办入口（Codex 提醒销售可能主要用手机）。
 * 首版：两卡入口 + 未处理数（普通角色 GET /my/count；ADMIN 走全量端点）。完整抽屉后置（点击进入独立列表页）。
 */
function MobileSalesActionEntries() {
  const navigate = useNavigate();
  const { hasMenuPermission, hasViewScopeAll } = useAuthStore();
  const canView = hasMenuPermission('crm', 'sales_action_items', 'view');
  const canSeeAll = hasViewScopeAll('crm', 'sales_action_items');

  const attackMyCount = useMyActionItemCount(ATTACK_CATEGORIES, !!canView && !canSeeAll);
  const defenseMyCount = useMyActionItemCount(DEFENSE_CATEGORIES, !!canView && !canSeeAll);
  const attackAdminCount = useAdminActionItemCount(ATTACK_CATEGORIES, !!canView && canSeeAll);
  const defenseAdminCount = useAdminActionItemCount(DEFENSE_CATEGORIES, !!canView && canSeeAll);
  const attackCount = canSeeAll ? attackAdminCount : attackMyCount;
  const defenseCount = canSeeAll ? defenseAdminCount : defenseMyCount;

  if (!canView) return null;

  const cards = [
    {
      key: 'attack',
      title: '今日作战',
      subtitle: '今天要打的仗',
      icon: ATTACK_CARD_ICON,
      iconBg: ATTACK_CARD_ICON_BG,
      iconFg: ATTACK_CARD_ICON_FG,
      count: attackCount.data ?? 0,
    },
    {
      key: 'defense',
      title: '数据待办',
      subtitle: '缺口与补录',
      icon: DEFENSE_CARD_ICON,
      iconBg: DEFENSE_CARD_ICON_BG,
      iconFg: DEFENSE_CARD_ICON_FG,
      count: defenseCount.data ?? 0,
    },
  ];

  return (
    <section className="mb-8 space-y-3">
      <h2 className="px-1 text-sm font-semibold text-muted-foreground">销售作战</h2>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <Card
            key={c.key}
            className="cursor-pointer border transition-shadow active:scale-[0.99]"
            onClick={() => navigate('/crm/sales-action-items')}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <div
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                  c.iconBg
                )}
              >
                <c.icon className={cn('h-5 w-5', c.iconFg)} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-foreground">{c.title}</span>
                  {c.count > 0 && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-medium text-destructive-foreground">
                      {c.count > 99 ? '99+' : c.count}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{c.subtitle}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function MobileWorkbench() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const filteredMenuGroups = useFilteredMenuGroups();

  return (
    <div className="pb-20">
      <div className="mb-8 mt-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {getGreeting()}，<span className="text-primary">{user?.username ?? '用户'}</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">准备好处理今天的工作了吗？</p>
      </div>

      <MobileSalesActionEntries />

      <div className="space-y-8">
        {filteredMenuGroups.map((group) => {
          const style = CATEGORY_STYLES[group.key] || DEFAULT_STYLE;
          const GroupIcon = group.icon;

          if (!group.items || group.items.length === 0) return null;

          return (
            <section key={group.key} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <GroupIcon className={cn('h-4 w-4', style.text)} />
                <h2 className="text-sm font-semibold text-muted-foreground">{group.name}</h2>
              </div>

              <div className="grid grid-cols-4 gap-x-2 gap-y-6">
                {group.items.map((item) => {
                  const ItemIcon = item.icon || GroupIcon;
                  return (
                    <button
                      key={item.key}
                      onClick={() => navigate(item.path)}
                      className="group flex flex-col items-center gap-2 transition-all duration-200 active:opacity-70"
                    >
                      <div
                        className={cn(
                          'group-active:scale-95 flex h-14 w-14 items-center justify-center rounded-2xl border shadow-sm transition-transform',
                          style.bg,
                          style.text,
                          style.border
                        )}
                      >
                        <ItemIcon className="h-7 w-7" strokeWidth={1.5} />
                      </div>

                      <span className="line-clamp-2 px-1 text-center text-[11px] font-medium leading-tight text-foreground/80">
                        {item.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '凌晨好';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  if (hour < 22) return '晚上好';
  return '深夜好';
}
