#!/usr/bin/env node
/**
 * @ts-expect-error 注释完整性检查脚本
 *
 * 目标（rules.md MUST #7 补充）：
 * - @ts-expect-error 必须附带说明原因
 * - 裸写 @ts-expect-error 不附说明视为错误并阻断
 *
 * 检测范围：
 * - pnpm-workspace.yaml 中所有带 src/ 的生产 workspace（含测试）
 *
 * 使用方式：node scripts/check-ts-expect-error.js
 */

const fs = require('fs');
const path = require('path');

const { productionSourceDirs } = require('./lib/workspaces');

const REPO_ROOT = process.env.TS_EXPECT_ERROR_ROOT
  ? path.resolve(process.env.TS_EXPECT_ERROR_ROOT)
  : path.resolve(__dirname, '..');
const SCAN_DIRS = productionSourceDirs(REPO_ROOT);

const EXTENSIONS = ['.ts', '.tsx'];

const EXCLUDE_PATTERNS = [/node_modules/, /\.d\.ts$/];

// 匹配 @ts-expect-error 后面有非空说明文字（冒号可选）
// 合规示例：
//   // @ts-expect-error: reason here
//   // @ts-expect-error reason here
//   * @ts-expect-error: reason here  （JSDoc 中）
const HAS_REASON = /@ts-expect-error\s*:?\s+\S/;

const errors = [];
let checkedFiles = 0;

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function findFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findFiles(fullPath));
    } else if (item.isFile() && EXTENSIONS.includes(path.extname(item.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkFile(filePath) {
  if (isExcluded(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // MUST 7：严禁 @ts-ignore（必须改用带原因的 @ts-expect-error）
    if (line.includes('@ts-ignore')) {
      errors.push({
        file: path.relative(REPO_ROOT, filePath),
        line: i + 1,
        content: line.trim().slice(0, 120),
        type: 'ts-ignore',
      });
      continue;
    }

    // 只检查包含 @ts-expect-error 的行
    if (!line.includes('@ts-expect-error')) continue;

    // 检查是否附带了说明
    if (!HAS_REASON.test(line)) {
      errors.push({
        file: path.relative(REPO_ROOT, filePath),
        line: i + 1,
        content: line.trim().slice(0, 120),
        type: 'missing-reason',
      });
    }
  }

  checkedFiles++;
}

function main() {
  console.log('检查 @ts-expect-error 注释完整性...\n');

  const allFiles = SCAN_DIRS.flatMap(findFiles);

  if (allFiles.length === 0) {
    console.log('未找到需要检查的文件');
    process.exit(0);
  }

  for (const file of allFiles) {
    checkFile(file);
  }

  console.log(`已检查 ${checkedFiles} 个文件\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      const label = e.type === 'ts-ignore' ? '[禁用 @ts-ignore]' : '[@ts-expect-error 缺原因]';
      console.log(`  ${e.file}:${e.line}  ${label}`);
      console.log(`    ${e.content}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log(
      '  禁止 @ts-ignore（MUST 7）；如必须忽略类型错误，改用 @ts-expect-error 并写明原因'
    );
    console.log('  正确: // @ts-expect-error: Prisma 类型不兼容');
    console.log('  错误: // @ts-ignore  或  // @ts-expect-error（无原因）');
    process.exit(1);
  }

  console.log('@ts-expect-error 注释完整性检查通过！');
  process.exit(0);
}

main();
