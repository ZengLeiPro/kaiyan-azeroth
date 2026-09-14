import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const clientModule = path.join(projectRoot, 'src/client.ts');
const utilsModule = path.join(projectRoot, 'src/utils.ts');

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'tester',
  status: 'active',
  roles: [],
  employee: null,
};

function createHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'azeroth-cli-refresh-'));
  const configDir = path.join(home, '.azeroth-cli');
  mkdirSync(configDir, { mode: 0o700 });
  writeFileSync(
    path.join(configDir, 'auth.json'),
    JSON.stringify({
      accessToken: 'access-0',
      refreshToken: 'refresh-0',
      expiresAt: Date.now() - 1,
      user: { id: user.id, username: user.username },
    }),
    { mode: 0o600 }
  );
  chmodSync(configDir, 0o700);
  return home;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function runClient(
  home: string,
  port: number,
  script: string
): Promise<{ status: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--eval', script], {
      cwd: projectRoot,
      env: {
        ...process.env,
        HOME: home,
        AZEROTH_API_URL: `http://127.0.0.1:${port}`,
        AZEROTH_TOKEN: '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('close', (status) => resolve({ status: status ?? -1, stderr }));
  });
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`等待测试信号超时: ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('两个进程并发刷新只轮换一次并共同使用新代际', async (t) => {
  const home = createHome();
  let refreshCount = 0;
  const server = createServer((req, res) => {
    if (req.url === '/api/v1/auth/refresh') {
      refreshCount += 1;
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresIn: 3600,
            user,
          })
        );
      }, 80);
      return;
    }
    if (req.url === '/api/v1/probe' && req.headers.authorization === 'Bearer access-1') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 401;
    res.end('{}');
  });
  const port = await listen(server);
  t.after(() => server.close());
  const script = `import { request } from ${JSON.stringify(clientModule)};
    const result = await request('GET', '/probe');
    if (result.ok !== true) process.exit(2);`;

  const results = await Promise.all([runClient(home, port, script), runClient(home, port, script)]);
  assert.deepEqual(
    results.map((result) => result.status),
    [0, 0],
    results.map((result) => result.stderr).join('\n')
  );
  assert.equal(refreshCount, 1);
  const auth = JSON.parse(readFileSync(path.join(home, '.azeroth-cli/auth.json'), 'utf8'));
  assert.equal(auth.refreshToken, 'refresh-1');
});

test('refresh 的 503 是可重试错误且保留本地凭据', async (t) => {
  const home = createHome();
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end('{}');
  });
  const port = await listen(server);
  t.after(() => server.close());
  const script = `import { request } from ${JSON.stringify(clientModule)};
    import { CliError } from ${JSON.stringify(utilsModule)};
    try { await request('GET', '/probe'); process.exit(2); }
    catch (error) {
      if (!(error instanceof CliError) || !error.retryable || error.code !== 'TEMPORARY_FAILURE') process.exit(3);
    }`;

  const result = await runClient(home, port, script);
  assert.equal(result.status, 0, result.stderr);
  const auth = JSON.parse(readFileSync(path.join(home, '.azeroth-cli/auth.json'), 'utf8'));
  assert.equal(auth.refreshToken, 'refresh-0');
});

test('旧 access token 的迟到 401 不得删除已轮换的新代际凭据', async (t) => {
  const home = createHome();
  const authFile = path.join(home, '.azeroth-cli/auth.json');
  const auth = JSON.parse(readFileSync(authFile, 'utf8'));
  auth.expiresAt = Date.now() + 3_600_000;
  writeFileSync(authFile, JSON.stringify(auth), { mode: 0o600 });

  const server = createServer((_req, res) => {
    writeFileSync(
      authFile,
      JSON.stringify({
        ...auth,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: Date.now() + 3_600_000,
      }),
      { mode: 0o600 }
    );
    res.statusCode = 401;
    res.end('{}');
  });
  const port = await listen(server);
  t.after(() => server.close());
  const script = `import { request } from ${JSON.stringify(clientModule)};
    import { CliError } from ${JSON.stringify(utilsModule)};
    try { await request('GET', '/probe'); process.exit(2); }
    catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTHENTICATION') process.exit(3);
    }`;

  const result = await runClient(home, port, script);
  assert.equal(result.status, 0, result.stderr);
  const current = JSON.parse(readFileSync(authFile, 'utf8'));
  assert.equal(current.refreshToken, 'refresh-1');
});

test('超过 stale 阈值但持有进程仍存活时不得回收其锁', async () => {
  const home = createHome();
  const readyFile = path.join(home, 'owner-ready');
  const releaseFile = path.join(home, 'owner-release');
  const contenderAcquiredFile = path.join(home, 'contender-acquired');
  const ownerScript = `import { existsSync, writeFileSync } from 'node:fs';
    import { withAuthFileLock } from ${JSON.stringify(clientModule)};
    await withAuthFileLock(async () => {
      writeFileSync(${JSON.stringify(readyFile)}, 'ready');
      while (!existsSync(${JSON.stringify(releaseFile)})) await new Promise((resolve) => setTimeout(resolve, 20));
    });`;
  const contenderScript = `import { writeFileSync } from 'node:fs';
    import { withAuthFileLock } from ${JSON.stringify(clientModule)};
    await withAuthFileLock(async () => writeFileSync(${JSON.stringify(contenderAcquiredFile)}, 'acquired'));`;

  const owner = runClient(home, 1, ownerScript);
  await waitForFile(readyFile);
  const lockDir = path.join(home, '.azeroth-cli/.auth.lock');
  const staleTime = new Date(Date.now() - 120_000);
  utimesSync(lockDir, staleTime, staleTime);

  const contender = runClient(home, 1, contenderScript);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(existsSync(contenderAcquiredFile), false, '存活 owner 的旧 mtime 不得导致并发进入');

  writeFileSync(releaseFile, 'release');
  const [ownerResult, contenderResult] = await Promise.all([owner, contender]);
  assert.equal(ownerResult.status, 0, ownerResult.stderr);
  assert.equal(contenderResult.status, 0, contenderResult.stderr);
  assert.equal(existsSync(contenderAcquiredFile), true);
});

test('已退出 owner 的 stale 锁可被安全回收', async () => {
  const home = createHome();
  const lockDir = path.join(home, '.azeroth-cli/.auth.lock');
  const token = randomUUID();
  const deadPid = 2_147_483_647;
  const markerName = `owner-${deadPid}-${token}.json`;
  mkdirSync(lockDir, { mode: 0o700 });
  writeFileSync(path.join(lockDir, markerName), JSON.stringify({ pid: deadPid, token }), {
    mode: 0o600,
  });
  const staleTime = new Date(Date.now() - 120_000);
  utimesSync(lockDir, staleTime, staleTime);

  const script = `import { withAuthFileLock } from ${JSON.stringify(clientModule)};
    await withAuthFileLock(async () => {});`;
  const result = await runClient(home, 1, script);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(lockDir), false);
});

test('logout 必须等待正在进行的凭据更新锁并在获锁后删除', async () => {
  const home = createHome();
  const authFile = path.join(home, '.azeroth-cli/auth.json');
  const ownerReadyFile = path.join(home, 'logout-owner-ready');
  const ownerReleaseFile = path.join(home, 'logout-owner-release');
  const logoutDoneFile = path.join(home, 'logout-done');
  const ownerScript = `import { existsSync, writeFileSync } from 'node:fs';
    import { withAuthFileLock } from ${JSON.stringify(clientModule)};
    await withAuthFileLock(async () => {
      writeFileSync(${JSON.stringify(ownerReadyFile)}, 'ready');
      while (!existsSync(${JSON.stringify(ownerReleaseFile)})) await new Promise((resolve) => setTimeout(resolve, 20));
    });`;
  const logoutScript = `import { writeFileSync } from 'node:fs';
    import { logout } from ${JSON.stringify(clientModule)};
    await logout();
    writeFileSync(${JSON.stringify(logoutDoneFile)}, 'done');`;

  const owner = runClient(home, 1, ownerScript);
  await waitForFile(ownerReadyFile);
  const logout = runClient(home, 1, logoutScript);
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.equal(existsSync(authFile), true, '锁持有期间 logout 不得越过并发凭据更新');
  assert.equal(existsSync(logoutDoneFile), false, 'logout action 必须 await 获锁与删除');

  writeFileSync(ownerReleaseFile, 'release');
  const [ownerResult, logoutResult] = await Promise.all([owner, logout]);
  assert.equal(ownerResult.status, 0, ownerResult.stderr);
  assert.equal(logoutResult.status, 0, logoutResult.stderr);
  assert.equal(existsSync(authFile), false);
  assert.equal(existsSync(logoutDoneFile), true);
});
