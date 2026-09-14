/**
 * 系统模块定义 - 权限与导航树
 */

export interface ModuleMenu {
  label: string;
  /**
   * 该菜单对应的 CLI 顶级命令名（用于 agent 反查）。
   *  - undefined（默认）：CLI 命令名与 menu key 同名（snake_case→kebab-case）
   *  - 字符串：显式映射，如 `system.user_account` → `'users'`
   *  - null：纯看板/聚合菜单，无对应 CLI 命令（不应让 agent 期待 CLI 入口）
   *
   * 仅用于 describe --menu 反查与帮助文档，不影响 CLI 命令注册逻辑。
   */
  cliCommand?: string | null;
  /**
   * 该菜单 CLI 使用提示（多命令复用 / 需带特定参数等情况）。
   * 显示在 describe --menu 输出与 CLI 帮助文本中。
   */
  cliHint?: string;
}

export interface ModuleGroup {
  label: string;
  menus: Record<string, ModuleMenu>;
}

export const PERMISSION_ACTIONS = {
  view: { label: '查看' },
  create: { label: '新建' },
  edit: { label: '编辑' },
  delete: { label: '删除' },
  export: { label: '导出' },
  approve: { label: '审批' },
} as const;

export type PermissionActionKey = keyof typeof PERMISSION_ACTIONS;
export type PermissionActionKeyList = readonly PermissionActionKey[];

const READONLY = ['view'] as const satisfies PermissionActionKeyList;
const CRUD = ['view', 'create', 'edit', 'delete'] as const satisfies PermissionActionKeyList;
const CRUD_EXPORT = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
] as const satisfies PermissionActionKeyList;

const moduleActions: Record<string, PermissionActionKeyList> = {
  analytics: READONLY,
  crm: CRUD_EXPORT,
  projects: CRUD,
  reports: READONLY,
  organization: CRUD,
  approval: ['view', 'create', 'edit', 'delete', 'approve'],
  finance: CRUD,
  ops: READONLY,
  system: CRUD,
} as const satisfies Record<string, PermissionActionKeyList>;

const menuActionOverrides: Record<string, PermissionActionKeyList> = {
  'projects.effort_stats': READONLY,
  'reports.work_dailies': CRUD_EXPORT,
  'reports.telesales_dailies': CRUD_EXPORT,
  'reports.dingtalk_logs': CRUD,
  'reports.calendar_events': READONLY,
  'reports.employee_leaves': READONLY,
  'approval.approval_list': ['view', 'create', 'edit', 'approve'],
  'finance.payroll_import': ['view', 'create'],
  'finance.finance_import': ['view', 'create'],
  'finance.pnl': READONLY,
  'ops.cloud_alerts': ['view', 'edit'],
  'ops.cloud_instances': ['view', 'edit'],
  'system.system_config': ['view', 'edit'],
  'system.filter_schemes': ['view', 'edit'],
  'analytics.web': ['view', 'delete'],
  'analytics.xiaohongshu': ['view', 'edit'],
  'system.operation_logs': READONLY,
  'system.holidays': ['view', 'edit'],
} as const satisfies Record<string, PermissionActionKeyList>;

export const MODULES: Record<string, ModuleGroup> = {
  analytics: {
    label: '数据分析',
    menus: {
      // 看板/聚合菜单通常不暴露顶级 CLI；小红书聚光例外，需向 Agent 提供完整数据集查询。
      // 其它分析域如需拉数走 ky-data-query skill 的实体命令或专用只读入口。
      overview: { label: '总览', cliCommand: null },
      crm: { label: 'CRM 经营盘', cliCommand: null },
      projects: { label: '项目交付盘', cliCommand: null },
      organization: { label: '组织效率盘', cliCommand: null },
      seo: { label: 'SEO 数据看板', cliCommand: null },
      web: { label: '官网分析', cliCommand: null },
      xiaohongshu: { label: '小红书聚光', cliCommand: 'xiaohongshu' },
    },
  },
  crm: {
    label: 'CRM',
    menus: {
      customers: { label: '客户管理' },
      contacts: { label: '联系人' },
      opportunities: { label: '商机' },
      sale_orders: { label: '合同订单', cliCommand: 'sale-orders' },
      payments: { label: '回款管理' },
      invoices: { label: '开票管理' },
      keep_records: { label: '跟进记录', cliCommand: 'keep-records' },
      visit_records: { label: '拜访签到', cliCommand: 'visit-records' },
      products: { label: '产品管理', cliCommand: 'crm-products' },
      sales_action_items: { label: '销售待办', cliCommand: 'sales-action-items' },
    },
  },
  projects: {
    label: '项目管理',
    menus: {
      project_list: { label: '项目列表', cliCommand: 'projects' },
      project_tickets: { label: '项目工单', cliCommand: 'project-tickets' },
      effort_records: { label: '工时记录', cliCommand: 'effort-records' },
      // 工时统计是聚合看板，挂在 effort-records 下；无独立 CLI 命令。
      effort_stats: { label: '工时统计', cliCommand: null },
    },
  },
  reports: {
    label: '工作汇报',
    menus: {
      // CRM 日报与电销日报共用 crm-work-dailies 命令，按 type 字段区分。
      work_dailies: {
        label: 'CRM 日报',
        cliCommand: 'crm-work-dailies',
        cliHint: '查询 CRM 日报：azeroth crm-work-dailies list --type crm',
      },
      telesales_dailies: {
        label: '电销日报',
        cliCommand: 'crm-work-dailies',
        cliHint: '查询电销日报：azeroth crm-work-dailies list --type telesales',
      },
      dingtalk_logs: { label: '钉钉日志', cliCommand: 'dingtalk-logs' },
      calendar_events: { label: '日程事件', cliCommand: 'dingtalk-calendar-events' },
      employee_leaves: { label: '离职记录', cliCommand: 'employee-leaves' },
    },
  },
  organization: {
    label: '组织架构',
    menus: {
      employees: { label: '员工管理' },
      departments: { label: '部门管理' },
    },
  },
  approval: {
    label: '审批管理',
    menus: {
      approval_flows: { label: '审批流程', cliCommand: 'approval-flows' },
      // 审批列表对应 workflow 形态命令：submit/approve/withdraw，不是标准 CRUD。
      approval_list: {
        label: '审批列表',
        cliCommand: 'approvals',
        cliHint: '审批处理走 azeroth approvals approve/withdraw；提交必须走业务实体命令',
      },
    },
  },
  finance: {
    label: '财务管理',
    menus: {
      payroll: { label: '员工薪资' },
      // 薪资导入挂在 payroll controller 下，作为子端点；无独立 CLI 顶级命令。
      payroll_import: { label: '薪资导入', cliCommand: null },
      ledger: { label: '公司流水', cliCommand: 'finance-ledger' },
      personal_ledger: { label: '个人流水', cliCommand: 'finance-personal-ledger' },
      // 损益表是聚合看板，无 CRUD CLI。
      pnl: { label: '损益表', cliCommand: null },
      finance_import: {
        label: '钉钉导入',
        cliCommand: 'finance-import',
        cliHint: '导入是工作流命令：preview/commit/batches',
      },
      accounts: { label: '账户字典', cliCommand: 'finance-accounts' },
      subjects: { label: '科目字典', cliCommand: 'finance-subjects' },
    },
  },
  ops: {
    label: '运维',
    menus: {
      // 云成本概览/资源包/续费日历都是聚合视图，挂在 cloud-cost controller 下，无独立 CRUD CLI。
      cloud_cost_dashboard: { label: '云成本概览', cliCommand: null },
      cloud_usage: { label: '用量监控', cliCommand: 'cloud-usage-metrics' },
      cloud_packages: { label: '资源包', cliCommand: null },
      cloud_instances: { label: '实例明细', cliCommand: 'cloud-instance-metas' },
      cloud_renewal: { label: '续费日历', cliCommand: null },
      cloud_bills: { label: '账单中心', cliCommand: 'cloud-bill-snapshots' },
      cloud_alerts: { label: '预警中心', cliCommand: 'cloud-alerts' },
    },
  },
  system: {
    label: '系统管理',
    menus: {
      user_account: { label: '用户管理', cliCommand: 'users' },
      user_role: { label: '角色权限', cliCommand: 'roles' },
      system_config: { label: '系统参数', cliCommand: 'system-params' },
      filter_schemes: {
        label: '筛选方案',
        cliCommand: 'filter-schemes',
      },
      operation_logs: { label: '操作日志', cliCommand: 'operation-logs' },
      holidays: { label: '节假日设置', cliCommand: 'holidays' },
    },
  },
};

export const MODULE_PERMISSION_ACTIONS = Object.fromEntries(
  Object.entries(MODULES).map(([moduleKey, module]) => [
    moduleKey,
    Object.fromEntries(
      Object.keys(module.menus).map((menuKey) => [
        menuKey,
        menuActionOverrides[`${moduleKey}.${menuKey}`] ?? moduleActions[moduleKey] ?? READONLY,
      ])
    ),
  ])
) as {
  [moduleKey: string]: {
    [menuKey: string]: PermissionActionKeyList;
  };
};

/**
 * 菜单配置数组 - 从 MODULES 派生，用于导航渲染
 */
export const MENU_CONFIG = Object.entries(MODULES).map(([groupKey, group]) => ({
  key: groupKey,
  name: group.label,
  items: Object.entries(group.menus).map(([menuKey, menu]) => ({
    key: menuKey,
    name: menu.label,
  })),
}));

// ── 菜单 ↔ CLI 命令双向反查辅助 ────────────────────────────────────
//
// 用途：CLI describe --menu / agent 拿到菜单 key 时反查可用命令；
//      或反过来——拿到 CLI 命令名时查它服务于哪些权限菜单。
//
// 设计：
//  - 命名一致（CLI 命令名 = menu key 的 kebab-case）的菜单不需要显式标 cliCommand，
//    `getCliCommandForMenu` 会按 snake_case → kebab-case 自动推断
//  - 看板/聚合类菜单显式标 cliCommand: null，函数返回 null（明确"无 CLI 入口"）
//  - 同一个 CLI 命令服务多个菜单时（如 crm-work-dailies 服务 work_dailies + telesales_dailies），
//    `findMenusByCliCommand` 返回数组

/**
 * 拿到 `${module}.${menu}` 对应的 CLI 命令。
 *  - undefined（未声明 cliCommand）：按 menu key snake_case→kebab-case 推断
 *  - null（显式声明无 CLI）：返回 null
 *  - string：返回显式值
 *  - 菜单不存在：返回 undefined
 */
export function getCliCommandForMenu(
  moduleKey: string,
  menuKey: string
): string | null | undefined {
  const module = MODULES[moduleKey];
  if (!module) return undefined;
  const menu = module.menus[menuKey];
  if (!menu) return undefined;
  if (menu.cliCommand === null) return null;
  if (typeof menu.cliCommand === 'string') return menu.cliCommand;
  // 默认推断：snake_case → kebab-case
  return menuKey.replace(/_/g, '-');
}

/**
 * 反查：给定 CLI 命令名，返回所有它服务的 `${module}.${menu}` 入口与提示。
 * 用于 CLI 命令 help 文本展示「本命令对应的权限菜单」。
 */
export function findMenusByCliCommand(commandName: string): Array<{
  moduleKey: string;
  menuKey: string;
  label: string;
  cliHint?: string;
}> {
  const matches: Array<{
    moduleKey: string;
    menuKey: string;
    label: string;
    cliHint?: string;
  }> = [];
  for (const [moduleKey, module] of Object.entries(MODULES)) {
    for (const [menuKey, menu] of Object.entries(module.menus)) {
      const resolved = getCliCommandForMenu(moduleKey, menuKey);
      if (resolved === commandName) {
        matches.push({
          moduleKey,
          menuKey,
          label: menu.label,
          cliHint: menu.cliHint,
        });
      }
    }
  }
  return matches;
}
