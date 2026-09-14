import { ChevronDown, Info, LogOut, RefreshCw, Search, Settings, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { NotificationCenter } from '@/components/patterns/notification-center';
import { ThemeToggle } from '@/components/patterns/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { openAppUpdate } from '@/lib/app-update';
import { useAuthStore } from '@/stores/auth';
import { useHeaderSlotStore } from '@/stores/header-slot';

import { CommandPalette } from './command-palette';

// 页面元信息映射（name + description）
const pageMetaMap: Record<string, { name: string; description?: string }> = {
  '/': { name: '工作台' },
  '/dashboard': { name: '数据概览' },
  '/profile': { name: '个人设置' },
  // CRM
  '/crm/sales-action-items': {
    name: '销售待办',
    description: '进攻信号与数据缺口，采纳后写入 CRM 跟进记录',
  },
  '/crm/customers': { name: '客户', description: '管理客户信息和跟进状态' },
  '/crm/contacts': { name: '联系人', description: '管理客户联系人信息' },
  '/crm/opportunities': { name: '商机', description: '管理商机进展' },
  '/crm/sale-orders': { name: '合同订单', description: '管理合同订单和回款信息' },
  '/crm/payments': { name: '回款', description: '管理销售回款记录' },
  '/crm/invoices': { name: '开票', description: '管理发票申请与开具' },
  '/crm/keep-records': { name: '跟进记录', description: '管理客户跟进记录' },
  '/crm/visit-records': { name: '拜访签到', description: '管理客户拜访签到记录' },
  '/crm/products': { name: '产品', description: '管理 CRM 产品信息和价格' },
  // 项目
  '/projects': { name: '项目', description: '管理项目基本信息' },
  '/projects/tickets': { name: '项目工单', description: '管理项目工单与执行状态' },
  '/projects/effort-records': { name: '工时记录', description: '管理项目的工时登记' },
  '/projects/effort-stats': { name: '工时统计', description: '查看团队工时分布与项目耗时统计' },
  // 工作汇报
  '/reports/work-dailies': { name: 'CRM 工作日报', description: '管理销售团队工作日报' },
  '/reports/dingtalk-logs': { name: '钉钉日志', description: '查看从钉钉同步的工作日志' },
  '/reports/calendar-events': { name: '日程事件', description: '查看从钉钉同步的日程事件' },
  '/reports/employee-leaves': { name: '员工离职记录', description: '查看从钉钉同步的员工离职信息' },
  // 组织架构
  '/organization/employees': { name: '员工', description: '管理组织员工信息' },
  '/organization/departments': { name: '部门' },
  // 审批
  '/approval/list': { name: '审批中心' },
  '/approval/settings': { name: '审批设置', description: '管理各业务模块的审批流程启用状态' },
  '/approval/flows': { name: '审批流程配置', description: '配置各事件类型的审批流程' },
  // 财务
  '/finance/payroll': { name: '员工薪资', description: '查看和维护员工历史薪资台账' },
  '/finance/ledger': {
    name: '账务',
    description: '综合视图：公司流水 / 个人流水 / 损益表（顶部 tab 切换）',
  },
  '/finance/accounts': { name: '账户字典', description: '维护财务账户与余额快照字典' },
  '/finance/subjects': { name: '科目字典', description: '维护损益科目树和财务分类' },
  '/finance/import': { name: '钉钉导入', description: '预览、对账并提交钉钉财务流水迁移' },
  '/analytics/web': { name: '官网增长驾驶舱', description: '站点获客、内容与转化决策台' },
  // 系统
  '/system/users': { name: '用户', description: '管理系统用户账号和角色分配' },
  '/system/roles': { name: '角色权限', description: '管理系统角色和权限配置' },
  '/system/params': { name: '系统参数', description: '管理系统运行参数和配置项' },
  '/system/filter-schemes': { name: '筛选方案', description: '管理各页面的筛选方案配置' },
  '/system/logs': {
    name: '操作日志',
    description: '业务模块操作记录与登录登出日志（顶部下拉切换）',
  },
  '/notifications': { name: '通知中心', description: '查看和管理所有系统通知' },
  '/trash': { name: '回收站', description: '查看和管理已删除的数据，支持恢复或永久删除' },
  // 开发调试
  '/rate-limit-test': { name: '限流测试' },
  '/ui-demo': { name: 'UI 组件演示' },
};

function getPageMeta(pathname: string): { name: string; description?: string } {
  if (pageMetaMap[pathname]) return pageMetaMap[pathname];
  // 动态路由前缀匹配（如 /approval/flows/:id -> /approval/flows）
  const segments = pathname.split('/').filter(Boolean);
  while (segments.length > 0) {
    segments.pop();
    const prefix = '/' + segments.join('/');
    if (pageMetaMap[prefix]) return pageMetaMap[prefix];
  }
  return { name: '' };
}

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const pageMeta = getPageMeta(location.pathname);

  // 稳定的 ref callback：避免 Header 重渲染时反复 detach/attach slot DOM
  const setHeaderSlotRef = useCallback((el: HTMLDivElement | null) => {
    const { slotEl, setSlotEl } = useHeaderSlotStore.getState();
    if (slotEl !== el) setSlotEl(el);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // 全局快捷键 Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="flex h-14 items-center border-b bg-card px-6">
      {/* 页面名称 + 描述 + 切换器 slot */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="shrink-0 text-base font-semibold">{pageMeta.name}</h1>
        {pageMeta.description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="max-w-xs text-sm">{pageMeta.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <div ref={setHeaderSlotRef} className="ml-2 flex min-w-0 items-center overflow-x-auto" />
      </div>

      {/* 右侧操作 */}
      <div className="ml-4 flex shrink-0 items-center gap-4">
        {/* 搜索 */}
        <Button
          variant="outline"
          onClick={() => setIsCommandPaletteOpen(true)}
          className="h-9 w-40 justify-start gap-2 bg-muted/50 px-3 text-muted-foreground hover:bg-muted"
          data-testid="search-button"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">搜索...</span>
          <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>

        {/* 主题切换 */}
        <ThemeToggle />

        {/* 通知中心 */}
        <NotificationCenter />

        {/* 用户菜单 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex h-10 items-center gap-2 px-2 hover:bg-accent"
              data-testid="user-menu-button"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="h-full w-full rounded-full" />
                ) : (
                  <span className="text-sm font-medium">
                    {(user?.employee?.name ?? user?.username)?.charAt(0).toUpperCase() ?? 'U'}
                  </span>
                )}
              </div>
              <span className="hidden text-sm font-medium md:block">
                {user?.employee?.name ?? user?.username ?? '用户'}
              </span>
              <ChevronDown className="h-4 w-4 opacity-50 transition-transform duration-200" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56" data-testid="user-menu-dropdown">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">
                  {user?.employee?.name ?? user?.username ?? '用户'}
                </p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.roles.some((r) => r.code === 'ADMIN') ? '系统管理员' : '普通用户'}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')} data-testid="profile-menu-item">
              <User className="mr-2 h-4 w-4" />
              <span>个人信息</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigate('/profile')}
              data-testid="account-settings-menu-item"
            >
              <Settings className="mr-2 h-4 w-4" />
              <span>账号设置</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openAppUpdate} data-testid="app-update-menu-item">
              <RefreshCw className="mr-2 h-4 w-4" />
              <span>立即检查更新</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              data-testid="logout-button"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>退出登录</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 命令面板 */}
      <CommandPalette open={isCommandPaletteOpen} onClose={() => setIsCommandPaletteOpen(false)} />
    </header>
  );
}
