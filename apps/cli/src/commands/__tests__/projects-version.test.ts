import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RELATED_ID = '22222222-2222-4222-8222-222222222222';

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('项目关联与成员删除 dry-run 透传乐观锁 version', () => {
  const cases = [
    {
      args: [
        'projects',
        'link-sale-order',
        PROJECT_ID,
        '--sale-order-id',
        RELATED_ID,
        '--version',
        '3',
        '--dry-run',
      ],
      expected: {
        method: 'POST',
        path: `/projects/${PROJECT_ID}/sale-orders`,
        body: { saleOrderId: RELATED_ID, version: 3 },
      },
    },
    {
      args: [
        'projects',
        'unlink-sale-order',
        PROJECT_ID,
        RELATED_ID,
        '--version',
        '4',
        '--dry-run',
      ],
      expected: {
        method: 'DELETE',
        path: `/projects/${PROJECT_ID}/sale-orders/${RELATED_ID}`,
        query: { version: 4 },
      },
    },
    {
      args: ['projects', 'remove-member', PROJECT_ID, RELATED_ID, '--version', '5', '--dry-run'],
      expected: {
        method: 'DELETE',
        path: `/projects/${PROJECT_ID}/members/${RELATED_ID}`,
        query: { version: 5 },
      },
    },
  ] as const;

  for (const { args, expected } of cases) {
    const result = runCli([...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
});

test('项目关联与成员删除缺失或非法 version 会在发请求前失败', () => {
  for (const args of [
    ['projects', 'link-sale-order', PROJECT_ID, '--sale-order-id', RELATED_ID, '--dry-run'],
    ['projects', 'unlink-sale-order', PROJECT_ID, RELATED_ID, '--dry-run'],
    ['projects', 'remove-member', PROJECT_ID, RELATED_ID, '--dry-run'],
  ]) {
    const result = runCli(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /required option '--version <n>' not specified/);
  }

  const invalid = runCli([
    'projects',
    'unlink-sale-order',
    PROJECT_ID,
    RELATED_ID,
    '--version',
    '1.5',
    '--dry-run',
  ]);
  assert.notEqual(invalid.status, 0);
});
