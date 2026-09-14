/**
 * 销售作战卡（工作台）：进攻=今日作战 / 防御=数据待办，两卡共用本壳，由 mode 区分。
 *
 * - 取数：普通角色走 useMyActionItems；ADMIN 走 useAdminActionItems 展示全员待办。
 * - 行点击统一开 SalesActionDrawer：先看待办本身（标题/理由/playbook），再由抽屉里的「跳转关联实体」按钮穿透到商机/客户/keep。
 * - 防御类抽屉提供采纳/去补充/忽略三按钮；进攻类抽屉提供办结/转派/跳转关联实体。
 * - 空态：「数据已对齐，今日无待办」+ Inbox（区别审批卡的「暂无待审批」）。
 * - priority DESC 排序由后端保证；前端再兜底按 priority 降序。
 *
 * 卡片外壳照抄 PendingApprovalsCard（h-[460px] + 卡内滚动）。
 */
import type { ISalesActionItemResponse } from '@ky-azeroth/shared/types';
import { format } from 'date-fns';
import { ArrowRight, Inbox, Loader2, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  ATTACK_CARD_ICON,
  ATTACK_CARD_ICON_BG,
  ATTACK_CARD_ICON_FG,
  ATTACK_CATEGORIES,
  CATEGORY_ICONS,
  DEFENSE_CARD_ICON,
  DEFENSE_CARD_ICON_BG,
  DEFENSE_CARD_ICON_FG,
  DEFENSE_CATEGORIES,
  SalesActionDrawer,
  type SalesActionItemsQuery,
  useAdminActionItems,
  useMyActionItems,
} from '@/components/patterns/sales-action';
import { StatusBadge } from '@/components/patterns/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { salesActionItemCategoryMap } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

type CardMode = 'attack' | 'defense';

const CONFIG: Record<
  CardMode,
  {
    title: string;
    subtitle: string;
    icon: LucideIcon;
    iconBg: string;
    iconFg: string;
    categories: string[];
  }
> = {
  attack: {
    title: '今日作战',
    subtitle: '今天要打的仗，点击进入处理',
    icon: ATTACK_CARD_ICON,
    iconBg: ATTACK_CARD_ICON_BG,
    iconFg: ATTACK_CARD_ICON_FG,
    categories: ATTACK_CATEGORIES,
  },
  defense: {
    title: '数据待办',
    subtitle: '缺口与补录，采纳后写入 CRM',
    icon: DEFENSE_CARD_ICON,
    iconBg: DEFENSE_CARD_ICON_BG,
    iconFg: DEFENSE_CARD_ICON_FG,
    categories: DEFENSE_CATEGORIES,
  },
};

function safeFormat(iso: string | undefined | null, pattern: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : format(d, pattern);
}

export function SalesActionCard({ mode }: { mode: CardMode }) {
  const navigate = useNavigate();
  const canSeeAll = useAuthStore((s) => s.hasViewScopeAll('crm', 'sales_action_items'));
  const config = CONFIG[mode];

  const [selected, setSelected] = useState<ISalesActionItemResponse | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const queryParams = useMemo<SalesActionItemsQuery>(
    () => ({
      category: config.categories,
      status: ['pending'],
      pageSize: 100,
      sortBy: 'priority',
      sortOrder: 'desc',
    }),
    [config.categories]
  );

  // 后端 auto-expire 已在 /my 展示前重算；viewScope=ALL 走全量端点展示全员待办。
  const myQuery = useMyActionItems(queryParams, !canSeeAll);
  const adminQuery = useAdminActionItems(queryParams, canSeeAll);
  const query = canSeeAll ? adminQuery : myQuery;

  const items = useMemo(() => {
    const list = query.data?.items ?? [];
    // 兜底按 priority DESC（高=优先）
    return [...list].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [query.data]);
  const total = query.data?.total ?? items.length;
  const loading = query.isLoading;

  const handleRowClick = (item: ISalesActionItemResponse) => {
    // 进攻/防御统一打开待办抽屉；跳转关联实体由抽屉内按钮控制
    setSelected(item);
    setDrawerOpen(true);
  };

  const handleDrawerOpenChange = (open: boolean) => {
    setDrawerOpen(open);
    if (!open) setSelected(null);
  };

  return (
    <>
      <Card className="h-[460px] border">
        <CardContent className="flex h-full flex-col p-5">
          {/* 头部 */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  config.iconBg
                )}
              >
                <config.icon className={cn('h-5 w-5', config.iconFg)} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">{config.title}</h3>
                  {total > 0 && (
                    <Badge variant="destructive" className="h-5 min-w-[20px] px-1.5 text-xs">
                      {total > 99 ? '99+' : total}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{config.subtitle}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/crm/sales-action-items')}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              查看全部
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>

          {/* 列表三态 */}
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-8 text-muted-foreground">
              <Inbox className="mb-2 h-10 w-10 opacity-20" />
              <p className="text-sm">数据已对齐，今日无待办</p>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="divide-y">
                {items.map((item) => {
                  const RowIcon = CATEGORY_ICONS[item.category] ?? config.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleRowClick(item)}
                      className="flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <RowIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          <StatusBadge
                            status={item.category}
                            statusMap={salesActionItemCategoryMap}
                            className="shrink-0 text-[10px]"
                          />
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {item.reason}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {safeFormat(item.createdAt, 'MM-dd')}
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <SalesActionDrawer open={drawerOpen} onOpenChange={handleDrawerOpenChange} item={selected} />
    </>
  );
}
