#!/usr/bin/env node
/**
 * 外键索引检查
 *
 * 规则来源：CLAUDE.md 9.7.3 —— 所有外键字段必须添加 @@index
 *   （PostgreSQL 不会自动为外键创建索引）。
 *
 * 检查：解析 schema.prisma，对每个 @relation(fields: [...]) 的**首字段**，
 *   要求被 @@index / @@id / @@unique（作为首字段）或行内 @id / @unique 覆盖；否则阻断。
 *   （复合索引/主键的首字段即可命中外键查询，符合 PostgreSQL 最左前缀原则。）
 *
 * 使用方式：node scripts/check-fk-index.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../apps/server/prisma/schema.prisma');

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`找不到 schema 文件：${SCHEMA_PATH}`);
  process.exit(1);
}

const text = fs.readFileSync(SCHEMA_PATH, 'utf-8');
const blocks = text.split(/\nmodel\s+(\w+)\s*\{/);

const offenders = [];

for (let i = 1; i < blocks.length; i += 2) {
  const modelName = blocks[i];
  const body = blocks[i + 1].split(/\n\}/)[0];

  // @relation(fields: [a, b]) 的字段组
  const relations = [...body.matchAll(/@relation\([^)]*fields:\s*\[([^\]]+)\]/g)].map((m) =>
    m[1].split(',').map((s) => s.trim())
  );

  // 可覆盖外键的「首字段」集合：@@index / @@id / @@unique 的第一个字段
  const indexedFirst = new Set();
  for (const m of body.matchAll(/@@(?:index|id|unique)\(\[([^\]]+)\]/g)) {
    indexedFirst.add(m[1].split(',')[0].trim());
  }
  // 行内 @id / @unique 字段
  for (const m of body.matchAll(/^\s*(\w+)\s+\w+[^\n]*@(?:id|unique)\b/gm)) {
    indexedFirst.add(m[1]);
  }

  for (const fields of relations) {
    const first = fields[0];
    if (!indexedFirst.has(first)) {
      offenders.push(`${modelName}.${first}`);
    }
  }
}

console.log('正在检查外键索引（@relation 字段必须有 @@index 覆盖）...\n');

if (offenders.length) {
  console.log('错误（必须修复）：以下外键字段缺少索引覆盖');
  console.log('================');
  for (const o of offenders) console.log(`  - ${o}`);
  console.log('');
  console.log('修复：在对应 model 上添加 @@index([外键字段])（PostgreSQL 不自动为外键建索引）。');
  console.log('');
  console.log(`发现 ${offenders.length} 个外键缺索引，请修复后再提交。`);
  process.exit(1);
}

console.log('外键索引检查通过！（所有 @relation 外键首字段均被索引覆盖）');
process.exit(0);
