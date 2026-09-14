#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'apps/server/prisma/migrations');
const BASELINE_PATH = path.join(ROOT, 'config/migration-history-baseline.json');
const MIGRATION_PATH_RE = /^apps\/server\/prisma\/migrations\/[^/]+\/migration\.sql$/;

function stripSqlCommentsAndStrings(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
}

function normalizeTableName(identifier) {
  return identifier.split('.').at(-1).replaceAll('"', '').trim().toLowerCase();
}

function findContractOperations(sql) {
  const normalized = stripSqlCommentsAndStrings(sql);
  const statements = normalized
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const issues = [];
  const createdTables = new Set(
    [
      ...normalized.matchAll(
        /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)/gi
      ),
    ].map((match) => normalizeTableName(match[1]))
  );
  const rules = [
    ['删除表、列、类型、视图或 schema', /\bDROP\s+(?:TABLE|COLUMN|TYPE|VIEW|SCHEMA)\b/i],
    ['重命名表或列', /\bRENAME\s+(?:COLUMN|TO)\b/i],
    ['修改列类型', /\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i],
    ['把现有列改为 NOT NULL', /\bALTER\s+COLUMN\b[\s\S]*\bSET\s+NOT\s+NULL\b/i],
    ['删除列默认值', /\bALTER\s+COLUMN\b[\s\S]*\bDROP\s+DEFAULT\b/i],
    ['清空或删除存量数据', /\b(?:TRUNCATE|DELETE\s+FROM)\b/i],
    ['迁移中写入存量业务数据', /\b(?:INSERT\s+INTO|UPDATE|MERGE\s+INTO)\b/i],
    ['迁移中执行过程块', /\bDO\s+\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/i],
    ['迁移中显式锁表', /\bLOCK\s+TABLE\b/i],
    ['在旧代码仍运行时新增强约束', /\bADD\s+CONSTRAINT\b/i],
    ['在旧代码仍运行时新增唯一索引', /\bCREATE\s+UNIQUE\s+INDEX\b/i],
  ];

  for (const statement of statements) {
    for (const [rule, pattern] of rules) {
      if (pattern.test(statement)) {
        const targetMatch =
          rule === '在旧代码仍运行时新增强约束'
            ? statement.match(
                /\bALTER\s+TABLE\s+(?:ONLY\s+)?((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)/i
              )
            : rule === '在旧代码仍运行时新增唯一索引'
              ? statement.match(/\bON\s+((?:"[^"]+"|\w+)(?:\s*\.\s*(?:"[^"]+"|\w+))?)/i)
              : null;
        if (targetMatch?.[1] && createdTables.has(normalizeTableName(targetMatch[1]))) {
          continue;
        }
        issues.push({ rule, statement });
      }
    }
    if (
      /\bADD\s+COLUMN\b[\s\S]*\bNOT\s+NULL\b/i.test(statement) &&
      !/\bDEFAULT\b/i.test(statement)
    ) {
      issues.push({
        rule: '新增无默认值的 NOT NULL 列',
        statement,
      });
    }
  }
  return issues;
}

function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      filePath: path.join(MIGRATIONS_DIR, entry.name, 'migration.sql'),
      repoPath: `apps/server/prisma/migrations/${entry.name}/migration.sql`,
    }))
    .filter((entry) => fs.existsSync(entry.filePath))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function historyDigest(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file.repoPath);
    hash.update('\0');
    hash.update(fs.readFileSync(file.filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveBaseRef(requested) {
  const candidates = [];
  if (requested && !/^0+$/.test(requested)) candidates.push(requested);
  candidates.push('HEAD~1');

  for (const candidate of candidates) {
    try {
      git(['rev-parse', '--verify', `${candidate}^{commit}`]);
      return candidate;
    } catch {
      // 继续尝试下一个可用基线。
    }
  }
  // 公开候选仓首个根提交或尚未 git init 时没有 parent，只校验历史摘要与新迁移 SQL。
  return null;
}

function changedMigrationEntries(base) {
  const trackedChanges = git(['diff', '--name-status', '--find-renames', base]);
  const untrackedMigrations = git(['ls-files', '--others', '--exclude-standard'])
    .split('\n')
    .filter((filePath) => MIGRATION_PATH_RE.test(filePath))
    .map((filePath) => `A\t${filePath}`)
    .join('\n');
  return [trackedChanges, untrackedMigrations]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter(Boolean);
}

function main() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const files = migrationFiles();
  const historicalFiles = files.filter((file) => file.name <= baseline.through);
  const failures = [];
  const actualDigest = historyDigest(historicalFiles);
  if (actualDigest !== baseline.sha256) {
    failures.push(
      `已发布迁移历史摘要不匹配（截至 ${baseline.through}）：禁止修改、删除或插入旧迁移`
    );
  }

  const base = resolveBaseRef(process.env.MIGRATION_BASE_REF);
  if (base) {
    for (const line of changedMigrationEntries(base)) {
      const [status, ...paths] = line.split('\t');
      const migrationPaths = paths.filter((filePath) => MIGRATION_PATH_RE.test(filePath));
      if (migrationPaths.length > 0 && status !== 'A') {
        failures.push(
          `${migrationPaths.join(', ')}: 已提交迁移不可修改、删除或重命名（状态 ${status}）`
        );
      }
    }
  }

  for (const file of files.filter((entry) => entry.name > baseline.through)) {
    const sql = fs.readFileSync(file.filePath, 'utf8');
    for (const issue of findContractOperations(sql)) {
      failures.push(`${file.repoPath}: ${issue.rule}\n  ${issue.statement.slice(0, 240)}`);
    }
  }

  if (failures.length > 0) {
    console.error('迁移兼容性检查失败：自动发布只允许 expand 迁移。');
    console.error('contract 操作必须在旧代码完全退出后，通过独立人工发布批次执行。\n');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `迁移兼容性检查通过：历史摘要固定，相对 ${base ?? '无 Git 父提交'} 无已提交迁移改写，` +
      `${files.length - historicalFiles.length} 个新迁移仅含 schema expand`
  );
}

module.exports = {
  findContractOperations,
  changedMigrationEntries,
  historyDigest,
  resolveBaseRef,
  stripSqlCommentsAndStrings,
};

if (require.main === module) {
  main();
}
