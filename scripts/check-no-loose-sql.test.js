const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { checkRepository } = require('./check-no-loose-sql.js');

const BATCH = '20260823135000_employee_primary_department_unique';
const REQUIRED_FILES = ['README.md', 'audit.sql', 'migration.sql', 'verify.sql', 'rollback.sql'];

function write(root, relativePath, content = '-- fixture\n') {
  const filePath = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createValidRepositoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-loose-sql-'));
  write(root, 'apps/server/prisma/contract-migrations/README.md', '# contract\n');
  for (const fileName of REQUIRED_FILES) {
    write(root, `apps/server/prisma/contract-migrations/${BATCH}/${fileName}`);
  }
  write(root, 'apps/server/prisma/migrations/20260824000000_expand_only/migration.sql');
  return root;
}

function withFixture(callback) {
  const root = createValidRepositoryFixture();
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('允许严格命名且五文件齐全的 contract 批次', () => {
  withFixture((root) => {
    assert.deepEqual(checkRepository(root), {
      contractIssues: [],
      offenders: [],
      scanIssues: [],
    });
  });
});

test('拒绝缺失 verify.sql 的 contract 批次', () => {
  withFixture((root) => {
    fs.rmSync(path.join(root, 'apps/server/prisma/contract-migrations', BATCH, 'verify.sql'));
    const result = checkRepository(root);
    assert.ok(result.contractIssues.some((issue) => issue.includes('verify.sql')));
  });
});

test('拒绝 contract 批次中的额外 SQL', () => {
  withFixture((root) => {
    write(
      root,
      `apps/server/prisma/contract-migrations/${BATCH}/repair.sql`,
      'UPDATE business_data SET value = 1;\n'
    );
    const result = checkRepository(root);
    assert.ok(result.contractIssues.some((issue) => issue.includes('repair.sql')));
    assert.ok(result.offenders.some((filePath) => filePath.endsWith('/repair.sql')));
  });
});

test('拒绝异常批次路径下的 SQL', () => {
  withFixture((root) => {
    const validBatchPath = path.join(root, 'apps/server/prisma/contract-migrations', BATCH);
    const invalidBatchPath = path.join(
      root,
      'apps/server/prisma/contract-migrations',
      '20260823-bad-slug'
    );
    fs.renameSync(validBatchPath, invalidBatchPath);
    const result = checkRepository(root);
    assert.ok(result.contractIssues.some((issue) => issue.includes('20260823-bad-slug')));
    assert.ok(result.offenders.some((filePath) => filePath.endsWith('/audit.sql')));
  });
});

test('拒绝 contract 外的散落 SQL，同时仍允许 Prisma migration.sql', () => {
  withFixture((root) => {
    write(root, 'scripts/new-data-fix.sql', 'DELETE FROM business_data;\n');
    const result = checkRepository(root);
    assert.deepEqual(result.contractIssues, []);
    assert.deepEqual(result.offenders, ['scripts/new-data-fix.sql']);
  });
});
