const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-no-double-assertion.js');
const FIXTURES = path.join(__dirname, 'fixtures/no-double-assertion');

function runGate(fixture, baseline = 'baseline.json', args = []) {
  const root = path.join(FIXTURES, fixture);
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_DOUBLE_ASSERTION_ROOT: root,
      NO_DOUBLE_ASSERTION_BASELINE: path.isAbsolute(baseline)
        ? baseline
        : path.join(root, baseline),
    },
  });
}

test('an exact path + AST node baseline entry passes', () => {
  const result = runGate('existing');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /当前 1，baseline 1，新增 0/);
});

test('a new controller double assertion is zero-tolerance', () => {
  const result = runGate('new-controller');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /example\.controller\.ts:1/);
  assert.match(result.stdout, /controller 零容忍/);
});

test('test files are outside the production scan', () => {
  const result = runGate('test-only');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /当前 0，baseline 0，新增 0/);
});

test('a disappeared baseline node blocks until the baseline is explicitly pruned', () => {
  const result = runGate('vanished');
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /baseline 含已消失节点/);
  assert.match(result.stdout, /apps\/example\/src\/index\.ts/);
  assert.match(result.stdout, /--prune-baseline/);
});

test('--prune-baseline can only lower an existing baseline', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'double-assertion-baseline-'));
  const baseline = path.join(tempDir, 'baseline.json');
  fs.copyFileSync(path.join(FIXTURES, 'existing/baseline.json'), baseline);
  try {
    const result = runGate('test-only', baseline, ['--prune-baseline']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /1 -> 0/);
    assert.equal(JSON.parse(fs.readFileSync(baseline, 'utf8')).nodes.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('wildcard file exemptions are rejected', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'double-assertion-baseline-'));
  const baseline = path.join(tempDir, 'baseline.json');
  fs.writeFileSync(
    baseline,
    JSON.stringify({
      version: 1,
      nodes: [
        {
          path: 'apps/example/src/*.controller.ts',
          syntaxKind: 'AsExpression',
          nodeHash: 'a'.repeat(64),
          occurrence: 1,
        },
      ],
    })
  );
  try {
    const result = runGate('test-only', baseline);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /只允许精确“路径 \+ AST 节点”条目/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
