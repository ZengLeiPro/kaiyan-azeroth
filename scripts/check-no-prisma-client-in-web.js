#!/usr/bin/env node
/**
 * 前端禁止直接导入 @prisma/client 检查脚本
 *
 * 目标（CLAUDE.md MUST #3）：
 * - 前端代码禁止直接导入 @prisma/client
 * - 必须使用 @ky-azeroth/shared/types 间接引用
 *
 * 检测范围：
 * - apps/web/src 下所有 .ts / .tsx 文件
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const WEB_SRC_DIR = path.join(__dirname, '../apps/web/src');

// 检测模式：直接导入 @prisma/client 的各种形式
const PRISMA_IMPORT_PATTERNS = [
  { regex: /from\s+['"]@prisma\/client['"]/, message: '直接导入 @prisma/client' },
  { regex: /require\s*\(\s*['"]@prisma\/client['"]\s*\)/, message: '直接 require @prisma/client' },
  { regex: /from\s+['"]\.prisma\/client['"]/, message: '直接导入 .prisma/client' },
];

const errors = [];
let checkedFiles = 0;

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

    for (const pattern of PRISMA_IMPORT_PATTERNS) {
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

function main() {
  console.log('检查前端禁止直接导入 @prisma/client...\n');

  const files = findFiles(WEB_SRC_DIR, ['.ts', '.tsx']);

  if (files.length === 0) {
    console.log('未找到需要检查的文件');
    process.exit(0);
  }

  for (const file of files) {
    checkFile(file);
  }

  console.log(`已检查 ${checkedFiles} 个文件\n`);

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
    console.log('  前端代码必须通过 @ky-azeroth/shared/types 间接引用 Prisma 类型。');
    console.log('  参考规范：CLAUDE.md MUST #3');
    process.exit(1);
  }

  console.log('前端 @prisma/client 导入检查通过！');
  process.exit(0);
}

main();
