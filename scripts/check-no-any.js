#!/usr/bin/env node
/**
 * 禁止使用 any 类型检查脚本
 *
 * 目标（rules.md MUST #7）：
 * - 严禁使用 any
 * - 严禁使用 @ts-ignore
 * - 如必须忽略类型错误，只允许 @ts-expect-error 并写明原因
 *
 * 检测范围：
 * - pnpm-workspace.yaml 中所有带 src/ 的生产 workspace
 * - 包括测试文件；仅排除声明文件与依赖目录
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const { productionSourceDirs } = require('./lib/workspaces');

const REPO_ROOT = process.env.NO_ANY_ROOT
  ? path.resolve(process.env.NO_ANY_ROOT)
  : path.resolve(__dirname, '..');
const SCAN_DIRS = productionSourceDirs(REPO_ROOT);

// ============ Allowlist 配置 ============
// 允许使用 any 的场景（第三方库类型缺陷、不可避免的 any 等）
const ALLOWLIST = [
  // 当前无白名单条目 - 所有 any 类型使用已修复
];

// ============ 需要排除的模式 ============
// 第三方库定义中的 any（如 lodash 等）
const EXCLUDE_PATTERNS = [/node_modules/, /\.d\.ts$/];

// ============ 检测模式 ============
// 匹配 any 使用的各种形式
const ANY_PATTERNS = [
  // `: any` 类型注解
  { regex: /:\s*any\b/, message: '使用 any 类型注解' },
  // `as any` 类型断言
  { regex: /\bas\s+any\b/, message: '使用 as any 类型断言' },
  // `type Alias = any`
  { regex: /=\s*any\b/, message: '使用 any 类型别名' },
  // `Promise<any>` / `Map<string, any>` 等泛型参数
  { regex: /(?:<|,)\s*any\s*(?:,|>)/, message: '使用 any 泛型参数' },
  // `Array<any>` 泛型
  { regex: /Array\s*<\s*any\s*>/, message: '使用 Array<any>' },
  // `any[]` 数组
  { regex: /\bany\[\]/, message: '使用 any[]' },
  // `Record<string, any>`
  { regex: /Record\s*<\s*string\s*,\s*any\s*>/, message: '使用 Record<string, any>' },
  // `as any[]`
  { regex: /\bas\s+any\s*\[\]/, message: '使用 as any[]' },
  // `| any` 联合类型
  { regex: /\|\s*any\b/, message: '使用 | any 联合类型' },
  // `any |` 联合类型
  { regex: /\bany\s*\|/, message: '使用 any | 联合类型' },
];

const errors = [];
let checkedFiles = 0;

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isInAllowlist(filePath, line, content) {
  const relativePath = path.relative(REPO_ROOT, filePath);

  // 精确匹配：文件路径 + 行号
  const exactMatch = `${relativePath}:${line}`;
  if (ALLOWLIST.includes(exactMatch)) return true;

  // 内容匹配：文件路径 + 内容片段
  for (const item of ALLOWLIST) {
    if (item.includes(':') && !item.includes('/')) continue; // 跳过非路径条目
    if (typeof item === 'string' && item.includes(':')) {
      const [allowPath, allowContent] = item.split(':');
      if (relativePath.includes(allowPath) && content.includes(allowContent)) {
        return true;
      }
    }
  }

  return false;
}

function checkFile(filePath) {
  if (isExcluded(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // 跳过纯注释行中的 any；代码行不会因同行存在 ts 指令而豁免。
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
      continue;
    }

    for (const pattern of ANY_PATTERNS) {
      if (pattern.regex.test(line)) {
        // 检查是否在白名单中
        if (isInAllowlist(filePath, lineNum, line)) {
          continue;
        }

        errors.push({
          file: path.relative(REPO_ROOT, filePath),
          line: lineNum,
          message: `${pattern.message}: ${line.trim().slice(0, 100)}`,
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
  console.log('检查 any 类型使用情况...\n');

  const allFiles = SCAN_DIRS.flatMap((dir) => findFiles(dir, ['.ts', '.tsx']));

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
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  1. 使用具体类型替代 any');
    console.log('  2. 如确需忽略类型错误，使用 // @ts-expect-error: <原因>');
    console.log('  3. 如需添加到白名单，在 scripts/check-no-any.js 的 ALLOWLIST 中添加');
    process.exit(1);
  }

  console.log('any 类型检查通过！');
  process.exit(0);
}

main();
