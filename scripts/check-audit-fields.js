#!/usr/bin/env node
/**
 * 审计字段一致性检查
 *
 * 规则来源：CLAUDE.md 9.7.1 —— 业务实体必须包含 6 个审计字段：
 *   createdAt / updatedAt / deletedAt / version / 创建人 / 更新人。
 *
 * 判定口径（避免误伤系统模型/中间表/不可变日志）：
 *   只要某 model 含 [deletedAt | version | createdBy | creatorEmployeeId | updatedBy | updaterEmployeeId]
 *   任一字段，即认定为「受管业务实体」，必须补齐全部 6 个审计字段。
 *   （纯中间表、append-only 日志等不含上述任一字段，天然跳过。）
 *
 * 审计作者字段接受两套等价命名：createdBy | creatorEmployeeId、updatedBy | updaterEmployeeId
 * （仓库现存两套约定，此处统一承认，但单个 model 内须成对出现创建人+更新人）。
 *
 * 使用方式：node scripts/check-audit-fields.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../apps/server/prisma/schema.prisma');

// 完全跳过：非「软删除业务实体」的模型（系统模型 / 纯中间表 / 配置 upsert 表），
// 它们天然不需要全套审计字段。须写明类别，新增前确认确非业务实体。
const SKIP_MODELS = new Set([
  // 系统模型（物理删除）
  'Session',
  'LoginLog',
  'PersonalAccessToken',
  'PersonalFilterPreference', // 用户级筛选展示配置，物理覆盖/删除
  'PersonalFilterPreset', // 用户级命名筛选配置，物理 CRUD
  // 纯中间表
  'UserRole',
  'RolePermission',
  'EmployeeDepartment', // 员工-部门
  'ProjectSaleOrder', // 项目-订单
  // 配置 upsert 表：pageKey 唯一、改即覆盖，无创建/删除语义，仅需 version + 更新人
  'FilterScheme',
]);

// 部分豁免：确属受管实体或物理生命周期配置、但某些审计字段合理缺失（须写明原因，不得随意新增）。
const ALLOWLIST = {
  // Holiday：按年整体覆盖重建的日历配置表，当前缺 deletedAt（物理 deleteMany）。
  // 补 deletedAt + 改软删除需一次 schema 迁移，先豁免并登记 TODO。
  Holiday: ['deletedAt'],
  // 机器同步数据（无人工创建/修改者）：豁免创建人/更新人，仍要求时间/软删/版本。
  CloudBillSnapshot: ['createdBy', 'updatedBy'],
  CloudUsageMetric: ['createdBy', 'updatedBy'],
  SeoSyncRun: ['createdBy', 'updatedBy'],
  // 夜间同步幂等台账：纯机器写入（cron 重试去重），无人工创建/修改者，参照 SeoSyncRun。
  SyncDedupLedger: ['createdBy', 'updatedBy'],
};

const REQUIRED = ['createdAt', 'updatedAt', 'deletedAt', 'version'];
const CREATOR_ALIASES = ['createdBy', 'creatorEmployeeId'];
const UPDATER_ALIASES = ['updatedBy', 'updaterEmployeeId'];
// 出现任一即认定为「受管业务实体」
const ENTITY_MARKERS = ['deletedAt', 'version', ...CREATOR_ALIASES, ...UPDATER_ALIASES];

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`找不到 schema 文件：${SCHEMA_PATH}`);
  process.exit(1);
}

const text = fs.readFileSync(SCHEMA_PATH, 'utf-8');
const lines = text.split('\n');

// 解析 model 块
const models = [];
let cur = null;
for (let i = 0; i < lines.length; i++) {
  const mm = lines[i].match(/^\s*model\s+(\w+)\s*\{/);
  if (mm) {
    cur = { name: mm[1], line: i + 1, fields: new Set() };
    continue;
  }
  if (cur && /^\s*\}/.test(lines[i])) {
    models.push(cur);
    cur = null;
    continue;
  }
  if (cur) {
    const fm = lines[i].match(/^\s*(\w+)\s+/);
    if (fm) cur.fields.add(fm[1]);
  }
}

const offenders = [];

for (const model of models) {
  if (SKIP_MODELS.has(model.name)) continue;
  const isEntity = ENTITY_MARKERS.some((f) => model.fields.has(f));
  if (!isEntity) continue;

  const exempt = new Set(ALLOWLIST[model.name] || []);
  const missing = [];

  for (const f of REQUIRED) {
    if (!model.fields.has(f) && !exempt.has(f)) missing.push(f);
  }
  if (!CREATOR_ALIASES.some((f) => model.fields.has(f)) && !exempt.has('createdBy')) {
    missing.push('createdBy|creatorEmployeeId');
  }
  if (!UPDATER_ALIASES.some((f) => model.fields.has(f)) && !exempt.has('updatedBy')) {
    missing.push('updatedBy|updaterEmployeeId');
  }

  if (missing.length) {
    offenders.push({ name: model.name, line: model.line, missing });
  }
}

console.log('正在检查审计字段一致性（受管业务实体必须含 6 审计字段）...\n');

if (offenders.length) {
  console.log('错误（必须修复）：业务实体缺失审计字段');
  console.log('================');
  for (const o of offenders) {
    console.log(`  - ${o.name} (schema.prisma:${o.line}) 缺：${o.missing.join('、')}`);
  }
  console.log('');
  console.log('修复建议：补齐 createdAt/updatedAt/deletedAt/version + 创建人/更新人；');
  console.log(
    '          确属系统模型/中间表（无需软删除）请确认其不含 version/deletedAt 等业务实体标记；'
  );
  console.log(
    '          确属业务实体但需迁移补字段，可临时登记到本脚本 ALLOWLIST 并写明原因+TODO。'
  );
  console.log('');
  console.log(`发现 ${offenders.length} 个模型审计字段不全，请处理后再提交。`);
  process.exit(1);
}

console.log(`审计字段一致性检查通过！（已校验 ${models.length} 个 model 中的受管业务实体）`);
process.exit(0);
