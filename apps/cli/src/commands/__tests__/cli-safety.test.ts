import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const ID = '11111111-1111-4111-8111-111111111111';

function runCli(args: string[], input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      NO_COLOR: '1',
      NODE_NO_WARNINGS: '1',
      AZEROTH_TOKEN: 'test-token',
    },
  });
}

test('password never becomes an argv option and credential dry-run is recursively redacted', () => {
  const loginHelp = runCli(['login', '--help']);
  assert.equal(loginHelp.status, 0, loginHelp.stderr);
  assert.equal(loginHelp.stdout.includes('--password <'), false);
  assert.match(loginHelp.stdout, /--password-stdin/);

  const usersHelp = runCli(['users', 'create', '--help']);
  assert.equal(usersHelp.status, 0, usersHelp.stderr);
  assert.equal(usersHelp.stdout.includes('--password <'), false);

  const secret = 'StrongPass1';
  const dryRun = runCli(
    ['users', 'create', '--json', '-', '--dry-run'],
    JSON.stringify({
      username: 'agent_user',
      password: secret,
      employeeId: ID,
      roleIds: [ID],
    })
  );
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.doesNotMatch(dryRun.stdout, new RegExp(secret));
  assert.equal(JSON.parse(dryRun.stdout).body.password, '[REDACTED]');
});

test('format, ID, integer, enum and timezone boundaries fail before HTTP', () => {
  const cases: string[][] = [
    ['--format', 'yaml', 'entities'],
    ['approvals', 'get', 'x/y?admin=true'],
    ['approvals', 'pending', '--page', '1x'],
    ['departments', 'list-employees', ID, '--page-size', '0'],
    ['crm-products', 'trash', '--page', '1e2'],
    ['activities', 'list', '--customer-id', ID, '--since', '2026-08-24T12:00:00'],
    ['activities', 'list', '--customer-id', ID, '--format', 'yaml'],
    ['approvals', 'pending', '--status', 'maybe'],
  ];
  for (const args of cases) {
    const result = runCli(args);
    assert.notEqual(result.status, 0, args.join(' '));
    const envelope = JSON.parse(result.stderr);
    assert.ok(['USAGE', 'VALIDATION'].includes(envelope.error.code), result.stderr);
    assert.equal(envelope.error.retryable, false);
  }
});

test('sale-order void-preview is exposed and validates ID before request', () => {
  const help = runCli(['sale-orders', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /void-preview/);

  const invalid = runCli(['sale-orders', 'void-preview', '../bad']);
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.match(invalid.stderr, /canonical UUID/);
});

test('destructive and batch write help exposes dry-run + yes gates', () => {
  for (const args of [
    ['sale-orders', 'batch-delete', '--help'],
    ['payroll', 'commit-import', '--help'],
    ['payroll', 'batch-delete', '--help'],
    ['customers', 'delete', '--help'],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--dry-run/);
    assert.match(result.stdout, /--yes/);
  }
});
