#!/usr/bin/env node
/**
 * Service 层原生 SQL 注释检查脚本
 *
 * 目标（CLAUDE.md MUST #9.5 + #11.1）：
 * - $queryRaw / $executeRaw（tagged template，Prisma 自动参数化）：必须有 @prisma-raw-sql 注释
 * - $queryRawUnsafe / $executeRawUnsafe（字符串拼接，需手动参数化）：必须有 @prisma-raw-sql-unsafe: 注释，
 *   明确说明为何需要 Unsafe 变体
 * - Seed 文件由 check-seed-no-raw-sql.js 单独检查（完全禁止原生 SQL）
 *
 * 检测范围：
 * - apps/server/src 下所有 .ts 文件（排除 seed / test / spec / d.ts 文件）
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const SERVER_SRC_DIR = path.join(__dirname, '../apps/server/src');

// 检测模式：安全的 tagged template 变体
const SAFE_RAW_SQL_PATTERNS = [
  { regex: /\.\$queryRaw\b(?!Unsafe)/, label: '$queryRaw' },
  { regex: /\.\$executeRaw\b(?!Unsafe)/, label: '$executeRaw' },
];

// 检测模式：危险的字符串拼接变体
const UNSAFE_RAW_SQL_PATTERNS = [
  { regex: /\.\$queryRawUnsafe\b/, label: '$queryRawUnsafe' },
  { regex: /\.\$executeRawUnsafe\b/, label: '$executeRawUnsafe' },
];

// 合并用于统计
const RAW_SQL_PATTERNS = [...SAFE_RAW_SQL_PATTERNS, ...UNSAFE_RAW_SQL_PATTERNS];

// 注释标记
const COMMENT_MARKER = '@prisma-raw-sql';
const UNSAFE_COMMENT_MARKER = '@prisma-raw-sql-unsafe:';

// 排除文件模式
const EXCLUDE_PATTERNS = [
  /\.spec\.ts$/,
  /\.test\.ts$/,
  /\.d\.ts$/,
  /node_modules/,
  // Seed 文件由 check-seed-no-raw-sql.js 单独检查
  /prisma[/\\]seed\.ts$/,
  /prisma[/\\]seeds[/\\]/,
];

const errors = [];
let checkedFiles = 0;
let rawSqlCount = 0;

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function findFiles(dir, extensions) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules') continue;
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

/**
 * 检查某行的上下文中是否有指定注释标记
 * 向上搜索最多 5 行
 */
function hasComment(lines, lineIndex, marker) {
  // 检查当前行（行尾注释）
  if (lines[lineIndex].includes(marker)) return true;

  // 向上搜索最多 5 行的注释
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 5); i--) {
    const trimmed = lines[i].trim();
    if (trimmed.includes(marker)) return true;
    // 如果遇到非注释、非空行，停止搜索
    if (
      trimmed &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*')
    ) {
      break;
    }
  }

  return false;
}

/**
 * 判断某行匹配的是 Unsafe 变体还是安全变体
 */
function isUnsafePattern(line) {
  return UNSAFE_RAW_SQL_PATTERNS.some((p) => p.regex.test(line));
}

function checkFile(filePath) {
  if (isExcluded(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 跳过纯注释行
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
      continue;
    }

    for (const pattern of RAW_SQL_PATTERNS) {
      if (pattern.regex.test(line)) {
        rawSqlCount++;

        if (isUnsafePattern(line)) {
          // Unsafe 变体：必须使用 @prisma-raw-sql-unsafe: 注释
          if (!hasComment(lines, i, UNSAFE_COMMENT_MARKER)) {
            errors.push({
              file: path.relative(process.cwd(), filePath),
              line: lineNum,
              message: `使用 ${pattern.label}（危险的字符串拼接变体）但缺少 ${UNSAFE_COMMENT_MARKER} 注释说明: ${trimmedLine.slice(0, 100)}`,
            });
          }
        } else {
          // 安全的 tagged template 变体：使用 @prisma-raw-sql 注释
          if (!hasComment(lines, i, COMMENT_MARKER)) {
            errors.push({
              file: path.relative(process.cwd(), filePath),
              line: lineNum,
              message: `使用 ${pattern.label} 但缺少 ${COMMENT_MARKER} 注释说明: ${trimmedLine.slice(0, 100)}`,
            });
          }
        }
      }
    }
  }

  checkedFiles++;
}

function main() {
  console.log('检查 Service 层原生 SQL 注释规范...\n');

  const files = findFiles(SERVER_SRC_DIR, ['.ts']);

  if (files.length === 0) {
    console.log('未找到需要检查的文件');
    process.exit(0);
  }

  for (const file of files) {
    checkFile(file);
  }

  console.log(`已检查 ${checkedFiles} 个文件，发现 ${rawSqlCount} 处原生 SQL 使用\n`);

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
    console.log('  安全变体（tagged template）在上方添加：');
    console.log('  // @prisma-raw-sql: 说明为什么需要使用原生 SQL');
    console.log('');
    console.log('  危险变体（字符串拼接）在上方添加：');
    console.log('  // @prisma-raw-sql-unsafe: 说明为什么需要 Unsafe 变体');
    console.log('  参考规范：CLAUDE.md 第 9.5 节、第 11.1 节');
    process.exit(1);
  }

  console.log('Service 层原生 SQL 注释检查通过！');
  process.exit(0);
}

main();
