import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const repoRoot = path.resolve(cliDir, '../..');

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('help separates the complete capability catalog from schema-discovered entities', () => {
  const root = runCli(['--help']);
  assert.equal(root.status, 0, root.stderr);
  assert.match(
    root.stdout,
    /azeroth capabilities\s+Complete Agent-facing command catalog, including reporting\/config groups\./
  );
  assert.match(
    root.stdout,
    /azeroth entities\s+Schema-discovered CRUD\/read-only entities only \(a subset\)\./
  );

  const entities = runCli(['entities', '--help']);
  assert.equal(entities.status, 0, entities.stderr);
  assert.match(entities.stdout, /schema-discovered CRUD\/read-only entities only/i);
  assert.match(entities.stdout, /use capabilities for the\s+complete command catalog/i);

  const capabilities = runCli(['capabilities', '--help']);
  assert.equal(capabilities.status, 0, capabilities.stderr);
  assert.match(capabilities.stdout, /complete Agent-facing command catalog/i);
});

test('capabilities is Commander-exact, includes complete Xiaohongshu queries, and every operation has policy', () => {
  const result = runCli(['capabilities']);
  assert.equal(result.status, 0, result.stderr);
  const capabilities = JSON.parse(result.stdout) as Array<{
    command: string;
    operations: string[];
    operationDetails: Array<{
      operation: string;
      permissions: string[];
      guards: string[];
      risk: string;
      confirmation: string;
      conditionalPolicy?: {
        selector: string;
        cases: Record<string, { risk: string; confirmation: string }>;
        dryRunConfirmation: string;
      };
    }>;
  }>;
  for (const capability of capabilities) {
    assert.deepEqual(
      capability.operationDetails.map((detail) => detail.operation).sort(),
      [...capability.operations].sort(),
      capability.command
    );
    for (const detail of capability.operationDetails) {
      assert.ok(detail.guards.length > 0, `${capability.command}.${detail.operation}`);
      assert.ok(Array.isArray(detail.permissions));
      assert.ok(
        ['none', 'dry-run', 'yes', 'preview-then-yes', 'conditional'].includes(detail.confirmation)
      );
    }
  }

  const saleOrders = capabilities.find((capability) => capability.command === 'sale-orders');
  assert.ok(saleOrders);
  const transfer = saleOrders.operationDetails.find(
    (detail) => detail.operation === 'batch-transfer'
  );
  assert.deepEqual(transfer?.guards, ['fresh-jwt', 'role-permission']);
  assert.deepEqual(transfer?.permissions, ['crm.sale_orders.edit']);
  const preview = saleOrders.operationDetails.find((detail) => detail.operation === 'void-preview');
  assert.deepEqual(preview?.guards, ['role-permission']);
  assert.deepEqual(preview?.permissions, ['crm.sale_orders.delete']);
  assert.equal(preview?.confirmation, 'none');

  const xiaohongshu = capabilities.find((capability) => capability.command === 'xiaohongshu');
  assert.ok(xiaohongshu);
  assert.equal(xiaohongshu.operations.length, 13);
  assert.ok(xiaohongshu.operations.includes('datasets'));
  assert.ok(xiaohongshu.operations.includes('describe-dataset'));
  assert.ok(xiaohongshu.operations.includes('query-dataset'));
  for (const name of ['datasets', 'describe-dataset', 'query-dataset'] as const) {
    const detail: (typeof xiaohongshu.operationDetails)[number] | undefined =
      xiaohongshu.operationDetails.find((candidate) => candidate.operation === name);
    assert.deepEqual(detail?.permissions, ['analytics.xiaohongshu.view']);
    assert.deepEqual(detail?.guards, ['role-permission']);
    assert.equal(detail?.confirmation, 'none');
  }
});

test('operation guards stay reconciled with explicit Controller endpoint contracts', () => {
  const result = runCli(['capabilities']);
  assert.equal(result.status, 0, result.stderr);
  const capabilities = JSON.parse(result.stdout) as Array<{
    command: string;
    operationDetails: Array<{
      operation: string;
      permissions: string[];
      guards: string[];
      risk: string;
      confirmation: string;
      conditionalPolicy?: {
        selector: string;
        cases: Record<string, { risk: string; confirmation: string }>;
        dryRunConfirmation: string;
      };
    }>;
  }>;
  const operation = (command: string, name: string) => {
    const capability = capabilities.find((candidate) => candidate.command === command);
    assert.ok(capability, `missing capability ${command}`);
    const detail = capability.operationDetails.find((candidate) => candidate.operation === name);
    assert.ok(detail, `missing operation ${command}.${name}`);
    return detail;
  };

  // Controlled source snapshot: the capability policy below is intentionally tied to concrete
  // Controller decorators/routes instead of merely checking command-level guard unions.
  const webEvents = fs.readFileSync(
    path.join(repoRoot, 'apps/server/src/modules/web-events/web-events.controller.ts'),
    'utf8'
  );
  assert.match(
    webEvents,
    /@Get\(\)\s+[\s\S]*?@RequirePermission\(\{ module: 'analytics', menu: 'web', action: 'view' \}\)/
  );
  assert.match(
    webEvents,
    /@Get\(':id'\)\s+[\s\S]*?@RequirePermission\(\{ module: 'analytics', menu: 'web', action: 'view' \}\)/
  );
  assert.match(webEvents, /@Post\('archive'\)\s+[\s\S]*?@RequirePermission\(\{ module: 'analytics', menu: 'web', action: 'delete' \}\)/);
  assert.match(webEvents, /@Post\('archive'\)\s+[\s\S]*?@RequireFreshJwt\(\)/);
  assert.deepEqual(operation('web-events', 'list').guards, ['role-permission']);
  assert.deepEqual(operation('web-events', 'get').guards, ['role-permission']);
  assert.deepEqual(operation('web-events', 'archive').guards, ['fresh-jwt', 'role-permission']);
  assert.deepEqual(operation('web-events', 'archive').permissions, ['analytics.web.delete']);

  const employees = fs.readFileSync(
    path.join(repoRoot, 'apps/server/src/modules/employees/employees.controller.ts'),
    'utf8'
  );
  assert.match(employees, /@Put\(':id\/dingtalk-binding'\)\s+[\s\S]*?@RequirePermission\(\{ module: 'organization', menu: 'employees', action: 'edit' \}\)/);
  assert.match(employees, /@Put\(':id\/dingtalk-binding'\)\s+[\s\S]*?@RequireFreshJwt\(\)/);
  assert.match(employees, /@Delete\(':id\/dingtalk-binding'\)\s+[\s\S]*?@RequirePermission\(\{ module: 'organization', menu: 'employees', action: 'edit' \}\)/);
  assert.match(employees, /@Delete\(':id\/dingtalk-binding'\)\s+[\s\S]*?@RequireFreshJwt\(\)/);
  const freshJwtGuard = fs.readFileSync(
    path.join(repoRoot, 'apps/server/src/modules/auth/guards/fresh-jwt.guard.ts'),
    'utf8'
  );
  assert.match(freshJwtGuard, /assertFreshJwtAuthentication\(user\)/);
  for (const name of ['bind-dingtalk', 'unbind-dingtalk']) {
    assert.deepEqual(operation('employees', name).guards, ['fresh-jwt', 'role-permission']);
    assert.deepEqual(operation('employees', name).permissions, ['organization.employees.edit']);
    assert.equal(operation('employees', name).confirmation, 'yes');
  }

  const customers = fs.readFileSync(
    path.join(repoRoot, 'apps/server/src/modules/customers/customers.controller.ts'),
    'utf8'
  );
  assert.match(
    customers,
    /@Post\('duplicate-check'\)[\s\S]*?@RequirePermission\(\{ module: 'crm', menu: 'customers', action: 'view' \}\)/
  );
  assert.match(
    customers,
    /@Patch\('batch-update'\)[\s\S]*?@RequirePermission\(\{ module: 'crm', menu: 'customers', action: 'edit' \}\)/
  );
  assert.match(
    customers,
    /@Delete\('batch'\)[\s\S]*?@RequirePermission\(\{ module: 'crm', menu: 'customers', action: 'delete' \}\)/
  );

  const users = fs.readFileSync(
    path.join(repoRoot, 'apps/server/src/modules/users/users.controller.ts'),
    'utf8'
  );
  const createUserEndpoint = users.slice(users.indexOf('@Post()'), users.indexOf('@Get()'));
  assert.match(createUserEndpoint, /action: 'create'/);
  assert.match(createUserEndpoint, /assertFreshJwtAuthentication\(user\)/);
  const changePasswordEndpoint = users.slice(users.indexOf("@Patch('me/password')"));
  assert.doesNotMatch(changePasswordEndpoint, /@RequirePermission\(/);

  const customerContracts = [
    ['list', 'view', 'none'],
    ['get', 'view', 'none'],
    ['create', 'create', 'none'],
    ['update', 'edit', 'none'],
    ['delete', 'delete', 'yes'],
    ['restore', 'edit', 'none'],
    ['claim', 'edit', 'none'],
    ['trash', 'view', 'none'],
    ['duplicate-check', 'view', 'none'],
    ['batch-transfer', 'edit', 'yes'],
    ['batch-update', 'edit', 'yes'],
    ['batch-add-collaborators', 'edit', 'yes'],
    ['batch-remove-collaborators', 'edit', 'yes'],
    ['batch-delete', 'delete', 'yes'],
    ['permanent-delete', 'delete', 'yes'],
    ['correct-lead-stage', 'edit', 'preview-then-yes'],
    ['set-lead-stage', 'edit', 'none'],
    ['submit-lead-stage-change', 'edit', 'none'],
    ['update-lead-progress', 'edit', 'none'],
  ] as const;
  for (const [name, action, confirmation] of customerContracts) {
    const detail = operation('customers', name);
    assert.deepEqual(detail.permissions, [`crm.customers.${action}`], `customers.${name}`);
    assert.deepEqual(detail.guards, ['role-permission'], `customers.${name}`);
    assert.equal(detail.confirmation, confirmation, `customers.${name}`);
  }

  const userContracts = [
    ['list', 'view', ['role-permission'], 'none'],
    ['get', 'view', ['role-permission'], 'none'],
    ['create', 'create', ['fresh-jwt', 'role-permission'], 'none'],
    ['update', 'edit', ['fresh-jwt', 'role-permission'], 'none'],
    ['delete', 'delete', ['fresh-jwt', 'role-permission'], 'yes'],
    ['update-status', 'edit', ['fresh-jwt', 'role-permission'], 'conditional'],
    ['list-all', 'view', ['role-permission'], 'none'],
  ] as const;
  for (const [name, action, guards, confirmation] of userContracts) {
    const detail = operation('users', name);
    assert.deepEqual(detail.permissions, [`system.user_account.${action}`], `users.${name}`);
    assert.deepEqual(detail.guards, guards, `users.${name}`);
    assert.equal(detail.confirmation, confirmation, `users.${name}`);
  }
  assert.deepEqual(operation('users', 'update-status'), {
    operation: 'update-status',
    permissions: ['system.user_account.edit'],
    guards: ['fresh-jwt', 'role-permission'],
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
  });
  assert.deepEqual(operation('users', 'change-password'), {
    operation: 'change-password',
    permissions: [],
    guards: ['authenticated'],
    risk: 'admin',
    confirmation: 'none',
  });
});
