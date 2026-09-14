#!/usr/bin/env node
/**
 * 业务实体外键级联删除检查
 *
 * 规则来源：CLAUDE.md 9.7.2 —— 业务实体外键关联**不设置** `onDelete: Cascade`
 *   （防止级联物理删除，绕过软删除策略）。物理删除仅用于系统模型、纯中间表与明确采用物理生命周期的私有配置。
 *
 * 本脚本扫描 schema.prisma，找出所有 `onDelete: Cascade`，仅允许出现在 WHITELIST 模型
 * （系统模型 / 纯中间表）中；出现在其它（业务）模型上即阻断。
 *
 * 使用方式：node scripts/check-no-business-cascade.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../apps/server/prisma/schema.prisma');

// 允许使用 onDelete: Cascade 的模型（系统模型 / 纯中间表 / 私有可重建配置，物理删除可接受）。
// ⚠️ 新增受管业务实体一律不得加入本白名单；其他模型需先核对真实生命周期并在此说明。
const WHITELIST = new Set([
  'Session', // 会话（系统模型，物理删除）
  'PersonalAccessToken', // PAT（系统模型）
  'UserRole', // 用户-角色 纯中间表
  'RolePermission', // 角色-权限 纯中间表
  'EmployeeDepartment', // 员工-部门 纯中间表
  'PersonalFilterPreference', // 员工私有、可重建的界面配置，reset 时即物理删除
  'PersonalFilterPreset', // 员工私有的命名筛选配置，用户删除时即物理删除
]);

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`找不到 schema 文件：${SCHEMA_PATH}`);
  process.exit(1);
}

const lines = fs.readFileSync(SCHEMA_PATH, 'utf-8').split('\n');

let currentModel = null;
const offenders = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  const modelMatch = line.match(/^\s*model\s+(\w+)\s*\{/);
  if (modelMatch) {
    currentModel = modelMatch[1];
    continue;
  }
  if (/^\s*\}/.test(line) && currentModel) {
    currentModel = null;
    continue;
  }

  if (currentModel && /onDelete:\s*Cascade/.test(line)) {
    if (!WHITELIST.has(currentModel)) {
      offenders.push({ model: currentModel, line: i + 1, text: line.trim() });
    }
  }
}

console.log('正在检查业务实体外键级联删除...\n');

if (offenders.length > 0) {
  console.log('错误（必须修复）：业务实体外键使用了 onDelete: Cascade');
  console.log('================');
  for (const o of offenders) {
    console.log(`  - ${o.model}  (schema.prisma:${o.line})`);
    console.log(`      ${o.text}`);
  }
  console.log('');
  console.log(
    '修复建议：业务实体（含 deletedAt 软删除）外键应使用 onDelete: Restrict（或省略，默认 Restrict）；'
  );
  console.log(
    '          Cascade 仅允许系统模型 / 纯中间表 / 明确物理生命周期的私有配置，确属此类请登记并说明。'
  );
  console.log('');
  console.log(`发现 ${offenders.length} 处业务实体级联删除，请修复后再提交。`);
  process.exit(1);
}

console.log('业务实体级联删除检查通过！（Cascade 仅出现在白名单系统模型/中间表/私有配置）');
process.exit(0);
