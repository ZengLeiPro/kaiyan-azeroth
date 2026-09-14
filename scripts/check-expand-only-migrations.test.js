const test = require('node:test');
const assert = require('node:assert/strict');

const { findContractOperations } = require('./check-expand-only-migrations.js');

test('允许新增可空列、表，以及新表自身的强约束和唯一索引', () => {
  const sql = `
    CREATE TABLE "new_items" ("id" UUID PRIMARY KEY);
    ALTER TABLE "customers" ADD COLUMN "memo" TEXT;
    CREATE INDEX "customers_memo_idx" ON "customers"("memo");
    CREATE UNIQUE INDEX "new_items_id_key" ON "new_items"("id");
    ALTER TABLE "new_items" ADD CONSTRAINT "new_items_owner_fkey"
      FOREIGN KEY ("id") REFERENCES "employees"("id");
  `;
  assert.deepEqual(findContractOperations(sql), []);
});

test('拒绝 contract 操作和会破坏旧代码写入的强约束', () => {
  const sql = `
    ALTER TABLE "customers" DROP COLUMN "legacy";
    ALTER TABLE "customers" ADD COLUMN "required" TEXT NOT NULL;
    CREATE UNIQUE INDEX "uniq_required" ON "customers"("required");
  `;
  const rules = findContractOperations(sql).map((issue) => issue.rule);
  assert.ok(rules.includes('删除表、列、类型、视图或 schema'));
  assert.ok(rules.includes('新增无默认值的 NOT NULL 列'));
  assert.ok(rules.includes('在旧代码仍运行时新增唯一索引'));
});

test('忽略注释和字符串中的危险关键词，但拒绝真实 DML', () => {
  const sql = `
    -- DROP TABLE "customers";
    /* ALTER TABLE "customers" DROP COLUMN "name"; */
    INSERT INTO "notes" ("content") VALUES ('DELETE FROM customers');
  `;
  const rules = findContractOperations(sql).map((issue) => issue.rule);
  assert.deepEqual(rules, ['迁移中写入存量业务数据']);
});

test('拒绝 UPDATE、过程块与显式锁表', () => {
  const sql = `
    LOCK TABLE "customers" IN SHARE MODE;
    UPDATE "customers" SET "name" = 'x';
    DO $migration$ BEGIN RAISE NOTICE 'x'; END $migration$;
  `;
  const rules = findContractOperations(sql).map((issue) => issue.rule);
  assert.ok(rules.includes('迁移中写入存量业务数据'));
  assert.ok(rules.includes('迁移中执行过程块'));
  assert.ok(rules.includes('迁移中显式锁表'));
});
