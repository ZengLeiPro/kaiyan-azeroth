const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-no-any.js');

function createFixture(relativePath, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-any-fixture-'));
  const file = path.join(root, relativePath);
  const [group, workspace] = relativePath.split('/');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    path.join(root, group, workspace, 'package.json'),
    JSON.stringify({ name: `@fixture/${workspace}`, private: true })
  );
  fs.writeFileSync(file, content);
  return root;
}

function runGate(root) {
  return spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_ANY_ROOT: root },
  });
}

function withFixture(relativePath, content, assertion) {
  const root = createFixture(relativePath, content);
  try {
    assertion(runGate(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('clean CLI test fixture passes', () => {
  withFixture('apps/cli/src/example.test.ts', 'const value: unknown = 1;\n', (result) => {
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

test('CLI test files are scanned for explicit any', () => {
  withFixture('apps/cli/src/example.test.ts', 'const value = {} as any;\n', (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /apps\/cli\/src\/example\.test\.ts:1/);
    assert.match(result.stdout, /使用 as any 类型断言/);
  });
});

test('a newly added production workspace is scanned without changing the gate', () => {
  withFixture('packages/new-tool/src/index.ts', 'export type Unsafe = any;\n', (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /packages\/new-tool\/src\/index\.ts:1/);
  });
});

test('an inline ts directive cannot hide explicit any', () => {
  withFixture(
    'apps/server/src/example.ts',
    'const value = {} as any; // @ts-expect-error: fixture\n',
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /使用 as any 类型断言/);
    }
  );
});
