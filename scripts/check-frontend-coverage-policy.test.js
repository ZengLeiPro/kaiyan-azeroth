const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  checkChangedCoverage,
  evaluateChangedCoverage,
  parseUnifiedDiff,
  runPolicy,
} = require('./check-frontend-coverage-policy');

function linesByFile(changed) {
  return Object.fromEntries([...changed].map(([file, lines]) => [file, [...lines]]));
}

function runGit(root, args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))
  );
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function createGitFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-changed-coverage-'));
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'fixture@example.com']);
  runGit(root, ['config', 'user.name', 'Fixture']);
  assert.equal(
    fs.realpathSync(runGit(root, ['rev-parse', '--show-toplevel'])),
    fs.realpathSync(root)
  );
  return root;
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

test('解析 unified=0 diff，仅保留 ts/tsx 的新增与修改后行号', () => {
  const diff = [
    'diff --git a/apps/web/src/lib/a.ts b/apps/web/src/lib/a.ts',
    '--- a/apps/web/src/lib/a.ts',
    '+++ b/apps/web/src/lib/a.ts',
    '@@ -2 +2,2 @@',
    '-old',
    '+new',
    '+added',
    'diff --git a/apps/web/src/页面/card.tsx b/apps/web/src/页面/card.tsx',
    '--- a/apps/web/src/页面/card.tsx',
    '+++ b/apps/web/src/页面/card.tsx',
    '@@ -10,2 +10 @@',
    '-old one',
    '-old two',
    '+new one',
    'diff --git a/apps/web/src/deleted.ts b/apps/web/src/deleted.ts',
    '--- a/apps/web/src/deleted.ts',
    '+++ /dev/null',
    '@@ -1,3 +0,0 @@',
    'diff --git a/apps/web/readme.md b/apps/web/readme.md',
    '--- a/apps/web/readme.md',
    '+++ b/apps/web/readme.md',
    '@@ -1 +1 @@',
  ].join('\n');

  assert.deepEqual(linesByFile(parseUnifiedDiff(diff)), {
    'apps/web/src/lib/a.ts': [2, 3],
    'apps/web/src/页面/card.tsx': [10],
  });
});

test('coverage statementMap 只把 changed 可执行行计入分母，纯类型与不可执行行不误报', () => {
  const changed = new Map([
    ['apps/web/src/feature.ts', new Set([1, 2, 3, 4, 5, 6])],
    ['apps/web/src/deleted.ts', new Set()],
  ]);
  const coverage = {
    '/fixture/apps/web/src/feature.ts': {
      statementMap: {
        0: { start: { line: 2, column: 0 }, end: { line: 3, column: 10 } },
        1: { start: { line: 5, column: 0 }, end: { line: 5, column: 20 } },
      },
      s: { 0: 1, 1: 0 },
    },
  };

  const result = evaluateChangedCoverage(changed, coverage, 50);
  assert.equal(result.executable, 3);
  assert.equal(result.covered, 2);
  assert.ok(Math.abs(result.percentage - 200 / 3) < Number.EPSILON * 100);
  assert.equal(result.passed, true);
  assert.deepEqual(result.uncovered, ['apps/web/src/feature.ts:5']);
  assert.deepEqual(result.missingCoverageFiles, []);
});

test('changed-line threshold 在边界通过，低于明确阈值失败', () => {
  const changed = new Map([['apps/web/src/feature.ts', new Set([1, 2])]]);
  const coverage = {
    'C:\\fixture\\apps\\web\\src\\feature.ts': {
      statementMap: {
        0: { start: { line: 1 }, end: { line: 1 } },
        1: { start: { line: 2 }, end: { line: 2 } },
      },
      s: { 0: 1, 1: 0 },
    },
  };

  assert.equal(evaluateChangedCoverage(changed, coverage, 50).passed, true);
  assert.equal(evaluateChangedCoverage(changed, coverage, 50.01).passed, false);
});

test('真实 git merge-base + diff 映射 changed executable lines', () => {
  const root = createGitFixture();
  try {
    write(
      root,
      'apps/web/src/feature.ts',
      ['export type Only = string;', 'export function value() {', '  return 1;', '}'].join('\n')
    );
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'base']);
    const base = runGit(root, ['rev-parse', 'HEAD']);

    write(
      root,
      'apps/web/src/feature.ts',
      [
        'export type Only = number;',
        'export function value() {',
        '  return 2;',
        '}',
        'export const uncovered = 3;',
      ].join('\n')
    );
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'head']);

    const detailPath = path.join(root, 'coverage-final.json');
    fs.writeFileSync(
      detailPath,
      JSON.stringify({
        [path.join(root, 'apps/web/src/feature.ts')]: {
          statementMap: {
            0: { start: { line: 3 }, end: { line: 3 } },
            1: { start: { line: 5 }, end: { line: 5 } },
          },
          s: { 0: 1, 1: 0 },
        },
      })
    );

    const result = checkChangedCoverage({
      repoRoot: root,
      detailPath,
      env: {
        FRONTEND_COVERAGE_BASE_REF: base,
        FRONTEND_COVERAGE_REQUIRE_CHANGED: 'true',
        FRONTEND_COVERAGE_CHANGED_LINES_MIN: '80',
      },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.changedFiles, 1);
    assert.equal(result.executable, 2);
    assert.equal(result.covered, 1);
    assert.deepEqual(result.uncovered, ['apps/web/src/feature.ts:5']);
    assert.equal(result.mergeBase, base);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PR 无 base fail-closed；仅非 PR 无 base 明确降级', () => {
  const required = checkChangedCoverage({
    repoRoot: process.cwd(),
    detailPath: '/not-needed.json',
    env: { GITHUB_EVENT_NAME: 'pull_request' },
  });
  assert.equal(required.status, 'error');
  assert.match(required.message, /必须提供 GITHUB_BASE_REF/);

  const local = checkChangedCoverage({
    repoRoot: process.cwd(),
    detailPath: '/not-needed.json',
    env: {},
  });
  assert.equal(local.status, 'skipped');
  assert.match(local.message, /未声称已检查/);
});

test('显式 base 无法解析时始终 fail-closed', () => {
  const root = createGitFixture();
  try {
    write(root, 'README.md', 'fixture\n');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'base']);
    const result = checkChangedCoverage({
      repoRoot: root,
      detailPath: '/not-needed.json',
      env: { FRONTEND_COVERAGE_BASE_REF: 'missing-base' },
    });
    assert.equal(result.status, 'error');
    assert.match(result.message, /merge-base.*fail-closed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createPolicyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-coverage-policy-'));
  const source = 'apps/web/src/lib/feature.ts';
  write(root, source, 'export const feature = 1;\n');
  write(
    root,
    'apps/web/coverage/coverage-summary.json',
    JSON.stringify({
      total: {
        statements: { pct: 20 },
        branches: { pct: 20 },
        functions: { pct: 20 },
        lines: { pct: 20 },
      },
      [path.join(root, source)]: {
        statements: { pct: 100 },
        branches: { pct: 100 },
        functions: { pct: 100 },
        lines: { pct: 100 },
      },
    })
  );
  return { root, source };
}

function policyEnv(root) {
  return {
    FRONTEND_COVERAGE_REPO_ROOT: root,
    FRONTEND_COVERAGE_ALLOWED_GAPS: '999',
  };
}

test('baseline 缺失或结构为空时 fail-closed', () => {
  const { root } = createPolicyFixture();
  try {
    assert.equal(runPolicy(policyEnv(root)), 1);
    write(root, 'apps/web/coverage-baseline.json', '{}');
    assert.equal(runPolicy(policyEnv(root)), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('baseline 指标非法或仍存在的源文件缺少当前 summary 时 fail-closed', () => {
  const { root, source } = createPolicyFixture();
  try {
    write(
      root,
      'apps/web/coverage-baseline.json',
      JSON.stringify({
        total: { statements: 20, branches: 20, functions: 20, lines: Number.NaN },
        files: { [source]: { lines: 100 } },
      })
    );
    assert.equal(runPolicy(policyEnv(root)), 1);

    write(
      root,
      'apps/web/coverage-baseline.json',
      JSON.stringify({
        total: { statements: 20, branches: 20, functions: 20, lines: 20 },
        files: { 'apps/web/src/lib/missing-from-summary.ts': { lines: 100 } },
      })
    );
    write(root, 'apps/web/src/lib/missing-from-summary.ts', 'export const missing = true;\n');
    assert.equal(runPolicy(policyEnv(root)), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('新增源文件必须同时进入 baseline 和当前 coverage summary', () => {
  const { root, source } = createPolicyFixture();
  try {
    write(root, 'apps/web/src/hooks/new-hook.ts', 'export const newHook = () => true;\n');
    write(
      root,
      'apps/web/coverage-baseline.json',
      JSON.stringify({
        total: { statements: 20, branches: 20, functions: 20, lines: 20 },
        files: { [source]: { lines: 100 } },
      })
    );

    assert.equal(runPolicy(policyEnv(root)), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
