#!/usr/bin/env node
/**
 * Decimal 精度注释检查（诊断/阻断）
 *
 * 规则来源：CLAUDE.md MUST 6 —— shared 类型中金额/数量等精度敏感字段必须使用 DecimalNumber，
 *   并添加 `@precision Decimal` 注释。
 *
 * 扫描 packages/shared/src/types/**，找出所有 `字段: DecimalNumber`（含 `| null`）声明，
 * 校验其同行或紧邻上方 JSDoc/注释含 `@precision`；缺失即报告。
 *
 * 使用方式：node scripts/check-decimal-precision.js
 */

const fs = require('fs');
const path = require('path');

const TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

// 字段声明：  name: DecimalNumber  /  name?: DecimalNumber | null  等（排除 import / type 别名定义）
const FIELD_RE = /^\s*[\w]+\s*\??\s*:\s*DecimalNumber\b/;

// keep-record 按项目当前约定暂不纳入精度注释强制。
const SKIP_FILE_RE = /^keep-record/;

const missing = [];
let total = 0;

for (const file of walk(TYPES_DIR)) {
  if (SKIP_FILE_RE.test(path.basename(file))) continue;
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  const rel = path.relative(path.join(__dirname, '..'), file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!FIELD_RE.test(line)) continue;
    total++;
    // 同行或紧邻上方注释（向上跳过空行，检查连续注释块）含 @precision 即合格
    if (/@precision/.test(line)) continue;
    let ok = false;
    for (let j = i - 1; j >= 0; j--) {
      const prev = lines[j].trim();
      if (prev === '') continue;
      const isComment =
        prev.startsWith('*') ||
        prev.startsWith('/**') ||
        prev.startsWith('//') ||
        prev.startsWith('*/');
      if (!isComment) break; // 上一行不是注释，停止
      if (/@precision/.test(prev)) {
        ok = true;
        break;
      }
      // 继续向上看多行 JSDoc 块
    }
    if (!ok) {
      const field = (line.match(/^\s*([\w]+)/) || [])[1] || '?';
      missing.push({ file: rel, line: i + 1, field });
    }
  }
}

console.log('正在检查 DecimalNumber 字段的 @precision 注释...\n');
console.log(`共扫描 ${total} 个 DecimalNumber 字段，缺注释 ${missing.length} 个。\n`);

if (missing.length) {
  // 按文件聚合输出
  const byFile = {};
  for (const m of missing) (byFile[m.file] ||= []).push(m);
  for (const [f, items] of Object.entries(byFile)) {
    console.log(`  ${f}  (缺 ${items.length})`);
    for (const it of items) console.log(`    - 第 ${it.line} 行: ${it.field}`);
  }
  console.log('');
  console.log(
    '修复：在每个字段上一行加 JSDoc `/** @precision Decimal */`（或在已有 JSDoc 末尾追加 @precision Decimal）。'
  );
  process.exit(1);
}

console.log('Decimal 精度注释检查通过！');
process.exit(0);
