import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { discoverEntities } from '../../registry.js';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('registry 驱动的 CAS DELETE 实体都注册 version capability', () => {
  const entities = discoverEntities();
  for (const command of [
    'payments',
    'invoices',
    'payroll',
    'keep-records',
    'visit-records',
    'sale-orders',
    'opportunities',
    'projects',
    'project-tickets',
    'effort-records',
  ]) {
    assert.equal(entities.get(command)?.deleteRequiresVersion, true, command);
  }
});

test('versioned delete dry-run 输出正整数 version query（含 Payroll）', () => {
  for (const command of [
    'payments',
    'payroll',
    'customers',
    'projects',
    'project-tickets',
    'effort-records',
  ] as const) {
    const result = runCli([command, 'delete', ENTITY_ID, '--version', '3', '--dry-run']);

    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout), {
      method: 'DELETE',
      path: `/${command}/${ENTITY_ID}`,
      query: { version: 3 },
    });
  }
});

test('versioned delete 缺失或非法 version 会在发请求前失败', () => {
  for (const command of [
    'invoices',
    'payroll',
    'keep-records',
    'visit-records',
    'sale-orders',
    'customers',
    'projects',
    'project-tickets',
    'effort-records',
  ]) {
    const missing = runCli([command, 'delete', ENTITY_ID, '--dry-run']);
    assert.notEqual(missing.status, 0, command);
    assert.match(missing.stderr, /required option '--version <n>' not specified/);
  }

  for (const invalid of ['0', '-1', '1.5', 'abc']) {
    const result = runCli([
      'opportunities',
      'delete',
      ENTITY_ID,
      '--version',
      invalid,
      '--dry-run',
    ]);
    assert.notEqual(result.status, 0, `version=${invalid} should fail`);
  }
});

test('delete help 展示 version/dry-run，Customer 也强制透传 version query', () => {
  for (const command of ['payroll', 'customers']) {
    const help = runCli([command, 'delete', '--help']);
    assert.equal(help.status, 0, `${command}: ${help.stderr}`);
    assert.match(help.stdout, /--version <n>/);
    assert.match(help.stdout, /--dry-run/);
  }

  const customer = runCli(['customers', 'delete', ENTITY_ID, '--version', '6', '--dry-run']);
  assert.equal(customer.status, 0, customer.stderr);
  assert.deepEqual(JSON.parse(customer.stdout), {
    method: 'DELETE',
    path: `/customers/${ENTITY_ID}`,
    query: { version: 6 },
  });
});
