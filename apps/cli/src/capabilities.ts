import { MODULE_PERMISSION_ACTIONS, MODULES, type PermissionActionKey } from '@ky-azeroth/shared';
import type { Command } from 'commander';

import type { EntityConfig } from './registry.js';

export type AgentCapabilityKind =
  | 'crud'
  | 'readonly'
  | 'workflow'
  | 'reporting'
  | 'security'
  | 'preference'
  | 'ops'
  | 'config'
  | 'auth'
  | 'schema'
  | 'meta';

export type AgentCapabilityRisk = 'low' | 'medium' | 'high' | 'admin';
export type AgentCapabilityGuard =
  | 'role-permission'
  | 'fresh-jwt'
  | 'authenticated'
  | 'public'
  | 'local-only';

export type AgentCapabilityConfirmation =
  | 'none'
  | 'dry-run'
  | 'yes'
  | 'preview-then-yes'
  | 'conditional';

export interface AgentCapabilityConditionalPolicy {
  selector: string;
  cases: Record<
    string,
    {
      risk: AgentCapabilityRisk;
      confirmation: Exclude<AgentCapabilityConfirmation, 'conditional'>;
    }
  >;
  dryRunConfirmation: 'none';
}

export interface AgentCapabilityOperation {
  operation: string;
  permissions: string[];
  guards: AgentCapabilityGuard[];
  /** Conservative maximum; conditionalPolicy carries exact per-value risk when present. */
  risk: AgentCapabilityRisk;
  confirmation: AgentCapabilityConfirmation;
  conditionalPolicy?: AgentCapabilityConditionalPolicy;
}

export interface AgentCapability {
  command: string;
  label: string;
  kind: AgentCapabilityKind;
  operations: string[];
  /** Per-operation policy is authoritative; command-level fields remain a compatibility union. */
  operationDetails: AgentCapabilityOperation[];
  permissions: string[];
  /** 完整 system/roles 动作集合；包含当前 CLI 暂无独立子命令的 export 等动作。 */
  roleActions: string[];
  guards: AgentCapabilityGuard[];
  risk: AgentCapabilityRisk;
}

interface StaticCapabilityConfig {
  command: string;
  label: string;
  kind: AgentCapabilityKind;
  operations: string[];
  permissions?: string[];
  roleActions?: string[];
  guards?: AgentCapabilityGuard[];
  risk?: AgentCapabilityRisk;
}

interface CapabilityAugment {
  kind?: AgentCapabilityKind;
  operations?: string[];
  permissions?: string[];
  guards?: AgentCapabilityGuard[];
  risk?: AgentCapabilityRisk;
}

const ROUTE_TO_PERMISSION_MENU: Record<string, { module: string; menu: string }> = {
  'crm-products': { module: 'crm', menu: 'products' },
  'crm-work-dailies': { module: 'reports', menu: 'work_dailies' },
  'project-tickets': { module: 'projects', menu: 'project_tickets' },
  projects: { module: 'projects', menu: 'project_list' },
  roles: { module: 'system', menu: 'user_role' },
  users: { module: 'system', menu: 'user_account' },
  payroll: { module: 'finance', menu: 'payroll' },
  'finance-ledger': { module: 'finance', menu: 'ledger' },
  'finance-personal-ledger': { module: 'finance', menu: 'personal_ledger' },
  'finance-pnls': { module: 'finance', menu: 'pnl' },
  'finance-accounts': { module: 'finance', menu: 'accounts' },
  'finance-subjects': { module: 'finance', menu: 'subjects' },
  holidays: { module: 'system', menu: 'holidays' },
  'operation-logs': { module: 'system', menu: 'operation_logs' },
  'login-logs': { module: 'system', menu: 'operation_logs' },
  'approval-flows': { module: 'approval', menu: 'approval_flows' },
  approvals: { module: 'approval', menu: 'approval_list' },
  'sales-action-items': { module: 'crm', menu: 'sales_action_items' },
  'cloud-alerts': { module: 'ops', menu: 'cloud_alerts' },
  'cloud-bill-snapshots': { module: 'ops', menu: 'cloud_bills' },
  'cloud-cost-overviews': { module: 'ops', menu: 'cloud_cost_dashboard' },
  'cloud-instance-metas': { module: 'ops', menu: 'cloud_instances' },
  'cloud-usage-metrics': { module: 'ops', menu: 'cloud_usage' },
  'cloud-usage-serieses': { module: 'ops', menu: 'cloud_usage' },
  'dingtalk-calendar-events': { module: 'reports', menu: 'calendar_events' },
  'dingtalk-logs': { module: 'reports', menu: 'dingtalk_logs' },
  'employee-leaves': { module: 'reports', menu: 'employee_leaves' },
  'seo-page-insights': { module: 'analytics', menu: 'seo' },
  'seo-search-queries': { module: 'analytics', menu: 'seo' },
  'seo-sync-runs': { module: 'analytics', menu: 'seo' },
  'seo-traffic-snapshots': { module: 'analytics', menu: 'seo' },
  'web-events': { module: 'analytics', menu: 'web' },
};

const CAPABILITY_AUGMENTS: Record<string, CapabilityAugment> = {
  employees: {
    operations: ['bind-dingtalk', 'unbind-dingtalk'],
    permissions: ['organization.employees.edit'],
    risk: 'admin',
  },
  customers: {
    operations: [
      'trash',
      'duplicate-check',
      'batch-transfer',
      'batch-update',
      'batch-add-collaborators',
      'batch-remove-collaborators',
      'batch-delete',
      'permanent-delete',
      'correct-lead-stage',
      'set-lead-stage',
      'submit-lead-stage-change',
      'update-lead-progress',
    ],
    permissions: ['crm.customers.view', 'crm.customers.edit', 'crm.customers.delete'],
    risk: 'high',
  },
  'crm-products': {
    operations: ['trash', 'permanent-delete'],
    risk: 'high',
  },
  'crm-work-dailies': {
    permissions: [
      'reports.telesales_dailies.view',
      'reports.telesales_dailies.create',
      'reports.telesales_dailies.edit',
      'reports.telesales_dailies.delete',
    ],
  },
  departments: {
    operations: [
      'tree',
      'children',
      'list-employees',
      'set-managers',
      'add-employee',
      'remove-employee',
    ],
    permissions: ['organization.departments.view', 'organization.departments.edit'],
  },
  'effort-records': {
    operations: ['batch-create', 'my-timesheet', 'my-recent-projects', 'stats'],
    permissions: [
      'projects.effort_records.create',
      'projects.effort_records.view',
      'projects.effort_stats.view',
    ],
  },
  holidays: {
    kind: 'config',
    operations: ['calendar', 'work-dates', 'publish'],
    permissions: ['system.holidays.view', 'system.holidays.edit', 'projects.effort_records.view'],
  },
  invoices: {
    operations: ['batch-transfer', 'batch-update', 'batch-approve', 'batch-delete', 'red-void'],
    permissions: ['crm.invoices.edit', 'crm.invoices.delete', 'approval.approval_list.approve'],
    risk: 'high',
  },
  payments: {
    operations: [
      'batch-transfer',
      'batch-update',
      'batch-approve',
      'merge-invoice',
      'batch-delete',
      'create-refund',
      'submit-refund-approval',
      'void-request',
    ],
    permissions: [
      'crm.payments.create',
      'crm.payments.edit',
      'crm.payments.delete',
      'approval.approval_list.approve',
    ],
    risk: 'high',
  },
  payroll: {
    operations: [
      'list-periods',
      'list-import-batches',
      'get-import-batch',
      'preview-import',
      'commit-import',
      'batch-delete',
    ],
    permissions: [
      'finance.payroll.view',
      'finance.payroll.create',
      'finance.payroll.delete',
      'finance.payroll_import.view',
      'finance.payroll_import.create',
    ],
    risk: 'admin',
  },
  'project-tickets': {
    operations: ['transition', 'reassign', 'stats'],
    permissions: ['projects.project_tickets.view', 'projects.project_tickets.edit'],
  },
  projects: {
    operations: [
      'link-sale-order',
      'unlink-sale-order',
      'add-member',
      'remove-member',
      'list-members',
    ],
    permissions: ['projects.project_list.view', 'projects.project_list.edit'],
    risk: 'high',
  },
  'sale-orders': {
    operations: [
      'batch-transfer',
      'batch-update',
      'batch-approve',
      'batch-delete',
      'void-preview',
      'void-request',
    ],
    permissions: [
      'crm.sale_orders.edit',
      'crm.sale_orders.delete',
      'approval.approval_list.approve',
    ],
    risk: 'high',
  },
  'finance-ledger': {
    operations: ['batch-update-subject', 'unlink-payment', 'link-payment'],
    permissions: ['finance.ledger.edit'],
    guards: ['role-permission', 'fresh-jwt'],
    risk: 'admin',
  },
  'sales-action-items': {
    operations: ['my', 'my-count', 'adopt', 'ignore', 'done', 'transfer', 'reopen', 'undo'],
    permissions: ['crm.sales_action_items.view', 'crm.sales_action_items.edit'],
  },
  users: {
    operations: ['update-status', 'change-password', 'list-all'],
    permissions: ['system.user_account.view', 'system.user_account.edit'],
    guards: ['role-permission'],
    risk: 'admin',
  },
  'web-events': {
    kind: 'ops',
    operations: ['archive'],
    permissions: ['analytics.web.view', 'analytics.web.delete'],
    guards: ['role-permission'],
    risk: 'admin',
  },
  'cloud-bill-snapshots': {
    kind: 'reporting',
    operations: ['latest', 'overview', 'package-projection'],
    permissions: [
      'ops.cloud_bills.view',
      'ops.cloud_cost_dashboard.view',
      'ops.cloud_packages.view',
    ],
  },
  'cloud-usage-metrics': {
    kind: 'reporting',
    operations: ['series'],
    permissions: ['ops.cloud_usage.view'],
  },
  'operation-logs': {
    operations: ['login-logs'],
    permissions: ['system.operation_logs.view'],
    risk: 'admin',
  },
};

const STATIC_CAPABILITIES: StaticCapabilityConfig[] = [
  {
    command: 'auth',
    label: '认证会话',
    kind: 'auth',
    operations: ['login', 'logout', 'whoami'],
    guards: ['public', 'authenticated'],
    risk: 'low',
  },
  {
    command: 'describe',
    label: '实体 Schema 描述',
    kind: 'schema',
    operations: ['describe'],
    guards: ['local-only'],
    risk: 'low',
  },
  {
    command: 'doctor',
    label: 'CLI 覆盖度体检',
    kind: 'meta',
    operations: ['doctor'],
    guards: ['local-only'],
    risk: 'low',
  },
  {
    command: 'entities',
    label: '实体清单',
    kind: 'meta',
    operations: ['entities'],
    guards: ['local-only'],
    risk: 'low',
  },
  {
    command: 'capabilities',
    label: 'Agent 能力清单',
    kind: 'meta',
    operations: ['capabilities'],
    guards: ['local-only'],
    risk: 'low',
  },
  {
    command: 'approvals',
    label: '审批动作',
    kind: 'workflow',
    operations: [
      'approve',
      'withdraw',
      'admin-approve',
      'pending',
      'completed',
      'initiated',
      'copy-to',
      'all',
      'pending-count',
      'form',
      'get',
      'get-change-request',
    ],
    permissions: [
      'approval.approval_list.view',
      'approval.approval_list.edit',
      'approval.approval_list.approve',
    ],
    guards: ['role-permission'],
    risk: 'high',
  },
  {
    command: 'activities',
    label: '客户活动时间线',
    kind: 'reporting',
    operations: ['list'],
    permissions: ['crm.customers.view'],
    guards: ['role-permission'],
    risk: 'low',
  },
  {
    command: 'finance',
    label: '财务总账综合命令',
    kind: 'reporting',
    operations: [
      'list-accounts',
      'get-account',
      'list-subjects',
      'get-subject',
      'list-ledger',
      'get-ledger',
      'list-personal-ledger',
      'pnl',
      'pnl-drilldown',
      'import-dingtalk-preview',
      'import-dingtalk-commit',
      'list-import-batches',
      'get-import-batch',
    ],
    permissions: [
      'finance.accounts.view',
      'finance.subjects.view',
      'finance.ledger.view',
      'finance.personal_ledger.view',
      'finance.pnl.view',
      'finance.finance_import.view',
      'finance.finance_import.create',
    ],
    guards: ['role-permission'],
    risk: 'admin',
  },
  {
    command: 'system-params',
    label: '系统参数',
    kind: 'config',
    operations: ['list', 'get', 'get-by-code', 'update'],
    permissions: ['system.system_config.view', 'system.system_config.edit'],
    guards: ['role-permission'],
    risk: 'admin',
  },
  {
    command: 'xiaohongshu',
    label: '小红书聚光完整数据查询',
    kind: 'reporting',
    operations: [
      'connection',
      'advertisers',
      'datasets',
      'describe-dataset',
      'query-dataset',
      'reports',
      'summary',
      'trend',
      'ranking',
      'sync-runs',
      'latest-sync-run',
      'get-sync-run',
      'trigger-sync',
    ],
    permissions: ['analytics.xiaohongshu.view'],
    guards: ['role-permission'],
    risk: 'medium',
  },
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function inferPermission(command: string): { module: string; menu: string } | undefined {
  if (ROUTE_TO_PERMISSION_MENU[command]) return ROUTE_TO_PERMISSION_MENU[command];
  const menu = command.replace(/-/g, '_');
  for (const [moduleKey, module] of Object.entries(MODULES)) {
    if (module.menus[menu]) return { module: moduleKey, menu };
  }
  return undefined;
}

function operationActions(config: EntityConfig): PermissionActionKey[] {
  const actions: PermissionActionKey[] = ['view'];
  if (!config.readOnly) {
    if (!config.supportedOperations || config.supportedOperations.includes('create'))
      actions.push('create');
    if (!config.supportedOperations || config.supportedOperations.includes('update'))
      actions.push('edit');
    if (!config.supportedOperations || config.supportedOperations.includes('delete'))
      actions.push('delete');
  }
  if (config.supportsSubmitApproval || config.supportsChangeRequest) actions.push('approve');
  return [...new Set(actions)];
}

function operations(config: EntityConfig): string[] {
  const base = config.supportedOperations ?? ['list', 'get', 'create', 'update', 'delete'];
  const result: string[] = config.readOnly
    ? base.filter((op) => op === 'list' || op === 'get')
    : [...base];
  if (config.supportsRestore) result.push('restore');
  if (config.supportsSubmitApproval) result.push('submit-approval');
  if (config.supportsClaim) result.push('claim');
  if (config.supportsChangeRequest) result.push('change-request');
  return result;
}

function riskOf(
  permission: { module: string; menu: string } | undefined,
  ops: string[]
): AgentCapabilityRisk {
  if (!permission) return 'medium';
  if (permission.module === 'system' || permission.module === 'finance') return 'admin';
  if (
    ops.some((op) =>
      ['delete', 'restore', 'change-request', 'permanent-delete', 'archive'].includes(op)
    )
  )
    return 'high';
  if (ops.some((op) => ['create', 'update'].includes(op))) return 'medium';
  return 'low';
}

function guardsFor(
  permissions: string[],
  override?: AgentCapabilityGuard[]
): AgentCapabilityGuard[] {
  if (override && override.length > 0) return uniqueSorted(override) as AgentCapabilityGuard[];
  if (permissions.length > 0) return ['role-permission'];
  return ['authenticated'];
}

function roleActionsFor(permission: { module: string; menu: string } | undefined): string[] {
  if (!permission) return [];
  return [...(MODULE_PERMISSION_ACTIONS[permission.module]?.[permission.menu] ?? [])];
}

function configToCapability(command: string, config: EntityConfig): AgentCapability {
  const permission = inferPermission(command);
  const baseOps = operations(config);
  const augment = CAPABILITY_AUGMENTS[command];
  const ops = uniqueSorted([...baseOps, ...(augment?.operations ?? [])]);
  const allowedActions = permission
    ? MODULE_PERMISSION_ACTIONS[permission.module]?.[permission.menu]
    : undefined;
  const basePermissions = permission
    ? operationActions(config)
        .filter((action) => allowedActions?.includes(action))
        .map((action) => `${permission.module}.${permission.menu}.${action}`)
    : [];
  const permissions = uniqueSorted([...basePermissions, ...(augment?.permissions ?? [])]);
  const roleActions = uniqueSorted([
    ...roleActionsFor(permission),
    ...permissions.map((p) => p.split('.').at(-1) ?? '').filter((p) => p.length > 0),
  ]);
  const kind = augment?.kind ?? (config.readOnly ? 'readonly' : 'crud');
  return {
    command,
    label: config.label,
    kind,
    operations: ops,
    operationDetails: [],
    permissions,
    roleActions,
    guards: guardsFor(permissions, augment?.guards),
    risk: augment?.risk ?? riskOf(permission, ops),
  };
}

function staticToCapability(config: StaticCapabilityConfig): AgentCapability {
  const permissions = uniqueSorted(config.permissions ?? []);
  const roleActions = uniqueSorted([
    ...(config.roleActions ?? []),
    ...permissions.map((p) => p.split('.').at(-1) ?? '').filter((p) => p.length > 0),
  ]);
  return {
    command: config.command,
    label: config.label,
    kind: config.kind,
    operations: uniqueSorted(config.operations),
    operationDetails: [],
    permissions,
    roleActions,
    guards: guardsFor(permissions, config.guards),
    risk: config.risk ?? 'medium',
  };
}

interface OperationPolicyOverride {
  permissions?: string[];
  guards?: AgentCapabilityGuard[];
  risk?: AgentCapabilityRisk;
  confirmation?: AgentCapabilityOperation['confirmation'];
  conditionalPolicy?: AgentCapabilityOperation['conditionalPolicy'];
}

const OPERATION_POLICY_OVERRIDES: Record<string, Record<string, OperationPolicyOverride>> = {
  customers: {
    delete: {
      permissions: ['crm.customers.delete'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    restore: {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
    },
    claim: {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
    },
    trash: {
      permissions: ['crm.customers.view'],
      guards: ['role-permission'],
    },
    'duplicate-check': {
      permissions: ['crm.customers.view'],
      guards: ['role-permission'],
    },
    'batch-transfer': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'batch-update': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'batch-add-collaborators': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'batch-remove-collaborators': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'batch-delete': {
      permissions: ['crm.customers.delete'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'permanent-delete': {
      permissions: ['crm.customers.delete'],
      guards: ['role-permission'],
      risk: 'admin',
      confirmation: 'yes',
    },
    'correct-lead-stage': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
      risk: 'admin',
      confirmation: 'preview-then-yes',
    },
    'set-lead-stage': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
    },
    'submit-lead-stage-change': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
    },
    'update-lead-progress': {
      permissions: ['crm.customers.edit'],
      guards: ['role-permission'],
    },
  },
  users: {
    create: {
      permissions: ['system.user_account.create'],
      guards: ['role-permission', 'fresh-jwt'],
    },
    update: {
      permissions: ['system.user_account.edit'],
      guards: ['role-permission', 'fresh-jwt'],
    },
    delete: {
      permissions: ['system.user_account.delete'],
      guards: ['role-permission', 'fresh-jwt'],
      confirmation: 'yes',
    },
    'update-status': {
      permissions: ['system.user_account.edit'],
      guards: ['role-permission', 'fresh-jwt'],
      risk: 'high',
      confirmation: 'conditional',
      conditionalPolicy: {
        selector: 'status',
        cases: {
          active: { risk: 'medium', confirmation: 'none' },
          disabled: { risk: 'high', confirmation: 'yes' },
        },
        dryRunConfirmation: 'none',
      },
    },
    'change-password': {
      permissions: [],
      guards: ['authenticated'],
    },
    'list-all': {
      permissions: ['system.user_account.view'],
      guards: ['role-permission'],
    },
  },
  employees: {
    'bind-dingtalk': {
      permissions: ['organization.employees.edit'],
      guards: ['role-permission', 'fresh-jwt'],
      risk: 'admin',
      confirmation: 'yes',
    },
    'unbind-dingtalk': {
      permissions: ['organization.employees.edit'],
      guards: ['role-permission', 'fresh-jwt'],
      risk: 'admin',
      confirmation: 'yes',
    },
  },
  xiaohongshu: {
    'trigger-sync': {
      permissions: ['analytics.xiaohongshu.view'],
      guards: ['role-permission'],
      risk: 'high',
      confirmation: 'yes',
    },
  },
  'web-events': {
    list: {
      permissions: ['analytics.web.view'],
      guards: ['role-permission'],
      risk: 'low',
    },
    get: {
      permissions: ['analytics.web.view'],
      guards: ['role-permission'],
      risk: 'low',
    },
    archive: {
      permissions: ['analytics.web.delete'],
      guards: ['role-permission', 'fresh-jwt'],
      risk: 'admin',
      confirmation: 'preview-then-yes',
    },
  },
  'sale-orders': {
    'batch-transfer': {
      permissions: ['crm.sale_orders.edit'],
      guards: ['role-permission', 'fresh-jwt'],
      risk: 'admin',
      confirmation: 'yes',
    },
    'batch-update': {
      permissions: ['crm.sale_orders.edit'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'batch-approve': {
      permissions: ['approval.approval_list.approve'],
      guards: ['role-permission'],
      confirmation: 'yes',
    },
    'batch-delete': {
      permissions: ['crm.sale_orders.delete'],
      guards: ['role-permission'],
      risk: 'high',
      confirmation: 'preview-then-yes',
    },
    'void-preview': {
      permissions: ['crm.sale_orders.delete'],
      guards: ['role-permission'],
      risk: 'low',
      confirmation: 'none',
    },
    'void-request': {
      permissions: ['crm.sale_orders.delete'],
      guards: ['role-permission'],
      risk: 'high',
      confirmation: 'dry-run',
    },
  },
  finance: {
    'import-dingtalk-commit': {
      guards: ['role-permission'],
      risk: 'admin',
      confirmation: 'preview-then-yes',
    },
  },
  payroll: {
    'commit-import': { risk: 'admin', confirmation: 'preview-then-yes' },
    'batch-delete': { risk: 'admin', confirmation: 'preview-then-yes' },
  },
};

function permissionsForOperation(capability: AgentCapability, operation: string): string[] {
  const action =
    operation === 'create'
      ? 'create'
      : operation === 'update'
        ? 'edit'
        : operation === 'delete'
          ? 'delete'
          : ['list', 'get'].includes(operation)
            ? 'view'
            : undefined;
  if (!action) return capability.permissions;
  const matching = capability.permissions.filter((permission) => permission.endsWith(`.${action}`));
  return matching.length > 0 ? matching : capability.permissions;
}

function defaultConfirmation(operation: string): AgentCapabilityOperation['confirmation'] {
  if (operation === 'delete' || operation === 'permanent-delete') return 'preview-then-yes';
  return 'none';
}

function addOperationDetails(capability: AgentCapability): AgentCapability {
  return {
    ...capability,
    operationDetails: capability.operations.map((operation) => {
      const override = OPERATION_POLICY_OVERRIDES[capability.command]?.[operation];
      const permissions = uniqueSorted(
        override?.permissions ?? permissionsForOperation(capability, operation)
      );
      return {
        operation,
        permissions,
        guards: uniqueSorted(
          override?.guards ?? guardsFor(permissions, capability.guards)
        ) as AgentCapabilityGuard[],
        risk: override?.risk ?? capability.risk,
        confirmation: override?.confirmation ?? defaultConfirmation(operation),
        ...(override?.conditionalPolicy ? { conditionalPolicy: override.conditionalPolicy } : {}),
      };
    }),
  };
}

function commanderOperations(program: Command, capability: AgentCapability): string[] {
  if (capability.command === 'auth') {
    return ['login', 'logout', 'whoami'].filter((name) =>
      program.commands.some((command) => command.name() === name)
    );
  }
  const command = program.commands.find((candidate) => candidate.name() === capability.command);
  if (!command) return [];
  return command.commands.length > 0
    ? command.commands.map((child) => child.name())
    : [capability.command];
}

function assertCommanderParity(program: Command, capabilities: AgentCapability[]): void {
  for (const capability of capabilities) {
    const declared = uniqueSorted(capability.operations);
    const actual = uniqueSorted(commanderOperations(program, capability));
    if (JSON.stringify(declared) !== JSON.stringify(actual)) {
      throw new Error(
        `Capability/Commander mismatch for ${capability.command}: declared=${declared.join(',')} actual=${actual.join(',')}`
      );
    }
  }
}

export function buildAgentCapabilities(
  entities: Map<string, EntityConfig>,
  program?: Command
): AgentCapability[] {
  const dynamicCapabilities = [...entities.entries()].map(([command, config]) =>
    configToCapability(command, config)
  );
  const capabilities = [...dynamicCapabilities, ...STATIC_CAPABILITIES.map(staticToCapability)]
    .map(addOperationDetails)
    .sort((a, b) => a.command.localeCompare(b.command));
  if (program) assertCommanderParity(program, capabilities);
  return capabilities;
}
