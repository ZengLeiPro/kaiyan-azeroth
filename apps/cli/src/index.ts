#!/usr/bin/env node

import { Command, CommanderError, Option } from 'commander';

import { buildAgentCapabilities } from './capabilities.js';
import { registerActivitiesCommands } from './commands/activities.js';
import { registerApprovalsCommands } from './commands/approvals.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerCloudBillSnapshotsExtras } from './commands/cloud-bill-snapshots.js';
import { registerCloudUsageMetricsExtras } from './commands/cloud-usage-metrics.js';
import { registerCrmProductsExtras } from './commands/crm-products.js';
import { registerCrudCommands } from './commands/crud.js';
import { registerCustomersExtras } from './commands/customers.js';
import { registerDepartmentsExtras } from './commands/departments.js';
import { registerDescribeCommand } from './commands/describe.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerEffortRecordsExtras } from './commands/effort-records.js';
import { registerEmployeesExtras } from './commands/employees.js';
import { registerFinanceCommands } from './commands/finance.js';
import { registerFinanceLedgerExtras } from './commands/finance-ledger.js';
import { registerHolidaysExtras } from './commands/holidays.js';
import { registerInvoicesExtras } from './commands/invoices.js';
import { registerOperationLogsExtras } from './commands/operation-logs.js';
import { registerPaymentsExtras } from './commands/payments.js';
import { registerPayrollExtras } from './commands/payroll.js';
import { registerProjectTicketsExtras } from './commands/project-tickets.js';
import { registerProjectsExtras } from './commands/projects.js';
import { registerSaleOrdersExtras } from './commands/sale-orders.js';
import { registerSalesActionItemsExtras } from './commands/sales-action-items.js';
// 2026-06-13 audit 补齐：CLI 全模块 CRUD 覆盖 + 权限矩阵闭环 phase C
import { registerSystemParamsCommands } from './commands/system-params.js';
import { registerUsersExtras } from './commands/users.js';
import { registerWebEventsExtras } from './commands/web-events.js';
import { registerXiaohongshuCommands } from './commands/xiaohongshu.js';
import { discoverEntities } from './registry.js';
import { CLI_EXIT_CODES, CliError, printJson, reportCliError } from './utils.js';

const program = new Command();

program
  .name('azeroth')
  // 注意：version flag 必须避开 `--version`，否则会和子命令 update 的乐观锁
  // 字段 `--version <value>` 冲突——commander 根级选项优先级高，会把
  // `azeroth users update <id> --version 1` 解析为「打印 CLI 版本号」
  // 然后 exit 0，子命令 action 永不执行。
  .version('1.2.0', '-V, --cli-version', 'output the CLI version')
  .description('ky-azeroth CLI — business operations and complete analytics queries')
  .addOption(
    new Option('--format <type>', 'Output format: json | table')
      .choices(['json', 'table'])
      .default('json')
  )
  .addHelpText(
    'after',
    '\nCapability discovery:\n' +
      '  azeroth capabilities  Complete Agent-facing command catalog, including reporting/config groups.\n' +
      '  azeroth entities      Schema-discovered CRUD/read-only entities only (a subset).\n'
  );

// Commander usage failures are converted into the same stable JSON envelope as runtime errors.
program.exitOverride();
program.configureOutput({ writeErr: () => undefined });

// ── Static commands ─────────────────────────────────────────────────

registerAuthCommands(program);
registerDescribeCommand(program);
registerDoctorCommand(program);
registerApprovalsCommands(program);

// ── Entity listing ──────────────────────────────────────────────────

program
  .command('entities')
  .description(
    'List schema-discovered CRUD/read-only entities only; use capabilities for the complete command catalog'
  )
  .action(() => {
    const entities = discoverEntities();
    const list = [...entities.entries()].map(([name, config]) => ({
      command: name,
      label: config.label,
    }));
    list.sort((a, b) => a.command.localeCompare(b.command));
    printJson(list);
  });

program
  .command('capabilities')
  .description(
    'List the complete Agent-facing command catalog with operations, permissions and risk levels'
  )
  .action(() => {
    printJson(buildAgentCapabilities(discoverEntities(), program));
  });

// ── Dynamic CRUD commands ───────────────────────────────────────────

const entities = discoverEntities();
for (const [name, config] of entities) {
  registerCrudCommands(program, name, config);
}

// ── Extra hand-written subcommands attached to auto-discovered entities ─
// 这些子命令属于"业务动作"而非标准 CRUD，由各自专用模块手挂到自动注册的
// 实体命令上。注意：必须在 entities for-loop 之后执行，否则 find 不到。
const holidaysCmd = program.commands.find((c) => c.name() === 'holidays');
if (holidaysCmd) registerHolidaysExtras(holidaysCmd);

const projectsCmd = program.commands.find((c) => c.name() === 'projects');
if (projectsCmd) registerProjectsExtras(projectsCmd);

const customersCmd = program.commands.find((c) => c.name() === 'customers');
if (customersCmd) registerCustomersExtras(customersCmd);

const paymentsCmd = program.commands.find((c) => c.name() === 'payments');
if (paymentsCmd) registerPaymentsExtras(paymentsCmd);

const invoicesCmd = program.commands.find((c) => c.name() === 'invoices');
if (invoicesCmd) registerInvoicesExtras(invoicesCmd);

const saleOrdersCmd = program.commands.find((c) => c.name() === 'sale-orders');
if (saleOrdersCmd) registerSaleOrdersExtras(saleOrdersCmd);

const financeLedgerCmd = program.commands.find((c) => c.name() === 'finance-ledger');
if (financeLedgerCmd) registerFinanceLedgerExtras(financeLedgerCmd);

const payrollCmd = program.commands.find((c) => c.name() === 'payroll');
if (payrollCmd) registerPayrollExtras(payrollCmd);

const usersCmd = program.commands.find((c) => c.name() === 'users');
if (usersCmd) registerUsersExtras(usersCmd);

const effortRecordsCmd = program.commands.find((c) => c.name() === 'effort-records');
if (effortRecordsCmd) registerEffortRecordsExtras(effortRecordsCmd);

const employeesCmd = program.commands.find((c) => c.name() === 'employees');
if (employeesCmd) registerEmployeesExtras(employeesCmd);

const salesActionItemsCmd = program.commands.find((c) => c.name() === 'sales-action-items');
if (salesActionItemsCmd) registerSalesActionItemsExtras(salesActionItemsCmd);

const webEventsCmd = program.commands.find((c) => c.name() === 'web-events');
if (webEventsCmd) registerWebEventsExtras(webEventsCmd);

// 2026-06-13 audit phase C 新增 extras
const departmentsCmd = program.commands.find((c) => c.name() === 'departments');
if (departmentsCmd) registerDepartmentsExtras(departmentsCmd);

const projectTicketsCmd = program.commands.find((c) => c.name() === 'project-tickets');
if (projectTicketsCmd) registerProjectTicketsExtras(projectTicketsCmd);

const operationLogsCmd = program.commands.find((c) => c.name() === 'operation-logs');
if (operationLogsCmd) registerOperationLogsExtras(operationLogsCmd);

const crmProductsCmd = program.commands.find((c) => c.name() === 'crm-products');
if (crmProductsCmd) registerCrmProductsExtras(crmProductsCmd);

const cloudBillSnapshotsCmd = program.commands.find((c) => c.name() === 'cloud-bill-snapshots');
if (cloudBillSnapshotsCmd) registerCloudBillSnapshotsExtras(cloudBillSnapshotsCmd);

const cloudUsageMetricsCmd = program.commands.find((c) => c.name() === 'cloud-usage-metrics');
if (cloudUsageMetricsCmd) registerCloudUsageMetricsExtras(cloudUsageMetricsCmd);

// finance 实体已在 EXCLUDED_ENTITIES 排除自动 CRUD，命令组直接顶级注册（不追挂）
registerFinanceCommands(program);

// activities 是 union 投影视图，无对应实体，直接顶级注册
registerActivitiesCommands(program);

// system-params 命名错位（querySystemConfigSchema + updateSystemParamSchema 命名空间不一致），
// 自动发现 drop，直接顶级注册（不追挂）
registerSystemParamsCommands(program);

// 小红书聚光是专题报表/同步能力，不是可自动发现的 CRUD 实体。
registerXiaohongshuCommands(program);

// ── Execute ─────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof CommanderError) {
    if (err.exitCode === 0) {
      process.exitCode = CLI_EXIT_CODES.SUCCESS;
      return;
    }
    reportCliError(
      new CliError(err.message, {
        code: 'USAGE',
        retryable: false,
        exitCode: CLI_EXIT_CODES.USAGE,
      })
    );
    return;
  }
  reportCliError(err);
});
