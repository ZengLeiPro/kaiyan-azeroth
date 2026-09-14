#!/usr/bin/env node
/**
 * Seed 文件禁止使用原生 SQL 检查脚本
 *
 * 目标（CLAUDE.md MUST #9.4）：
 * - Seed 文件中禁止使用 $queryRaw / $queryRawUnsafe / $executeRaw / $executeRawUnsafe
 * - 无例外：Seed 的所有操作都可以通过 Prisma Client API 实现
 *
 * 检测范围：
 * - apps/server/prisma/seed.ts
 * - apps/server/prisma/seeds/ 下所有 .ts 文件
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const SEED_DIR = path.join(__dirname, '../apps/server/prisma/seeds');
const SEED_ENTRY = path.join(__dirname, '../apps/server/prisma/seed.ts');

// 检测模式：所有原生 SQL 调用
const RAW_SQL_PATTERNS = [
  { regex: /\.\$queryRaw\b/, message: '使用 $queryRaw' },
  { regex: /\.\$queryRawUnsafe\b/, message: '使用 $queryRawUnsafe' },
  { regex: /\.\$executeRaw\b/, message: '使用 $executeRaw' },
  { regex: /\.\$executeRawUnsafe\b/, message: '使用 $executeRawUnsafe' },
];

const errors = [];
let checkedFiles = 0;

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 跳过注释行
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
      continue;
    }

    for (const pattern of RAW_SQL_PATTERNS) {
      if (pattern.regex.test(line)) {
        errors.push({
          file: path.relative(process.cwd(), filePath),
          line: lineNum,
          message: `${pattern.message}: ${trimmedLine.slice(0, 100)}`,
        });
      }
    }
  }

  checkedFiles++;
}

function findFiles(dir, extensions) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findFiles(fullPath, extensions));
    } else if (item.isFile()) {
      const ext = path.extname(item.name);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function main() {
  console.log('检查 Seed 文件原生 SQL 使用情况...\n');

  const files = [];

  // 入口文件
  if (fs.existsSync(SEED_ENTRY)) {
    files.push(SEED_ENTRY);
  }

  // seeds 目录下的所有 .ts 文件
  files.push(...findFiles(SEED_DIR, ['.ts']));

  if (files.length === 0) {
    console.log('未找到 Seed 文件');
    process.exit(0);
  }

  for (const file of files) {
    checkFile(file);
  }

  console.log(`已检查 ${checkedFiles} 个 Seed 文件\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  Seed 文件的所有操作必须使用 Prisma Client API（create/upsert/findFirst 等）。');
    console.log('  Seed 中禁止使用原生 SQL，无例外。');
    console.log('  参考规范：CLAUDE.md 第 9.4 节');
    process.exit(1);
  }

  console.log('Seed 文件原生 SQL 检查通过！');
  process.exit(0);
}

main();
