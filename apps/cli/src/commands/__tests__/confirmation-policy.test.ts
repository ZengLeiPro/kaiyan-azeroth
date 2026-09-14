import assert from 'node:assert/strict';
import { type ChildProcess, fork, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));
const recorderPath = fileURLToPath(new URL('./fixtures/http-recorder.mjs', import.meta.url));
const ID = '11111111-1111-4111-8111-111111111111';

type RecordedCall = { method: string; url: string; body?: Record<string, unknown> };

function nextMessage<T>(child: ChildProcess, type: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      child.off('message', onMessage);
      reject(error);
    };
    const onMessage = (message: unknown) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== type
      ) {
        return;
      }
      child.off('error', onError);
      child.off('message', onMessage);
      resolve(message as T);
    };
    child.once('error', onError);
    child.on('message', onMessage);
  });
}

async function calls(child: ChildProcess): Promise<RecordedCall[]> {
  const pending = nextMessage<{ type: 'calls'; calls: RecordedCall[] }>(child, 'calls');
  child.send({ type: 'get-calls' });
  return (await pending).calls;
}

function runCli(args: string[], apiUrl: string, input?: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      NO_COLOR: '1',
      AZEROTH_TOKEN: 'test-token',
      AZEROTH_API_URL: apiUrl,
      AZEROTH_HTTP_TIMEOUT_MS: '1000',
    },
  });
}

test('command confirmation policies reject before HTTP and preserve status-specific behavior', async (t) => {
  const recorder = fork(recorderPath, { silent: true });
  t.after(() => {
    recorder.disconnect();
    recorder.kill();
  });
  const { port } = await nextMessage<{ type: 'ready'; port: number }>(recorder, 'ready');
  const apiUrl = `http://127.0.0.1:${port}`;

  const correctionArgs = [
    'customers',
    'correct-lead-stage',
    ID,
    '--stage',
    'SQL',
    '--qualified-at',
    '2026-08-25T06:00:00Z',
    '--version',
    '3',
    '--reason',
    '修正历史导入数据',
  ];
  const missingCorrectionYes = runCli(correctionArgs, apiUrl);
  assert.notEqual(missingCorrectionYes.status, 0);
  assert.match(missingCorrectionYes.stderr, /Missing --yes/);
  assert.equal((await calls(recorder)).length, 0);

  const correctionDryRun = runCli([...correctionArgs, '--dry-run'], apiUrl);
  assert.equal(correctionDryRun.status, 0, correctionDryRun.stderr);
  assert.equal(JSON.parse(correctionDryRun.stdout).method, 'PATCH');
  assert.equal((await calls(recorder)).length, 0);

  const correctionConfirmed = runCli([...correctionArgs, '--yes'], apiUrl);
  assert.equal(correctionConfirmed.status, 0, correctionConfirmed.stderr);
  assert.deepEqual(JSON.parse(correctionConfirmed.stdout), { success: true });

  const disabledViaJson = runCli(
    ['users', 'update-status', ID, '--json', '-'],
    apiUrl,
    JSON.stringify({ status: 'disabled' })
  );
  assert.notEqual(disabledViaJson.status, 0);
  assert.match(disabledViaJson.stderr, /Missing --yes/);
  assert.equal((await calls(recorder)).length, 1);

  const disabledDryRun = runCli(
    ['users', 'update-status', ID, '--status', 'disabled', '--dry-run'],
    apiUrl
  );
  assert.equal(disabledDryRun.status, 0, disabledDryRun.stderr);
  assert.equal(JSON.parse(disabledDryRun.stdout).body.status, 'disabled');
  assert.equal((await calls(recorder)).length, 1);

  const activeWithoutYes = runCli(['users', 'update-status', ID, '--status', 'active'], apiUrl);
  assert.equal(activeWithoutYes.status, 0, activeWithoutYes.stderr);

  const disabledConfirmed = runCli(
    ['users', 'update-status', ID, '--status', 'disabled', '--yes'],
    apiUrl
  );
  assert.equal(disabledConfirmed.status, 0, disabledConfirmed.stderr);

  assert.deepEqual(await calls(recorder), [
    {
      method: 'PATCH',
      url: `/api/v1/customers/${ID}/lead-stage-correction`,
      body: {
        leadStage: 'SQL',
        leadStageQualifiedAt: '2026-08-25T06:00:00Z',
        reason: '修正历史导入数据',
        version: 3,
      },
    },
    {
      method: 'PATCH',
      url: `/api/v1/users/${ID}/status`,
      body: { status: 'active' },
    },
    {
      method: 'PATCH',
      url: `/api/v1/users/${ID}/status`,
      body: { status: 'disabled' },
    },
  ]);
});

test('help states preview and status-conditional confirmation contracts', () => {
  const correctionHelp = runCli(
    ['customers', 'correct-lead-stage', '--help'],
    'http://127.0.0.1:9'
  );
  assert.equal(correctionHelp.status, 0, correctionHelp.stderr);
  assert.match(correctionHelp.stdout, /--dry-run\s+预览请求路径与请求体/);
  assert.match(correctionHelp.stdout, /--yes\s+确认执行修正（请先用 --dry-run 预览/);

  const statusHelp = runCli(['users', 'update-status', '--help'], 'http://127.0.0.1:9');
  assert.equal(statusHelp.status, 0, statusHelp.stderr);
  assert.match(statusHelp.stdout, /禁用会吊销目标用户的全部 session\/PAT/);
  assert.match(statusHelp.stdout, /--yes\s+确认禁用并吊销全部凭据/);
});
