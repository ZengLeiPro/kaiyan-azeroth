import { BarChart3, Briefcase, FolderKanban } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { Card, CardContent } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 9) return '早上好';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

const quickLinks = [
  {
    title: 'CRM',
    description: '客户、销售、订单',
    path: '/crm/customers',
    icon: Briefcase,
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100',
  },
  {
    title: '项目管理',
    description: '项目、工作项、工时',
    path: '/projects',
    icon: FolderKanban,
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100',
  },
  {
    title: '工作汇报',
    description: '日志、日程、记录',
    path: '/reports/dingtalk-logs',
    icon: BarChart3,
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100',
  },
];

const linkPermMap: Record<string, [string, string]> = {
  '/crm/customers': ['crm', 'customers'],
  '/projects': ['projects', 'project_list'],
  '/reports/dingtalk-logs': ['reports', 'dingtalk_logs'],
};

export function MobileDashboard() {
  const { user, hasMenuPermission } = useAuthStore();

  const visibleQuickLinks = useMemo(() => {
    return quickLinks.filter((link) => {
      const perm = linkPermMap[link.path];
      return perm ? hasMenuPermission(perm[0], perm[1], 'view') : true;
    });
  }, [hasMenuPermission]);

  return (
    <div className="space-y-4 pb-4">
      {/* Header */}
      <div className="mb-2">
        <h1 className="text-xl font-bold">
          {getGreeting()}，{user?.employee?.name || user?.username || '用户'}
        </h1>
        <p className="text-sm text-muted-foreground">Azeroth</p>
      </div>

      {/* Quick Access Cards */}
      <div className="space-y-3">
        {visibleQuickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.path} to={link.path} className="block">
              <Card className="transition-shadow active:shadow-md">
                <CardContent className="flex items-center gap-4 p-4">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${link.iconBg}`}
                  >
                    <Icon className={`h-6 w-6 ${link.iconColor}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold">{link.title}</h3>
                    <p className="text-sm text-muted-foreground">{link.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
