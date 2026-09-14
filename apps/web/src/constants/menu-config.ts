import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Boxes,
  Briefcase,
  Building,
  Calendar,
  CalendarClock,
  CalendarDays,
  CheckCircle,
  ClipboardList,
  Clock,
  Cloud,
  Cpu,
  DollarSign,
  FileEdit,
  FileText,
  Filter,
  FolderKanban,
  GitBranch,
  GitPullRequest,
  Globe,
  LayoutDashboard,
  LineChart,
  List,
  ListChecks,
  type LucideIcon,
  MapPin,
  Megaphone,
  Package,
  Receipt,
  ScrollText,
  Search,
  Settings,
  Shield,
  Sliders,
  Swords,
  Target,
  Ticket,
  TrendingUp,
  Upload,
  UserCircle,
  UserCog,
  UserMinus,
  Users,
  Wrench,
} from 'lucide-react';

/**
 * 路径命名约定（2026-05-01 立）
 * - 资源列表用复数：/crm/customers
 * - 日志类资源加 -logs 后缀：/reports/dingtalk-logs
 * - 概览页用 dashboard 单词：/dashboard
 * - 操作类页面用动词或具体功能名：/finance/payroll-import
 *
 * 历史不一致路径不动以避免破坏已分发的书签：
 * - /finance/payroll（按约定应为 payrolls）
 * - /finance/payroll-import（按约定应为 payroll-imports）
 *
 * 后续新增页面必须遵循上述约定。
 */

export interface MenuItem {
  key: string;
  name: string;
  path: string;
  icon: LucideIcon;
  /** 权限校验所用的权限点（默认取当前分组 key + item key）。 */
  permission?: { module: string; menu: string };
  /** 多个权限入口共享同一 UI 容器时，任一权限点有 view 权限即可显示。 */
  permissionAnyOf?: Array<{ module: string; menu: string }>;
}

export interface MenuGroup {
  key: string;
  name: string;
  icon: LucideIcon;
  items: MenuItem[];
}

export const menuGroups: MenuGroup[] = [
  {
    key: 'analytics',
    name: '数据分析',
    icon: BarChart3,
    items: [
      {
        key: 'overview',
        name: '总览',
        path: '/analytics',
        icon: LayoutDashboard,
      },
      {
        key: 'crm',
        name: 'CRM 经营盘',
        path: '/analytics/crm',
        icon: TrendingUp,
      },
      {
        key: 'projects',
        name: '项目交付盘',
        path: '/analytics/projects',
        icon: FolderKanban,
      },
      {
        key: 'organization',
        name: '组织效率盘',
        path: '/analytics/organization',
        icon: Building,
      },
      {
        key: 'web',
        name: '官网增长驾驶舱',
        path: '/analytics/web',
        icon: Globe,
      },
      {
        key: 'seo',
        name: '搜索表现详情',
        path: '/analytics/seo',
        icon: Search,
      },
      {
        key: 'xiaohongshu',
        name: '小红书聚光',
        path: '/analytics/xiaohongshu',
        icon: Megaphone,
      },
      // /analytics/seo/sync-runs 不进侧边栏：从主看板顶部「查看同步日志」按钮进入
    ],
  },
  {
    key: 'crm',
    name: 'CRM',
    icon: Briefcase,
    items: [
      {
        key: 'sales_action_items',
        name: '销售待办',
        path: '/crm/sales-action-items',
        icon: Swords,
      },
      { key: 'customers', name: '客户', path: '/crm/customers', icon: Users },
      { key: 'contacts', name: '联系人', path: '/crm/contacts', icon: UserCircle },
      { key: 'opportunities', name: '商机', path: '/crm/opportunities', icon: Target },
      { key: 'sale_orders', name: '合同订单', path: '/crm/sale-orders', icon: FileText },
      { key: 'payments', name: '回款', path: '/crm/payments', icon: DollarSign },
      { key: 'invoices', name: '开票', path: '/crm/invoices', icon: Receipt },
      { key: 'keep_records', name: '跟进记录', path: '/crm/keep-records', icon: ClipboardList },
      { key: 'visit_records', name: '拜访签到', path: '/crm/visit-records', icon: MapPin },
      { key: 'products', name: '产品', path: '/crm/products', icon: Package },
    ],
  },
  {
    key: 'projects',
    name: '项目',
    icon: FolderKanban,
    items: [
      { key: 'project_list', name: '项目列表', path: '/projects', icon: List },
      {
        key: 'project_tickets',
        name: '项目工单',
        path: '/projects/tickets',
        icon: Ticket,
      },
      {
        key: 'effort_records',
        name: '工时记录',
        path: '/projects/effort-records',
        icon: Clock,
      },
      { key: 'effort_stats', name: '工时统计', path: '/projects/effort-stats', icon: BarChart3 },
    ],
  },
  {
    key: 'reports',
    name: '工作汇报',
    icon: ClipboardList,
    items: [
      { key: 'work_dailies', name: 'CRM日报', path: '/reports/work-dailies', icon: FileEdit },
      {
        key: 'telesales_dailies',
        name: '电销日报',
        path: '/reports/telesales-dailies',
        icon: FileEdit,
      },
      { key: 'dingtalk_logs', name: '钉钉日志', path: '/reports/dingtalk-logs', icon: BookOpen },
      {
        key: 'calendar_events',
        name: '日程事件',
        path: '/reports/calendar-events',
        icon: Calendar,
      },
    ],
  },
  {
    key: 'ops',
    name: '运维',
    icon: Wrench,
    items: [
      {
        key: 'cloud_cost_dashboard',
        name: '云成本概览',
        path: '/ops/cloud-cost/dashboard',
        icon: LayoutDashboard,
      },
      {
        key: 'cloud_usage',
        name: '用量监控',
        path: '/ops/cloud-cost/usage',
        icon: LineChart,
      },
      {
        key: 'cloud_packages',
        name: '资源包',
        path: '/ops/cloud-cost/packages',
        icon: Boxes,
      },
      {
        key: 'cloud_instances',
        name: '实例明细',
        path: '/ops/cloud-cost/instances',
        icon: Cpu,
      },
      {
        key: 'cloud_renewal',
        name: '续费日历',
        path: '/ops/cloud-cost/renewal',
        icon: CalendarClock,
      },
      {
        key: 'cloud_bills',
        name: '账单中心',
        path: '/ops/cloud-cost/bills',
        icon: Cloud,
      },
      {
        key: 'cloud_alerts',
        name: '预警中心',
        path: '/ops/cloud-cost/alerts',
        icon: AlertTriangle,
      },
    ],
  },
  {
    key: 'approval',
    name: '审批',
    icon: CheckCircle,
    items: [
      {
        key: 'approval_flows',
        name: '审批流程',
        path: '/approval/flows',
        icon: GitPullRequest,
      },
      { key: 'approval_list', name: '审批列表', path: '/approval/list', icon: ListChecks },
    ],
  },
  {
    key: 'finance',
    name: '财务',
    icon: DollarSign,
    items: [
      { key: 'payroll', name: '员工薪资', path: '/finance/payroll', icon: DollarSign },
      // 薪资导入已合并为 /finance/payroll 内 ?tab=import；权限码 payroll_import 仍独立（控制 tab 显隐）
      // 以下财务项可通过 system/roles 权限配置可见性。
      // 财务账综合视图：公司流水 / 个人流水 / 损益表 三个子视图通过顶部 tab 切换
      // 原 ledger/personal_ledger/pnl 三项菜单已合并；旧路径在 App.tsx 做 Navigate 重定向
      {
        key: 'ledger',
        name: '账务',
        path: '/finance/ledger',
        icon: BookOpen,
        permissionAnyOf: [
          { module: 'finance', menu: 'ledger' },
          { module: 'finance', menu: 'personal_ledger' },
          { module: 'finance', menu: 'pnl' },
        ],
      },
      {
        key: 'accounts',
        name: '账户字典',
        path: '/finance/accounts',
        icon: Boxes,
      },
      {
        key: 'subjects',
        name: '科目字典',
        path: '/finance/subjects',
        icon: ListChecks,
      },
      {
        key: 'finance_import',
        name: '钉钉导入',
        path: '/finance/import',
        icon: Upload,
      },
    ],
  },
  {
    key: 'organization',
    name: '组织架构',
    icon: Building,
    items: [
      { key: 'employees', name: '员工', path: '/organization/employees', icon: Users },
      {
        key: 'departments',
        name: '部门',
        path: '/organization/departments',
        icon: GitBranch,
      },
      {
        key: 'employee_leaves',
        name: '离职记录',
        path: '/reports/employee-leaves',
        icon: UserMinus,
        permission: { module: 'reports', menu: 'employee_leaves' },
      },
    ],
  },
  {
    key: 'system',
    name: '系统',
    icon: Settings,
    items: [
      { key: 'user_account', name: '用户', path: '/system/users', icon: UserCog },
      { key: 'user_role', name: '角色权限', path: '/system/roles', icon: Shield },
      { key: 'system_config', name: '系统参数', path: '/system/params', icon: Sliders },
      {
        key: 'filter_schemes',
        name: '筛选方案',
        path: '/system/filter-schemes',
        icon: Filter,
      },
      { key: 'holidays', name: '节假日设置', path: '/system/holidays', icon: CalendarDays },
      {
        key: 'operation_logs',
        name: '操作日志',
        path: '/system/logs',
        icon: ScrollText,
      },
    ],
  },
];
