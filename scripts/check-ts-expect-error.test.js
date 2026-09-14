const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-ts-expect-error.js');

function withFixture(content, assertion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-expect-error-fixture-'));
  const workspace = path.join(root, 'packages/new-tool');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: '@fixture/new-tool', private: true })
  );
  fs.writeFileSync(path.join(workspace, 'src/index.ts'), content);
  try {
    assertion(
      spawnSync(process.execPath, [GATE], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, TS_EXPECT_ERROR_ROOT: root },
      })
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('a described ts-expect-error in a newly added workspace passes', () => {
  withFixture(
    '// @ts-expect-error: fixture verifies the policy\nconst value: string = 1;\n',
    (result) => {
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  );
});

test('a bare ts-expect-error in a newly added workspace fails', () => {
  withFixture('// @ts-expect-error\nconst value: string = 1;\n', (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /packages\/new-tool\/src\/index\.ts:1/);
  });
});

test('ts-ignore in a newly added workspace fails', () => {
  withFixture(
    '// @ts-ignore: forbidden even with a reason\nconst value: string = 1;\n',
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /禁用 @ts-ignore/);
    }
  );
});
