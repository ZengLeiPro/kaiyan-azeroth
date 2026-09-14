import { BarChart3, Briefcase, FileText, FolderKanban, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { useIsMobile } from '@/hooks/use-mobile';
import { api } from '@/lib/api';
import { MobileWorkbench } from '@/pages/mobile/MobileWorkbench';
import { useAuthStore } from '@/stores/auth';

import { PendingApprovalsCard } from './components/PendingApprovalsCard';
import { SalesActionCard } from './components/SalesActionCard';

interface DashboardStats {
  customerCount: number;
  opportunityCount: number;
  saleOrderCount: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function getFormattedDate(): string {
  const now = new Date();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]}`;
}

const quickLinks = [
  {
    title: 'CRM',
    description: '客户管理、商机、合同订单、回款开票',
    path: '/crm/customers',
    icon: Briefcase,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    gradientFrom: 'from-blue-500/5',
  },
  {
    title: '项目管理',
    description: '项目列表、工作项、工时记录',
    path: '/projects',
    icon: FolderKanban,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    gradientFrom: 'from-emerald-500/5',
  },
  {
    title: '工作汇报',
    description: '钉钉日志、日程事件',
    path: '/reports/dingtalk-logs',
    icon: BarChart3,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100',
    gradientFrom: 'from-violet-500/5',
  },
];

const statsConfig = [
  {
    key: 'customerCount' as const,
    label: '客户总数',
    icon: Briefcase,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
    link: '/crm/customers',
  },
  {
    key: 'opportunityCount' as const,
    label: '商机',
    icon: BarChart3,
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-100',
    link: '/crm/opportunities',
  },
  {
    key: 'saleOrderCount' as const,
    label: '合同订单',
    icon: FileText,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
    link: '/crm/sale-orders',
  },
];

/** 统计卡片与权限模块的映射 */
const statsPermMap: Record<string, [string, string]> = {
  customerCount: ['crm', 'customers'],
  opportunityCount: ['crm', 'opportunities'],
  saleOrderCount: ['crm', 'sale_orders'],
};

/** 快捷入口与权限模块的映射 */
const linkPermMap: Record<string, [string, string]> = {
  '/crm/customers': ['crm', 'customers'],
  '/projects': ['projects', 'project_list'],
  '/reports/dingtalk-logs': ['reports', 'dingtalk_logs'],
};

function QuickAccessCards({ links }: { links: typeof quickLinks }) {
  return (
    <div className="grid h-[460px] auto-rows-fr gap-4">
      {links.map((link) => {
        const Icon = link.icon;
        return (
          <Link key={link.path} to={link.path} className="block min-h-0">
            <Card className="relative h-full cursor-pointer overflow-hidden border bg-gradient-to-br from-transparent to-transparent transition-shadow hover:shadow-md">
              <div
                className={`absolute inset-0 bg-gradient-to-br ${link.gradientFrom} to-transparent`}
              />
              <CardContent className="relative flex h-full items-center gap-4 p-5">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${link.iconBg}`}
                >
                  <Icon className={`h-6 w-6 ${link.iconColor}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{link.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function DesktopDashboard() {
  const { user, hasMenuPermission } = useAuthStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const visibleStats = useMemo(() => {
    return statsConfig.filter((item) => {
      const perm = statsPermMap[item.key];
      return perm ? hasMenuPermission(perm[0], perm[1], 'view') : true;
    });
  }, [hasMenuPermission]);

  const visibleQuickLinks = useMemo(() => {
    return quickLinks.filter((link) => {
      const perm = linkPermMap[link.path];
      return perm ? hasMenuPermission(perm[0], perm[1], 'view') : true;
    });
  }, [hasMenuPermission]);

  const canViewApproval = useMemo(
    () => hasMenuPermission('approval', 'approval_list', 'view'),
    [hasMenuPermission]
  );

  const canViewSalesActions = useMemo(
    () => hasMenuPermission('crm', 'sales_action_items', 'view'),
    [hasMenuPermission]
  );

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const response = await api.get<DashboardStats>('/dashboard/stats');
      setStats(response.data);
    } catch {
      // 静默处理错误，保持页面可用
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="h-full space-y-8 overflow-auto p-6">
      {/* Header + Stats */}
      <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.8fr)_minmax(0,2.2fr)] xl:items-stretch">
        <div className="flex min-h-28 flex-col justify-center border-l-[3px] border-brandAccent pl-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {getGreeting()}，{user?.employee?.name || user?.username || '用户'}
          </h1>
          <p className="mt-1 text-muted-foreground">{getFormattedDate()}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleStats.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.key} to={item.link} className="block min-w-0">
                <Card className="h-full cursor-pointer border transition-shadow hover:shadow-md">
                  <CardContent className="flex h-full items-center gap-4 p-5">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${item.iconBg}`}
                    >
                      <Icon className={`h-6 w-6 ${item.iconColor}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-muted-foreground">{item.label}</p>
                      {statsLoading ? (
                        <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                        <p className="truncate text-2xl font-bold tabular-nums">
                          {stats ? stats[item.key].toLocaleString() : '-'}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* 销售作战：今日作战（进攻）+ 数据待办（防御） */}
      {canViewSalesActions && (
        <div className="grid gap-6 lg:grid-cols-2">
          <SalesActionCard mode="attack" />
          <SalesActionCard mode="defense" />
        </div>
      )}

      {/* 审批与快捷入口 */}
      <div className={`grid gap-6 ${canViewApproval ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
        {canViewApproval && <PendingApprovalsCard />}
        <QuickAccessCards links={visibleQuickLinks} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileWorkbench /> : <DesktopDashboard />;
}
