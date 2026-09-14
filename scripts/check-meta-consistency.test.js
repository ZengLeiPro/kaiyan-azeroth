const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-meta-consistency.js');

function createFixture(workspaceScripts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-consistency-fixture-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, '.husky'), { recursive: true });
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/example/src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/server/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      private: true,
      packageManager: 'pnpm@11.17.0',
      engines: { pnpm: '>=11.17.0' },
      scripts: {
        lint: 'turbo run lint',
        typecheck: 'turbo run typecheck',
        test: 'turbo run test',
        'test:gates': 'node --test --test-concurrency=1 scripts/check-*.test.js',
        build: 'turbo run build',
        'check:sample': 'node scripts/check-sample.js',
        'check:all':
          'pnpm run check:sample && pnpm run test:gates && pnpm --filter @fixture/server exec prisma validate',
      },
    })
  );
  fs.writeFileSync(
    path.join(root, 'turbo.json'),
    JSON.stringify({ tasks: { lint: {}, typecheck: {}, test: {}, build: {} } })
  );
  fs.writeFileSync(
    path.join(root, 'rules.md'),
    '| `check-sample.js` | `pnpm run check:sample` | fixture | 是 |\n| （内置） | `prisma validate` | fixture | 是 |\n'
  );
  fs.writeFileSync(path.join(root, 'README.md'), 'NestJS 11 / Prisma 6.19 / pnpm >=11.17.0\n');
  fs.writeFileSync(
    path.join(root, '.husky/pre-commit'),
    'pnpm run check:all || exit 1\npnpm run test || exit 1\npnpm run build || exit 1\n'
  );
  fs.writeFileSync(
    path.join(root, '.github/workflows/quality-gate.yml'),
    'steps:\n  - name: checks\n    run: pnpm run check:all\n  - name: test\n    run: pnpm run test\n  - name: build\n    run: pnpm run build\n'
  );
  fs.writeFileSync(path.join(root, 'scripts/check-sample.js'), 'process.exit(0);\n');
  fs.writeFileSync(
    path.join(root, 'scripts/check-sample.test.js'),
    "require('node:test')('ok', () => {});\n"
  );
  fs.writeFileSync(
    path.join(root, 'apps/example/package.json'),
    JSON.stringify({ name: '@fixture/example', private: true, scripts: workspaceScripts })
  );
  fs.writeFileSync(path.join(root, 'apps/example/src/index.test.ts'), 'export {};\n');
  fs.writeFileSync(
    path.join(root, 'apps/server/package.json'),
    JSON.stringify({
      name: '@fixture/server',
      private: true,
      scripts: validTasks,
      dependencies: { '@nestjs/core': '^11.0.0', prisma: '^6.19.2' },
    })
  );
  fs.writeFileSync(path.join(root, 'apps/server/src/index.test.ts'), 'export {};\n');
  return root;
}

function runGate(root) {
  return spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, META_CONSISTENCY_ROOT: root },
  });
}

const validTasks = {
  lint: 'eslint .',
  typecheck: 'tsc --noEmit',
  test: 'node --test src/index.test.ts',
  build: 'tsc',
};

test('all workspace required tasks and unfiltered root coverage pass', () => {
  const root = createFixture(validTasks);
  try {
    const result = runGate(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate fixtures require an independent root test:gates wired exactly once into check:all', () => {
  const root = createFixture(validTasks);
  try {
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    delete packageJson.scripts['test:gates'];
    packageJson.scripts['check:all'] =
      'pnpm run check:sample && pnpm --filter @fixture/server exec prisma validate';
    fs.writeFileSync(packagePath, JSON.stringify(packageJson));

    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /root test:gates 必须为/);
    assert.match(result.stdout + result.stderr, /check:all 必须且只能执行一次 pnpm run test:gates/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gate fixtures must run serially because fixture suites mutate shared repository paths', () => {
  const root = createFixture(validTasks);
  try {
    const packagePath = path.join(root, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    packageJson.scripts['test:gates'] = 'node --test scripts/check-*.test.js';
    fs.writeFileSync(packagePath, JSON.stringify(packageJson));

    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /--test-concurrency=1/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a workspace missing lint fails meta-consistency', () => {
  const { lint: _lint, ...missingLint } = validTasks;
  const root = createFixture(missingLint);
  try {
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /@fixture\/example: 缺少 required task lint/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an always-success test placeholder fails meta-consistency', () => {
  const root = createFixture({ ...validTasks, test: 'true' });
  try {
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /禁止永远成功的占位命令/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quality-gate and pre-commit must invoke unfiltered root test/build scripts', () => {
  const root = createFixture(validTasks);
  try {
    fs.writeFileSync(
      path.join(root, '.github/workflows/quality-gate.yml'),
      'steps:\n  - run: pnpm --filter @fixture/server test\n  - run: pnpm run build\n'
    );
    fs.writeFileSync(
      path.join(root, '.husky/pre-commit'),
      'pnpm run test || exit 1\npnpm --filter @fixture/server build || exit 1\n'
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /quality-gate\.yml: 必须执行根 `pnpm run check:all`/
    );
    assert.match(
      result.stdout + result.stderr,
      /quality-gate\.yml: 必须执行无 filter 的 `pnpm run test`/
    );
    assert.match(
      result.stdout + result.stderr,
      /.husky\/pre-commit: 必须执行无 filter 的 `pnpm run build`/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
