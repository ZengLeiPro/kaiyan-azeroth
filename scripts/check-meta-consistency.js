#!/usr/bin/env node
/**
 * 仓库元信息一致性检查。
 *
 * 所有版本和检查集合都从 package.json / rules.md / README.md 动态提取，
 * 禁止在文档或 Husky 注释中维护容易漂移的检查项数字。
 */

const fs = require('fs');
const path = require('path');

const { discoverWorkspacePackages } = require('./lib/workspaces');

const ROOT = process.env.META_CONSISTENCY_ROOT
  ? path.resolve(process.env.META_CONSISTENCY_ROOT)
  : path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const SERVER_PKG_PATH = path.join(ROOT, 'apps/server/package.json');
const RULES_PATH = path.join(ROOT, 'rules.md');
const README_PATH = path.join(ROOT, 'README.md');
const HUSKY_PRE_COMMIT_PATH = path.join(ROOT, '.husky/pre-commit');
const QUALITY_GATE_PATH = path.join(ROOT, '.github/workflows/quality-gate.yml');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const fileStem = (file) => file.replace(/^check-/, '').replace(/\.js$/, '');
const fmt = (set) => [...set].sort().join(', ') || '（空）';
const firstVersion = (range) => String(range || '').match(/\d+(?:\.\d+){0,2}/)?.[0] || '';
const major = (range) => firstVersion(range).split('.')[0];
const majorMinor = (range) => firstVersion(range).split('.').slice(0, 2).join('.');

const pkg = readJson(PKG_PATH);
const serverPkg = readJson(SERVER_PKG_PATH);
const scripts = pkg.scripts || {};
const rules = fs.readFileSync(RULES_PATH, 'utf8');
const readme = fs.readFileSync(README_PATH, 'utf8');
const huskyPreCommit = fs.readFileSync(HUSKY_PRE_COMMIT_PATH, 'utf8');
const qualityGate = fs.existsSync(QUALITY_GATE_PATH)
  ? fs.readFileSync(QUALITY_GATE_PATH, 'utf8')
  : '';
const errors = [];

// package.json 的 check:* 键名 -> scripts/check-*.js stem。
const keyToStem = {};
for (const [key, command] of Object.entries(scripts)) {
  if (!key.startsWith('check:') || key === 'check:all') continue;
  const files = [...String(command).matchAll(/scripts\/(check-[a-z0-9-]+\.js)/g)].map(
    (match) => match[1]
  );
  if (files.length > 1) {
    errors.push(`${key} 同时引用多个 check 脚本: ${files.join(', ')}`);
  } else if (files.length === 1) {
    keyToStem[key] = fileStem(files[0]);
  }
}

// B：package.json 中定义的文件型阻断检查。
const B = new Set(Object.values(keyToStem));

// C：check:all 串联的文件型阻断检查；同时阻断重复和未映射引用。
const checkAll = scripts['check:all'] || '';
const checkAllTokens = checkAll.match(/check:[a-z0-9-]+/g) || [];
const duplicateTokens = [...new Set(checkAllTokens)].filter(
  (token) => checkAllTokens.filter((item) => item === token).length > 1
);
if (duplicateTokens.length) errors.push(`check:all 重复引用: ${duplicateTokens.join(', ')}`);

const C = new Set();
const unmappedInAll = [];
for (const token of checkAllTokens) {
  if (token === 'check:all') continue;
  if (keyToStem[token]) C.add(keyToStem[token]);
  else unmappedInAll.push(token);
}

// A：rules.md 表格中的脚本文件及其 package script 键名。
const rulesRows = new Map();
const rowRe = /^\|\s*`(check-[a-z0-9-]+\.js)`\s*\|\s*`pnpm run (check:[a-z0-9-]+)`/gm;
let rowMatch;
while ((rowMatch = rowRe.exec(rules)) !== null) {
  rulesRows.set(rowMatch[2], fileStem(rowMatch[1]));
}
const A = new Set(rulesRows.values());

const onlyIn = (label, left, right, hint) => {
  const only = [...left].filter((value) => !right.has(value));
  if (only.length) {
    errors.push(`${label}: ${only.map((name) => `check-${name}.js`).join(', ')}（${hint}）`);
  }
};

onlyIn('package.json 有但 check:all 未串联', B, C, '请把缺失项加入 check:all');
onlyIn('check:all 串联但 package.json 未定义', C, B, '请在 package.json scripts 中补定义');
onlyIn('package.json 有但 rules.md 检查表未登记', B, A, '请在 rules.md 自动化检查表补行');
onlyIn('rules.md 检查表登记但 package.json 无对应脚本', A, B, '请核对脚本名或移除表行');

for (const [key, stem] of Object.entries(keyToStem)) {
  if (rulesRows.has(key) && rulesRows.get(key) !== stem) {
    errors.push(
      `rules.md ${key} 映射为 check-${rulesRows.get(key)}.js，package.json 实际为 check-${stem}.js`
    );
  }
}
if (unmappedInAll.length) {
  errors.push(
    `check:all 引用的检查在 package.json 中不是文件型 check 脚本: ${unmappedInAll.join(', ')}`
  );
}

const missingFiles = [...B].filter(
  (name) => !fs.existsSync(path.join(ROOT, 'scripts', `check-${name}.js`))
);
if (missingFiles.length) {
  errors.push(
    `scripts/ 下文件不存在: ${missingFiles.map((name) => `check-${name}.js`).join(', ')}`
  );
}

const prismaValidateCount = (checkAll.match(/\bprisma\s+validate\b/g) || []).length;
if (prismaValidateCount !== 1) {
  errors.push(`check:all 必须且只能执行一次 prisma validate，当前 ${prismaValidateCount} 次`);
}
if (!/^\|\s*\（内置\）\s*\|\s*`prisma validate`/m.test(rules)) {
  errors.push('rules.md 自动化检查表缺少 prisma validate 内置检查行');
}

// 门禁自身的 fixture 测试不得混入 Turbo workspace test（会递归/重复），但必须由 check:all
// 独立执行。固定 glob 可自动覆盖后续新增的 scripts/check-*.test.js。
const gateFixtureTests = fs
  .readdirSync(path.join(ROOT, 'scripts'))
  .filter((file) => /^check-[a-z0-9-]+\.test\.js$/.test(file));
if (gateFixtureTests.length === 0) {
  errors.push('scripts/ 下至少需要一个 check-*.test.js 门禁 fixture 测试');
}
if (scripts['test:gates'] !== 'node --test --test-concurrency=1 scripts/check-*.test.js') {
  errors.push(
    'root test:gates 必须为 `node --test --test-concurrency=1 scripts/check-*.test.js`，串行覆盖全部会改写共享 fixture 路径的门禁测试'
  );
}
const testGatesCount = (checkAll.match(/\bpnpm\s+run\s+test:gates\b/g) || []).length;
if (testGatesCount !== 1) {
  errors.push(`check:all 必须且只能执行一次 pnpm run test:gates，当前 ${testGatesCount} 次`);
}
if (!/^\s*pnpm run check:all(?: \|\| exit 1)?\s*$/m.test(huskyPreCommit)) {
  errors.push('.husky/pre-commit: 必须执行根 `pnpm run check:all`');
}
if (!/^\s*run:\s*pnpm run check:all\s*$/m.test(qualityGate)) {
  errors.push('quality-gate.yml: 必须执行根 `pnpm run check:all`');
}

// README 版本必须来自当前 package 配置。
const readmeNest = readme.match(/NestJS\s+(?:v)?(\d+)/)?.[1];
const expectedNest = major(serverPkg.dependencies?.['@nestjs/core']);
if (readmeNest !== expectedNest) {
  errors.push(`README NestJS 版本为 ${readmeNest || '缺失'}，应为 ${expectedNest}`);
}

const readmePrisma = readme.match(/Prisma\s+(?:v)?(\d+\.\d+)/)?.[1];
const expectedPrisma = majorMinor(serverPkg.dependencies?.prisma);
if (readmePrisma !== expectedPrisma) {
  errors.push(`README Prisma 版本为 ${readmePrisma || '缺失'}，应为 ${expectedPrisma}`);
}

const packageManagerPnpm = pkg.packageManager?.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1];
const enginePnpm = pkg.engines?.pnpm?.match(/^>=(\d+\.\d+\.\d+)$/)?.[1];
const readmePnpm = readme.match(/pnpm\s+>=(\d+\.\d+\.\d+)/)?.[1];
if (!packageManagerPnpm || packageManagerPnpm !== enginePnpm || enginePnpm !== readmePnpm) {
  errors.push(
    `pnpm 版本不一致: packageManager=${packageManagerPnpm || '缺失'}, engines=${enginePnpm || '缺失'}, README=${readmePnpm || '缺失'}`
  );
}

const driftingCountPatterns = [
  ['README.md', readme, /\d+\s*项自动化检查|自动化检查脚本（\d+|运行全部\s*\d+\s*项/],
  ['rules.md', rules, /运行全部阻断检查（\d+\s*项/],
  ['.husky/pre-commit', huskyPreCommit, /自动化规范检查（\d+\s*项/],
];
for (const [label, content, pattern] of driftingCountPatterns) {
  if (pattern.test(content)) errors.push(`${label} 含易漂移的手写检查项数字`);
}

// 所有可执行 workspace 都必须参与 root 的 lint/typecheck/test/build。
// 只读包豁免须按“包名#task”精确登记理由，且 package.json 声明 kyGate.readOnly=true；
// 禁止通配符、文件级豁免和无理由豁免。
const REQUIRED_WORKSPACE_TASKS = ['lint', 'typecheck', 'test', 'build'];
const READ_ONLY_TASK_EXEMPTIONS = Object.freeze({});
const PLACEHOLDER_TASK =
  /^(?:true|:|exit\s+0|echo\b)|(?:\|\|\s*true\b|;\s*true\s*$|--passWithNoTests\b)/;

function exemptionReason(workspace, task) {
  const key = `${workspace.packageJson.name}#${task}`;
  const reason = READ_ONLY_TASK_EXEMPTIONS[key];
  if (reason === undefined) return null;
  if (workspace.packageJson.kyGate?.readOnly !== true) {
    errors.push(`${key}: 仅 package.json 声明 kyGate.readOnly=true 的只读包可豁免`);
  }
  if (typeof reason !== 'string' || reason.trim().length < 8) {
    errors.push(`${key}: 只读包豁免必须提供明确理由（至少 8 字符）`);
  }
  return reason;
}

function hasTestFile(directory) {
  if (!fs.existsSync(directory)) return false;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && hasTestFile(fullPath)) return true;
    if (entry.isFile() && /(?:\.(?:test|spec)|-spec)\.[cm]?[jt]sx?$/.test(entry.name)) return true;
  }
  return false;
}

const workspaces = discoverWorkspacePackages(ROOT);
const turboPath = path.join(ROOT, 'turbo.json');
const turbo = fs.existsSync(turboPath) ? readJson(turboPath) : {};
for (const task of REQUIRED_WORKSPACE_TASKS) {
  if (scripts[task] !== `turbo run ${task}`) {
    errors.push(`root ${task}: 必须无 filter 执行 \`turbo run ${task}\`，确保覆盖全部 workspace`);
  }
  if (!turbo.tasks?.[task]) errors.push(`turbo.json: 缺少 required task ${task}`);
}

// CI 与本地全路径必须调用同一组无 filter 根脚本；由上面的 root/workspace 校验
// 继续动态证明这些调用真实覆盖当前及后续新增 workspace。
for (const task of ['test', 'build']) {
  const huskyPattern = new RegExp(`^\\s*pnpm run ${task}(?: \\|\\| exit 1)?\\s*$`, 'm');
  if (!huskyPattern.test(huskyPreCommit)) {
    errors.push(`.husky/pre-commit: 必须执行无 filter 的 \`pnpm run ${task}\``);
  }

  const workflowPattern = new RegExp(`^\\s*run:\\s*pnpm run ${task}\\s*$`, 'm');
  if (!workflowPattern.test(qualityGate)) {
    errors.push(`quality-gate.yml: 必须执行无 filter 的 \`pnpm run ${task}\``);
  }
}

for (const workspace of workspaces) {
  const name = workspace.packageJson.name || workspace.relativeDirectory;
  const workspaceScripts = workspace.packageJson.scripts || {};
  for (const task of REQUIRED_WORKSPACE_TASKS) {
    if (exemptionReason(workspace, task)) continue;
    const command = workspaceScripts[task];
    if (typeof command !== 'string' || command.trim() === '') {
      errors.push(`${name}: 缺少 required task ${task}`);
      continue;
    }
    if (PLACEHOLDER_TASK.test(command.trim())) {
      errors.push(`${name}#${task}: 禁止永远成功的占位命令 \`${command}\``);
    }
  }
  if (!exemptionReason(workspace, 'test') && !hasTestFile(path.join(workspace.directory, 'src'))) {
    errors.push(`${name}#test: src/ 下没有真实 *.test.* / *.spec.* 测试文件`);
  }
}

for (const key of Object.keys(READ_ONLY_TASK_EXEMPTIONS)) {
  const [packageName, task] = key.split('#');
  if (!workspaces.some((workspace) => workspace.packageJson.name === packageName)) {
    errors.push(`只读包豁免引用不存在的 workspace: ${key}`);
  }
  if (!REQUIRED_WORKSPACE_TASKS.includes(task)) {
    errors.push(`只读包豁免引用非 required task: ${key}`);
  }
}

console.log('正在检查仓库元信息（版本 + 阻断脚本集合 + workspace required tasks）...\n');

if (errors.length) {
  console.error('错误（必须修复）：');
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    `\n集合对比（文件名）：\n  rules.md 表(${A.size}): ${fmt(A)}\n  package.json(${B.size}): ${fmt(B)}\n  check:all(${C.size}): ${fmt(C)}`
  );
  process.exit(1);
}

console.log(
  `元信息一致性通过（NestJS ${expectedNest} / Prisma ${expectedPrisma} / pnpm ${enginePnpm}；${B.size} 个文件型阻断检查 + prisma validate）`
);
