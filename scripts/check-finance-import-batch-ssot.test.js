const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-finance-import-batch-ssot.js');
const FILES = [
  'packages/shared/src/schemas/finance-import.ts',
  'packages/shared/src/types/finance-import-batch.ts',
  'apps/server/src/modules/finance/import/finance-import.controller.ts',
  'apps/server/src/modules/finance/import/services/finance-import.service.ts',
  'apps/server/src/modules/finance/import/services/finance-import-batch.mapper.ts',
];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-import-batch-ssot-'));
  for (const relativePath of FILES) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, relativePath), target);
  }
  return root;
}

function mutate(root, relativePath, transform) {
  const file = path.join(root, relativePath);
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
}

function runGate(root) {
  return spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, FINANCE_IMPORT_BATCH_SSOT_ROOT: root },
  });
}

function withFixture(assertion) {
  const root = createFixture();
  try {
    assertion(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('current FinanceImportBatch schema-derived contract passes', () => {
  withFixture((root) => {
    const result = runGate(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

test('a same-entity hand-written response interface is rejected in SSOT files', () => {
  withFixture((root) => {
    mutate(
      root,
      FILES[0],
      (content) => `${content}\nexport interface FinanceImportBatchResponse { id: string }\n`
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /禁止为同实体手写 response interface/);
  });
});

test('response schema field drift is rejected', () => {
  withFixture((root) => {
    mutate(root, FILES[0], (content) =>
      content.replace('  personalRows: z.number().int(),', '  driftedRows: z.number().int(),')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /response schema 字段漂移/);
    assert.match(result.stderr, /personalRows/);
    assert.match(result.stderr, /driftedRows/);
  });
});

test('a response type no longer inferred from the schema is rejected', () => {
  withFixture((root) => {
    mutate(root, FILES[0], (content) =>
      content.replace(
        'export type FinanceImportBatchResponse = z.infer<typeof financeImportBatchResponseSchema>;',
        'export type FinanceImportBatchResponse = { id: string };'
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /必须直接由 z\.infer/);
  });
});

test('controller double assertions cannot bypass the mapped response contract', () => {
  withFixture((root) => {
    mutate(root, FILES[2], (content) =>
      content.replace(
        'return this.service.getBatch(id);',
        'return this.service.getBatch(id) as unknown as Promise<FinanceImportBatchResponse>;'
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /禁止使用 as unknown as 双断言/);
  });
});
