import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const clientModule = path.join(projectRoot, 'src/client.ts');

function runClientScript(home: string, script: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--eval', script], {
    cwd: projectRoot,
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
  });
}

test('saveAuth 原子替换并把目录/文件权限收紧为 0700/0600', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'azeroth-cli-auth-mode-'));
  const auth = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 123,
    user: { id: 'employee-1', username: 'tester' },
  };
  const result = runClientScript(
    home,
    `import { saveAuth, loadAuth } from ${JSON.stringify(clientModule)};
     const auth = ${JSON.stringify(auth)};
     saveAuth(auth);
     saveAuth({ ...auth, accessToken: 'rotated' });
     if (loadAuth()?.accessToken !== 'rotated') process.exit(2);`
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(path.join(home, '.azeroth-cli')).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(home, '.azeroth-cli/auth.json')).mode & 0o777, 0o600);
});

test('loadAuth/saveAuth 都拒绝 auth.json 符号链接', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'azeroth-cli-auth-symlink-'));
  const configDir = path.join(home, '.azeroth-cli');
  const target = path.join(home, 'outside.json');
  mkdirSync(configDir, { mode: 0o700 });
  writeFileSync(target, '{}', { mode: 0o600 });
  symlinkSync(target, path.join(configDir, 'auth.json'));

  const result = runClientScript(
    home,
    `import { loadAuth } from ${JSON.stringify(clientModule)};
     try { loadAuth(); process.exit(2); } catch (error) {
       if (!String(error).includes('符号链接')) process.exit(3);
     }`
  );

  assert.equal(result.status, 0, result.stderr);
});
