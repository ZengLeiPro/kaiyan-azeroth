#!/usr/bin/env node
/**
 * 禁止 DTO 文件内联定义 zod schema
 *
 * 规则来源：CLAUDE.md MUST 5 —— Create/Update/Response/Query schema 必须来自
 *   @ky-azeroth/shared/schemas。DTO 文件（*.dto.ts）只应 `createZodDto(导入的 shared schema)`，
 *   不应 `import { z } from 'zod'` 自行内联定义 schema（破坏 Single Source of Truth）。
 *
 * 检查：扫描 apps/server/src 下所有 *.dto.ts，若 import 自 'zod' 即视为内联定义 schema 并阻断。
 * 豁免：文件中含 `@inline-schema-ok: <原因>` 注释（用于对 shared schema 做一次性 .extend 等罕见场景）。
 *
 * 使用方式：node scripts/check-no-inline-dto-schema.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'apps', 'server', 'src');

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (e.isFile() && e.name.endsWith('.dto.ts')) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];

for (const file of walk(SERVER_SRC)) {
  const content = fs.readFileSync(file, 'utf-8');
  if (!/from\s+['"]zod['"]/.test(content)) continue; // 未 import zod → 合规
  if (/@inline-schema-ok/.test(content)) continue; // 显式豁免
  offenders.push(path.relative(ROOT, file).split(path.sep).join('/'));
}

console.log('正在检查 DTO 文件是否内联定义 zod schema...\n');

if (offenders.length) {
  console.log('错误（必须修复）：DTO 文件不应 import zod 自行定义 schema');
  console.log('================');
  for (const f of offenders) console.log(`  - ${f}`);
  console.log('');
  console.log('修复建议：');
  console.log(
    '  1. 将 schema 迁移到 packages/shared/src/schemas，DTO 改为 createZodDto(导入的 shared schema)'
  );
  console.log(
    '  2. 确需内联（如对 shared schema 一次性 .extend）须加 // @inline-schema-ok: <原因> 注释'
  );
  console.log('');
  console.log(`发现 ${offenders.length} 个 DTO 文件内联定义 schema，请处理后再提交。`);
  process.exit(1);
}

console.log('DTO 内联 schema 检查通过！（所有 *.dto.ts 的 schema 均来自 shared）');
process.exit(0);
