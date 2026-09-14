const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-production-env-mapping.js');
const VARIABLE = 'SUPER_ADMIN_EMPLOYEE_ID';

function runGate(root) {
  return spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, PRODUCTION_ENV_MAPPING_ROOT: root },
  });
}

function withRoot(setup, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'public-env-mapping-fixture-'));
  try {
    setup(root);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('无生产部署文件且示例声明保护锁时通过', () => {
  withRoot(
    (root) => {
      fs.writeFileSync(path.join(root, '.env.example'), `${VARIABLE}=\n`);
    },
    (root) => {
      const result = runGate(root);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  );
});

test('出现生产 workflow 时阻断', () => {
  withRoot(
    (root) => {
      fs.writeFileSync(path.join(root, '.env.example'), `${VARIABLE}=\n`);
      fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
      fs.writeFileSync(path.join(root, '.github/workflows/backend-pipeline.yml'), 'name: prod\n');
    },
    (root) => {
      const result = runGate(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /backend-pipeline.yml/);
    }
  );
});

test('示例环境缺少保护锁变量时阻断', () => {
  withRoot(
    (root) => {
      fs.writeFileSync(path.join(root, '.env.example'), 'JWT_SECRET=change-me\n');
    },
    (root) => {
      const result = runGate(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /SUPER_ADMIN_EMPLOYEE_ID/);
    }
  );
});
