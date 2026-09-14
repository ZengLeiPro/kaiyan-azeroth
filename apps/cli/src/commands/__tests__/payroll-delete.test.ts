import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('payroll batch-delete help 明确 ids + versions 版本化契约', () => {
  const result = runCli(['payroll', 'batch-delete', '--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--ids <id\.\.\.>/);
  assert.match(result.stdout, /--versions <json>/);
  assert.match(result.stdout, /--json <path>/);
  assert.match(result.stdout, /--dry-run/);
});

test('payroll batch-delete dry-run 消费与 ids 一一对应的版本映射', () => {
  const versions = { [ID_1]: 3, [ID_2]: 8 };
  const result = runCli([
    'payroll',
    'batch-delete',
    '--ids',
    ID_1,
    ID_2,
    '--versions',
    JSON.stringify(versions),
    '--dry-run',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    method: 'POST',
    path: '/payroll/batch-delete',
    body: { ids: [ID_1, ID_2], versions },
  });
});

test('payroll batch-delete 禁止 ids-only、缺漏/额外键及非法版本', () => {
  const idsOnly = runCli(['payroll', 'batch-delete', '--ids', ID_1, '--dry-run']);
  assert.notEqual(idsOnly.status, 0);
  assert.match(idsOnly.stderr, /Missing --ids \+ --versions or --json/);

  for (const versions of [
    { [ID_1]: 1 },
    { [ID_1]: 1, [ID_2]: 0 },
    { [ID_1]: 1, [ID_2]: 1, '33333333-3333-4333-8333-333333333333': 2 },
  ]) {
    const result = runCli([
      'payroll',
      'batch-delete',
      '--ids',
      ID_1,
      ID_2,
      '--versions',
      JSON.stringify(versions),
      '--dry-run',
    ]);
    assert.notEqual(result.status, 0, JSON.stringify(versions));
    assert.match(result.stderr, /Invalid --ids\/--versions/);
  }

  const invalidJson = runCli([
    'payroll',
    'batch-delete',
    '--ids',
    ID_1,
    '--versions',
    '{bad-json',
    '--dry-run',
  ]);
  assert.notEqual(invalidJson.status, 0);
  assert.match(invalidJson.stderr, /Invalid JSON for --versions/);
});
