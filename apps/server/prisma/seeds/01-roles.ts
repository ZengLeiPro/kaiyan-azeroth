import { PrismaClient } from '@prisma/client';

/**
 * 角色与权限种子数据
 * 创建系统默认角色，并为每个角色预置权限
 */

// 菜单 Key（必须与前端 menuGroups 中的 item.key 精确一致）
const ANALYTICS_MENUS = ['overview', 'crm', 'projects', 'organization', 'seo', 'web'];
const CRM_MENUS = [
  'customers',
  'contacts',
  'opportunities',
  'sale_orders',
  'payments',
  'invoices',
  'keep_records',
  'visit_records',
  'products',
];
const PROJECT_MENUS = ['project_list', 'project_tickets', 'effort_records', 'effort_stats'];
const REPORT_MENUS = [
  'work_dailies',
  'telesales_dailies',
  'dingtalk_logs',
  'calendar_events',
  'employee_leaves',
];
const ORG_MENUS = ['employees', 'departments'];
const APPROVAL_MENUS = ['approval_flows', 'approval_list'];
const FINANCE_MENUS = [
  'payroll',
  'payroll_import',
  'ledger',
  'personal_ledger',
  'pnl',
  'finance_import',
  'accounts',
  'subjects',
];
const OPS_MENUS = [
  'cloud_cost_dashboard',
  'cloud_usage',
  'cloud_packages',
  'cloud_instances',
  'cloud_renewal',
  'cloud_bills',
  'cloud_alerts',
];
const SYSTEM_MENUS = [
  'user_account',
  'user_role',
  'system_config',
  'filter_schemes',
  'operation_logs',
  'holidays',
];

type Actions = {
  view?: boolean;
  create?: boolean;
  edit?: boolean;
  delete?: boolean;
  export?: boolean;
  approve?: boolean;
  /** 数据范围,默认 SELF */
  viewScope?: 'SELF' | 'ALL';
};

function makePermissions(module: string, menus: string[], actions: Actions) {
  return menus.map((menu) => ({
    module,
    menu,
    view: actions.view ?? false,
    create: actions.create ?? false,
    edit: actions.edit ?? false,
    delete: actions.delete ?? false,
    export: actions.export ?? false,
    approve: actions.approve ?? false,
    viewScope: actions.viewScope ?? 'SELF',
  }));
}

interface RoleDef {
  code: string;
  name: string;
  description: string;
  permissions: ReturnType<typeof makePermissions>;
}

const roleDefs: RoleDef[] = [
  {
    code: 'ADMIN',
    name: '系统管理员',
    description: '拥有系统所有权限（同样通过 system/roles 权限矩阵配置）',
    permissions: [
      ...makePermissions('analytics', ANALYTICS_MENUS, { view: true, viewScope: 'ALL' }),
      ...makePermissions('crm', CRM_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        export: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('projects', PROJECT_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('reports', REPORT_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        export: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('organization', ORG_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('approval', APPROVAL_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        approve: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('finance', FINANCE_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        export: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('ops', OPS_MENUS, { view: true, edit: true, viewScope: 'ALL' }),
      ...makePermissions('system', SYSTEM_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        viewScope: 'ALL',
      }),
    ],
  },
  {
    code: 'CRM_MANAGER',
    name: 'CRM 管理员',
    description: 'CRM 模块全部权限，可查看工作汇报和组织架构（全部数据范围）',
    permissions: [
      ...makePermissions('crm', CRM_MENUS, {
        view: true,
        create: true,
        edit: true,
        delete: true,
        export: true,
        viewScope: 'ALL',
      }),
      ...makePermissions('reports', REPORT_MENUS, { view: true, viewScope: 'ALL' }),
      ...makePermissions('organization', ORG_MENUS, { view: true, viewScope: 'ALL' }),
      ...makePermissions('approval', APPROVAL_MENUS, {
        view: true,
        create: true,
        approve: true,
        viewScope: 'ALL',
      }),
      // 经营分析：总览 + CRM 经营盘 + 项目交付盘（组织效率盘默认仅 ADMIN）
      ...makePermissions('analytics', ['overview', 'crm', 'projects'], {
        view: true,
        viewScope: 'ALL',
      }),
    ],
  },
  {
    code: 'SALES',
    name: '销售人员',
    description: 'CRM 基础读写权限',
    permissions: [
      ...makePermissions('crm', CRM_MENUS, { view: true, create: true, edit: true }),
      ...makePermissions('reports', ['work_dailies', 'telesales_dailies'], { view: true }),
      ...makePermissions('organization', ['employees'], { view: true }),
      // 经营分析：仅总览 + CRM 经营盘（个人数据范围）
      ...makePermissions('analytics', ['overview', 'crm'], { view: true }),
    ],
  },
  {
    code: 'TELESALES',
    name: '电话销售专员',
    description:
      '电销跟踪线索质量：CRM 基础 CRUD（无 delete），可提交 MQL/SQL 标签变更审批（字段级守卫强制走审批，无法 PUT 直改）',
    permissions: [
      // 同 SALES 的 CRM 基本盘（含 customers.edit，但 service 层字段级守卫
      // 会拒绝 PUT 修改 leadStage 系列字段，强制走 POST /customers/:id/lead-stage-change-request）
      ...makePermissions('crm', CRM_MENUS, { view: true, create: true, edit: true }),
      ...makePermissions('reports', ['work_dailies', 'telesales_dailies'], { view: true }),
      ...makePermissions('organization', ['employees'], { view: true }),
      // 审批：可发起（自己提交 lead stage 变更）+ 查看自己发起的
      ...makePermissions('approval', ['approval_list'], { view: true, create: true }),
      ...makePermissions('analytics', ['overview', 'crm'], { view: true }),
    ],
  },
  {
    code: 'PM',
    name: '项目经理',
    description: '项目管理模块全部权限，CRM 和工作汇报可查看',
    permissions: [
      ...makePermissions('crm', CRM_MENUS, { view: true }),
      // 项目列表：完整 CRUD
      ...makePermissions('projects', ['project_list'], {
        view: true,
        create: true,
        edit: true,
        delete: true,
      }),
      // 工时记录：完整 CRUD
      ...makePermissions('projects', ['effort_records'], {
        view: true,
        create: true,
        edit: true,
        delete: true,
      }),
      // 工时统计：仅查看，全部数据
      ...makePermissions('projects', ['effort_stats'], { view: true, viewScope: 'ALL' }),
      // 项目工单：完整 CRUD（项目经理是主要派单人）
      ...makePermissions('projects', ['project_tickets'], {
        view: true,
        create: true,
        edit: true,
        delete: true,
      }),
      ...makePermissions('reports', REPORT_MENUS, { view: true }),
      ...makePermissions('organization', ORG_MENUS, { view: true }),
      // 经营分析：总览 + 项目交付盘
      ...makePermissions('analytics', ['overview', 'projects'], { view: true }),
    ],
  },
  {
    code: 'DEVELOPER',
    name: '开发人员',
    description: '项目模块工时填报权限',
    permissions: [
      // 项目列表：仅查看
      ...makePermissions('projects', ['project_list'], { view: true }),
      // 工时记录：查看+新建+编辑（填自己的工时）
      ...makePermissions('projects', ['effort_records'], { view: true, create: true, edit: true }),
      // 工时统计：仅查看
      ...makePermissions('projects', ['effort_stats'], { view: true }),
      // 项目工单：查看 + 编辑（接单人需要改状态）
      ...makePermissions('projects', ['project_tickets'], { view: true, edit: true }),
    ],
  },
  {
    code: 'VIEWER',
    name: '只读用户',
    description: '仅查看权限',
    permissions: [
      ...makePermissions('crm', CRM_MENUS, { view: true }),
      ...makePermissions('projects', PROJECT_MENUS, { view: true }),
      ...makePermissions('reports', REPORT_MENUS, { view: true }),
      ...makePermissions('organization', ORG_MENUS, { view: true }),
      ...makePermissions('analytics', ANALYTICS_MENUS, { view: true }),
    ],
  },
];

export async function seedRoles(prisma: PrismaClient) {
  console.log('[Roles] 正在创建系统角色与权限...');

  for (const def of roleDefs) {
    // 1. Upsert 角色
    let role = await prisma.role.findFirst({ where: { code: def.code } });
    if (!role) {
      role = await prisma.role.create({
        data: {
          code: def.code,
          name: def.name,
          description: def.description,
          status: 'active',
        },
      });
      console.log(`  - 创建角色: ${def.name}`);
    } else {
      console.log(`  - 角色已存在: ${def.name}`);
    }

    // 2. Upsert 权限
    if (def.permissions.length === 0) continue;

    let created = 0;
    let skipped = 0;
    for (const perm of def.permissions) {
      const existing = await prisma.rolePermission.findUnique({
        where: {
          roleId_module_menu: {
            roleId: role.id,
            module: perm.module,
            menu: perm.menu,
          },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.rolePermission.create({
        data: {
          roleId: role.id,
          ...perm,
        },
      });
      created++;
    }
    console.log(`    权限: ${created} 条新建, ${skipped} 条已存在`);
  }

  console.log('[Roles] 角色与权限数据创建完成');
}
