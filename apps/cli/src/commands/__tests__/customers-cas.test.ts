import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID_2 = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333';
const NO_HTTP_ENV = {
  AZEROTH_TOKEN: 'test-token',
  AZEROTH_API_URL: 'http://127.0.0.1:9',
  AZEROTH_HTTP_TIMEOUT_MS: '50',
};

function runCli(args: string[], input?: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    input,
    env: { ...process.env, NO_COLOR: '1', ...extraEnv },
  });
}

test('customers update 必须从 flag 或 JSON 读取真实正整数 version', () => {
  const valid = runCli(
    ['customers', 'update', CUSTOMER_ID, '--json', '-', '--dry-run'],
    JSON.stringify({ customerName: '更新客户', version: 3 })
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), {
    method: 'PUT',
    path: `/customers/${CUSTOMER_ID}`,
    body: { customerName: '更新客户', version: 3 },
  });

  const fromFlags = runCli([
    'customers',
    'update',
    CUSTOMER_ID,
    '--customer-name',
    'flag 更新',
    '--version',
    '4',
    '--dry-run',
  ]);
  assert.equal(fromFlags.status, 0, fromFlags.stderr);
  assert.deepEqual(JSON.parse(fromFlags.stdout).body, {
    customerName: 'flag 更新',
    version: 4,
  });

  for (const body of [
    { customerName: '缺版本' },
    { customerName: '错误类型', version: '3' },
    { customerName: 123, version: 3 },
    { customerName: '禁写阶段', leadStage: 'SQL', version: 3 },
    { version: 0 },
    { version: 1.5 },
  ]) {
    const invalid = runCli(
      ['customers', 'update', CUSTOMER_ID, '--json', '-', '--dry-run'],
      JSON.stringify(body)
    );
    assert.notEqual(invalid.status, 0, JSON.stringify(body));
    assert.match(invalid.stderr, /Validation failed|乐观锁版本号/);
  }

  const junkVersion = runCli([
    'customers',
    'update',
    CUSTOMER_ID,
    '--customer-name',
    '更新客户',
    '--version',
    '3junk',
    '--dry-run',
  ]);
  assert.notEqual(junkVersion.status, 0);
  assert.match(junkVersion.stderr, /Invalid --version/);
});

test('Customer 非法 update 在进入 HTTP client 前失败', () => {
  const invalid = runCli(
    ['customers', 'update', CUSTOMER_ID, '--json', '-'],
    JSON.stringify({ leadStage: 'SQL', version: 3 }),
    NO_HTTP_ENV
  );

  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Validation failed for customers update body/);
  assert.doesNotMatch(invalid.stderr, /Request failed|ECONNREFUSED|127\.0\.0\.1/);
});

test('crud create 也在 dry-run 前执行 shared schema', () => {
  const invalid = runCli(
    ['customers', 'create', '--json', '-', '--dry-run'],
    JSON.stringify({ customerName: 123 })
  );

  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Validation failed for customers create body/);
  assert.equal(invalid.stdout, '');
});

test('crud dry-run 输出 shared schema parse 后的 body，并保留合法 decimal', () => {
  const result = runCli(
    ['payments', 'update', PAYMENT_ID, '--json', '-', '--dry-run'],
    JSON.stringify({ paymentAmount: '3.14', version: 2 })
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    method: 'PUT',
    path: `/payments/${PAYMENT_ID}`,
    body: { paymentAmount: 3.14, version: 2 },
  });
});

test('customers claim/restore/permanent-delete 都必须携带正整数 version body', () => {
  const claim = runCli(['customers', 'claim', CUSTOMER_ID, '--version', '4', '--dry-run']);
  assert.equal(claim.status, 0, claim.stderr);
  assert.deepEqual(JSON.parse(claim.stdout), {
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/claim`,
    body: { version: 4 },
  });

  const restore = runCli(['customers', 'restore', CUSTOMER_ID, '--version', '5', '--dry-run']);
  assert.equal(restore.status, 0, restore.stderr);
  assert.deepEqual(JSON.parse(restore.stdout), {
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/restore`,
    body: { version: 5 },
  });

  const permanent = runCli([
    'customers',
    'permanent-delete',
    CUSTOMER_ID,
    '--version',
    '6',
    '--dry-run',
  ]);
  assert.equal(permanent.status, 0, permanent.stderr);
  assert.deepEqual(JSON.parse(permanent.stdout), {
    method: 'DELETE',
    path: `/customers/${CUSTOMER_ID}/permanent`,
    body: { version: 6 },
  });

  for (const command of ['claim', 'restore', 'permanent-delete']) {
    const missing = runCli(['customers', command, CUSTOMER_ID, '--dry-run']);
    assert.notEqual(missing.status, 0, command);
    assert.match(missing.stderr, /required option '--version <n>' not specified/);
  }
});

test('customers 五类 batch dry-run 透传 ids/versions 精确映射', () => {
  const scenarios = [
    ['batch-transfer', { chargerId: 'emp-new' }],
    ['batch-update', { patch: { customerLevel: 'A' } }],
    ['batch-add-collaborators', { collaboratorIds: ['emp-collab'] }],
    ['batch-remove-collaborators', { collaboratorIds: ['emp-collab'] }],
    ['batch-delete', {}],
  ] as const;

  for (const [command, extra] of scenarios) {
    const body = {
      ids: [CUSTOMER_ID, CUSTOMER_ID_2],
      versions: { [CUSTOMER_ID]: 2, [CUSTOMER_ID_2]: 5 },
      ...extra,
    };
    const result = runCli(['customers', command, '--json', '-', '--dry-run'], JSON.stringify(body));
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout).body, body);
  }
});

test('customers 五类 batch 非 dry-run 统一要求 --yes，且 help 明示确认开关', () => {
  const scenarios = [
    ['batch-transfer', { chargerId: 'emp-new' }],
    ['batch-update', { patch: { customerLevel: 'A' } }],
    ['batch-add-collaborators', { collaboratorIds: ['emp-collab'] }],
    ['batch-remove-collaborators', { collaboratorIds: ['emp-collab'] }],
    ['batch-delete', {}],
  ] as const;

  for (const [command, extra] of scenarios) {
    const body = {
      ids: [CUSTOMER_ID],
      versions: { [CUSTOMER_ID]: 2 },
      ...extra,
    };
    const missing = runCli(
      ['customers', command, '--json', '-'],
      JSON.stringify(body),
      NO_HTTP_ENV
    );
    assert.notEqual(missing.status, 0, command);
    assert.match(missing.stderr, /Missing --yes/);
    assert.doesNotMatch(missing.stderr, /Request failed|ECONNREFUSED|127\.0\.0\.1/);

    const help = runCli(['customers', command, '--help']);
    assert.equal(help.status, 0, `${command}: ${help.stderr}`);
    assert.match(help.stdout, /--yes\s+确认执行批量变更（非 dry-run 时必填）/);
  }
});

test('customers batch 在发请求前拒绝缺漏、额外及非法 version', () => {
  for (const body of [
    { ids: [CUSTOMER_ID] },
    { ids: [CUSTOMER_ID, CUSTOMER_ID_2], versions: { [CUSTOMER_ID]: 1 } },
    { ids: [CUSTOMER_ID], versions: { [CUSTOMER_ID]: 1, [CUSTOMER_ID_2]: 2 } },
    { ids: [CUSTOMER_ID], versions: { [CUSTOMER_ID]: 0 } },
  ]) {
    const result = runCli(
      ['customers', 'batch-delete', '--json', '-', '--dry-run'],
      JSON.stringify(body)
    );
    assert.notEqual(result.status, 0, JSON.stringify(body));
  }
});

test('所有 CRUD/Customer path id 先拒绝非 UUID，且不会触发 HTTP', () => {
  const scenarios: Array<{ args: string[]; input?: string }> = [
    { args: ['customers', 'get', '../'] },
    {
      args: ['customers', 'update', 'a/b', '--json', '-'],
      input: JSON.stringify({ customerName: 'x', version: 1 }),
    },
    { args: ['customers', 'delete', 'x?admin=true', '--version', '1'] },
    { args: ['customers', 'restore', '   ', '--version', '1'] },
    { args: ['customers', 'claim', 'customer-1', '--version', '1'] },
    {
      args: ['customers', 'permanent-delete', '../x', '--version', '1', '--yes'],
    },
    {
      args: ['customers', 'update-lead-progress', '/x', '--json', '-'],
      input: JSON.stringify({ status: 'ACTIVE', version: 1 }),
    },
  ];

  for (const scenario of scenarios) {
    const result = runCli(scenario.args, scenario.input, NO_HTTP_ENV);
    assert.notEqual(result.status, 0, scenario.args.join(' '));
    assert.match(result.stderr, /Invalid .* id/);
    assert.doesNotMatch(result.stderr, /Request failed|ECONNREFUSED|127\.0\.0\.1/);
  }
});

test('数字 flag 在 Number() 前拒绝空白，并按分页/version 语义拒绝 0、负数与 Infinity', () => {
  const whitespace = runCli([
    'payments',
    'update',
    PAYMENT_ID,
    '--payment-amount',
    '   ',
    '--version',
    '2',
    '--dry-run',
  ]);
  assert.notEqual(whitespace.status, 0);
  assert.match(whitespace.stderr, /Whitespace is not a number/);

  for (const page of ['0', '-1', 'Infinity']) {
    const result = runCli(['customers', 'list', '--page', page], undefined, NO_HTTP_ENV);
    assert.notEqual(result.status, 0, page);
    assert.doesNotMatch(result.stderr, /Request failed|ECONNREFUSED|127\.0\.0\.1/);
  }

  for (const version of ['0', '-1', 'Infinity', ' ']) {
    const result = runCli(['customers', 'restore', CUSTOMER_ID, '--version', version, '--dry-run']);
    assert.notEqual(result.status, 0, version);
  }
});

test('动态 Zod 整数 flag 在 dry-run/HTTP 前拒绝十六进制、科学计数和超 safe integer', () => {
  for (const version of ['0x3', '3e0', '9007199254740992']) {
    const result = runCli(
      [
        'customers',
        'update',
        CUSTOMER_ID,
        '--customer-name',
        '不会发送',
        '--version',
        version,
        '--dry-run',
      ],
      undefined,
      NO_HTTP_ENV
    );

    assert.notEqual(result.status, 0, version);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Invalid --version|Expected safe integer/);
    assert.doesNotMatch(result.stderr, /Request failed|ECONNREFUSED|127\.0\.0\.1/);
  }
});

test('旧 set-lead-stage 命令名不再发无版本 PUT，改走统一审批入口', () => {
  const result = runCli([
    'customers',
    'set-lead-stage',
    CUSTOMER_ID,
    '--stage',
    'SQL',
    '--version',
    '7',
    '--dry-run',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    method: 'POST',
    path: `/customers/${CUSTOMER_ID}/lead-stage-change-request`,
    body: { leadStage: 'SQL', version: 7 },
  });
});
