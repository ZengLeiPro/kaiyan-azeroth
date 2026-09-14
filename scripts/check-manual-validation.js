#!/usr/bin/env node
/**
 * 手动表单验证检测脚本
 *
 * 目标（rules.md MUST #4 补充）：
 * - 禁止手动 if (!formData.xxx) { toast.error() } 形式的验证
 * - 必须通过 Zod schema 声明式校验
 *
 * 检测策略：
 * 扫描页面文件中的 toast.error 调用，检测以下模式：
 *   1. if 块内紧跟 toast.error + return 的手动字段验证
 *   2. 排除合规的使用场景（catch 块、safeParse 错误展示、业务状态检查等）
 *
 * 允许的 toast.error 场景：
 *   - catch 块中的错误处理
 *   - safeParse/parse 后的错误展示（已使用 Zod 验证）
 *   - 带 @validation-ok 注释的行（标注为合规的业务规则检查）
 *
 * 检测范围：
 * - apps/web/src/pages 下所有 .ts / .tsx 文件
 *
 * 使用方式：node scripts/check-manual-validation.js
 */

const fs = require('fs');
const path = require('path');

const WEB_PAGES_DIR = path.join(__dirname, '../apps/web/src/pages');

const EXTENSIONS = ['.ts', '.tsx'];

const warnings = [];
let checkedFiles = 0;

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

/**
 * 检查某行的 toast.error 是否在 catch 块的上下文中
 */
function isInCatchBlock(lines, lineIndex) {
  // 向上搜索最近 20 行，看是否在 catch 块中
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 20); i--) {
    const line = lines[i].trim();
    if (/\bcatch\s*\(/.test(line)) return true;
    // 遇到函数声明就停止搜索
    if (/\b(function|const\s+\w+\s*=\s*async|async\s+function)\b/.test(line) && !line.includes('{'))
      break;
  }
  return false;
}

/**
 * 检查某行的 toast.error 是否在 safeParse 的上下文中
 * safeParse + toast.error 是合规的（已经用了 Zod 验证）
 */
function isAfterSafeParse(lines, lineIndex) {
  // 向上搜索最近 15 行，看是否有 safeParse/parse 调用
  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 15); i--) {
    const line = lines[i];
    if (/\.safeParse\s*\(/.test(line) || /\.parse\s*\(/.test(line)) return true;
  }
  return false;
}

/**
 * 检查该行或附近是否有 @validation-ok 豁免注释
 */
function hasValidationOkComment(lines, lineIndex) {
  // 检查当前行和前一行
  for (let i = Math.max(0, lineIndex - 2); i <= lineIndex; i++) {
    if (lines[i] && lines[i].includes('@validation-ok')) return true;
  }
  return false;
}

/**
 * 检测手动验证模式：
 * if (条件) { toast.error(...); return; }
 */
function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);

  // 快速跳过没有 toast.error 的文件
  if (!content.includes('toast.error')) return;

  checkedFiles++;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 只检查包含 toast.error 的行
    if (!line.includes('toast.error')) continue;

    // 排除：@validation-ok 豁免
    if (hasValidationOkComment(lines, i)) continue;

    // 排除：catch 块中的错误处理
    if (isInCatchBlock(lines, i)) continue;

    // 排除：safeParse 后的错误展示（合规的 Zod 验证模式）
    if (isAfterSafeParse(lines, i)) continue;

    // 检测模式：检查 toast.error 之前的 if 条件是否是字段验证
    // 向上找 if 语句
    let ifLine = null;
    let ifLineIndex = -1;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const candidate = lines[j].trim();
      if (/^if\s*\(/.test(candidate)) {
        ifLine = candidate;
        ifLineIndex = j;
        break;
      }
    }

    if (!ifLine) continue;

    // 检测手动字段验证模式
    // 常见的手动验证: if (!formData.xxx), if (xxx.length === 0), if (!xxx.trim())
    const manualValidationPatterns = [
      /if\s*\(\s*![\w.]+\s*\)/, // if (!formData.xxx)
      /if\s*\(\s*![\w.]+\.trim\(\)\s*\)/, // if (!name.trim())
      /if\s*\(\s*[\w.]+\.length\s*===?\s*0\s*\)/, // if (items.length === 0)
      /if\s*\(\s*[\w.]+\.length\s*<\s*1\s*\)/, // if (items.length < 1)
      /if\s*\(\s*![\w.]+\.length\s*\)/, // if (!items.length)
    ];

    const isManualValidation = manualValidationPatterns.some((p) => p.test(ifLine));

    // 检查 toast.error 后面是否紧跟 return（手动验证的典型特征）
    let hasReturn = false;
    for (let j = i; j <= Math.min(lines.length - 1, i + 3); j++) {
      if (/\breturn\b/.test(lines[j])) {
        hasReturn = true;
        break;
      }
    }

    if (isManualValidation && hasReturn) {
      // 提取 toast.error 的消息内容
      const msgMatch = line.match(/toast\.error\(\s*['"`]([^'"`]+)['"`]\s*\)/);
      const msg = msgMatch ? msgMatch[1] : '(动态消息)';

      warnings.push({
        file: relativePath,
        line: ifLineIndex + 1,
        ifCondition: ifLine.slice(0, 80),
        errorMsg: msg,
      });
    }
  }
}

function main() {
  console.log('检查手动表单验证模式...\n');

  const files = findFiles(WEB_PAGES_DIR);

  for (const file of files) {
    checkFile(file);
  }

  console.log(`已检查 ${checkedFiles} 个包含 toast.error 的文件\n`);

  if (warnings.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const w of warnings) {
      console.log(`  ${w.file}:${w.line}`);
      console.log(`    检测到手动表单验证 - 条件: ${w.ifCondition}，消息: "${w.errorMsg}"`);
    }
    console.log('');
    console.log(`检查失败：发现 ${warnings.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  1. 将验证规则迁移到 Zod schema 中');
    console.log('  2. 使用 schema.safeParse() 替代手动 if 检查');
    console.log('  3. 如确为合规的业务规则检查（非字段验证），添加 // @validation-ok 注释');
    process.exit(1);
  }

  console.log('手动表单验证检查通过！');
  process.exit(0);
}

main();
