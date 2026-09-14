#!/usr/bin/env node
/**
 * 禁止散落 SQL，并校验受控 contract migration 目录。
 *
 * 允许的 SQL 仅有：
 *   1. apps/server/prisma/migrations/<batch>/migration.sql（Prisma 自动 deploy 链）
 *   2. apps/server/prisma/contract-migrations/<14位时间>_<slug>/ 下严格四件套
 *   3. ALLOWLIST 中的测试初始化 / 已执行历史审计文件
 *
 * contract 目录绝不属于 prisma migrate deploy 或任何自动发布 workflow；本门禁只校验仓库
 * 结构，不执行其中 SQL。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PRISMA_MIGRATION_SQL_RE = /^apps\/server\/prisma\/migrations\/[^/]+\/migration\.sql$/;
const CONTRACT_ROOT_POSIX = 'apps/server/prisma/contract-migrations';
const CONTRACT_BATCH_NAME_RE = /^\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CONTRACT_BATCH_FILES = new Set([
  'README.md',
  'audit.sql',
  'migration.sql',
  'verify.sql',
  'rollback.sql',
]);
const CONTRACT_SQL_FILES = new Set(['audit.sql', 'migration.sql', 'verify.sql', 'rollback.sql']);

// 不得新增数据迁移/回填类条目；新数据治理必须使用 TS + Prisma Client API。
const ALLOWLIST = new Set(['docker/init-test-db.sql']);

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  'coverage',
  '.pnpm-store',
  '.browser-data',
]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function inspectContractMigrations(root) {
  const contractRoot = path.join(root, ...CONTRACT_ROOT_POSIX.split('/'));
  const issues = [];
  const allowedSql = new Set();

  if (!fs.existsSync(contractRoot)) return { issues, allowedSql };

  const rootStat = fs.lstatSync(contractRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    issues.push(`${CONTRACT_ROOT_POSIX}: 必须是普通目录，禁止符号链接`);
    return { issues, allowedSql };
  }

  const rootEntries = fs.readdirSync(contractRoot, { withFileTypes: true });
  const rootReadme = rootEntries.find((entry) => entry.name === 'README.md');
  if (!rootReadme || !rootReadme.isFile() || rootReadme.isSymbolicLink()) {
    issues.push(`${CONTRACT_ROOT_POSIX}/README.md: 根目录规则说明缺失或不是普通文件`);
  }

  for (const entry of rootEntries) {
    const entryPath = `${CONTRACT_ROOT_POSIX}/${entry.name}`;
    if (entry.name === 'README.md') continue;

    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !CONTRACT_BATCH_NAME_RE.test(entry.name)
    ) {
      issues.push(`${entryPath}: 仅允许 <14位时间>_<lower_snake_case_slug> 普通批次目录`);
      continue;
    }

    const batchPath = path.join(contractRoot, entry.name);
    const batchEntries = fs.readdirSync(batchPath, { withFileTypes: true });
    const byName = new Map(batchEntries.map((batchEntry) => [batchEntry.name, batchEntry]));
    let validBatch = true;

    for (const expectedName of CONTRACT_BATCH_FILES) {
      const expectedEntry = byName.get(expectedName);
      if (!expectedEntry || !expectedEntry.isFile() || expectedEntry.isSymbolicLink()) {
        issues.push(`${entryPath}/${expectedName}: 必需文件缺失或不是普通文件`);
        validBatch = false;
      }
    }

    for (const batchEntry of batchEntries) {
      if (!CONTRACT_BATCH_FILES.has(batchEntry.name)) {
        issues.push(
          `${entryPath}/${batchEntry.name}: 批次只能包含 README + audit/migration/verify/rollback 四件套`
        );
        validBatch = false;
      }
    }

    if (validBatch) {
      for (const sqlName of CONTRACT_SQL_FILES) {
        allowedSql.add(`${entryPath}/${sqlName}`);
      }
    }
  }

  return { issues, allowedSql };
}

function findLooseSql(root, allowedContractSql) {
  const offenders = [];
  const scanIssues = [];

  function walk(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      scanIssues.push(
        `${toPosix(path.relative(root, directory)) || '.'}: 无法读取目录（${error.message}）`
      );
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = toPosix(path.relative(root, fullPath));

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.sql')) continue;
      if (PRISMA_MIGRATION_SQL_RE.test(relativePath)) continue;
      if (allowedContractSql.has(relativePath)) continue;
      if (ALLOWLIST.has(relativePath)) continue;
      offenders.push(relativePath);
    }
  }

  walk(root);
  return { offenders: offenders.sort(), scanIssues };
}

function checkRepository(root = ROOT) {
  const contract = inspectContractMigrations(root);
  const looseSql = findLooseSql(root, contract.allowedSql);
  return {
    contractIssues: contract.issues,
    offenders: looseSql.offenders,
    scanIssues: looseSql.scanIssues,
  };
}

function main() {
  console.log('正在检查散落 SQL 与受控 contract migration 目录...\n');
  const result = checkRepository(ROOT);
  const failures = [...result.scanIssues, ...result.contractIssues];

  if (result.offenders.length > 0) {
    failures.push(...result.offenders.map((filePath) => `${filePath}: 不在允许的 SQL 路径中`));
  }

  if (failures.length > 0) {
    console.error('检查失败：');
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('\n普通 schema 变更请使用 Prisma migration；数据治理请使用 TS + Prisma Client。');
    console.error('Contract DDL 只能使用严格五文件批次目录，且不得接入 migrate deploy/workflow。');
    process.exitCode = 1;
    return;
  }

  console.log('检查通过：未发现散落 SQL，contract migration 目录结构完整。');
}

module.exports = {
  CONTRACT_BATCH_FILES,
  CONTRACT_BATCH_NAME_RE,
  checkRepository,
  findLooseSql,
  inspectContractMigrations,
};

if (require.main === module) {
  main();
}
