#!/usr/bin/env node
/**
 * 公开候选仓：禁止带回生产部署拓扑，并要求 SUPER_ADMIN_EMPLOYEE_ID 出现在 env 示例中。
 * 该变量是保护锁，不授予额外权限。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.PRODUCTION_ENV_MAPPING_ROOT || path.resolve(__dirname, '..');
const VARIABLE = 'SUPER_ADMIN_EMPLOYEE_ID';
const forbidden = [
  'infra/s.prod.yaml',
  'infra/s.migrator.prod.yaml',
  'infra/s.seo-sync.prod.yaml',
  'infra/s.cloud-cost-sync.prod.yaml',
  '.github/workflows/backend-pipeline.yml',
  '.github/workflows/frontend-pipeline.yml',
  '.github/workflows/trigger-finance-dingtalk-prepared-import.yml',
];
const errors = [];

for (const relativePath of forbidden) {
  if (fs.existsSync(path.join(ROOT, relativePath))) {
    errors.push(`公开树不得包含生产部署文件：${relativePath}`);
  }
}

const exampleCandidates = ['.env.example', 'apps/server/.env.example'];
const exampleHasVariable = exampleCandidates.some((relativePath) => {
  const filePath = path.join(ROOT, relativePath);
  return fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes(VARIABLE);
});
if (!exampleHasVariable) {
  errors.push(`${VARIABLE} 必须出现在 .env.example 或 apps/server/.env.example`);
}

if (errors.length > 0) {
  console.error('公开仓环境变量/部署边界检查失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`公开仓环境变量/部署边界检查通过：无生产部署文件，且示例环境已声明 ${VARIABLE}`);
