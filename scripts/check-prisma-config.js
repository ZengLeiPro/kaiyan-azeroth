#!/usr/bin/env node
/**
 * Prisma 配置静态检查。
 *
 * 动态发现依赖 Prisma CLI 的工作区包，确保它们使用 Prisma v6 的
 * prisma.config.ts，而不是已废弃的 package.json#prisma；同时验证
 * schema、migrations 与 seed 路径保持可解析。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', '.turbo', 'coverage', 'dist', 'node_modules']);

function findPackageJsonFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) findPackageJsonFiles(absolute, results);
    else if (entry.name === 'package.json') results.push(absolute);
  }
  return results;
}

function loadPrismaConfig(configPath) {
  const source = fs.readFileSync(configPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: configPath,
  }).outputText;
  const module = { exports: {} };
  const mockRequire = (id) => {
    if (id === 'prisma/config') return { defineConfig: (config) => config };
    if (id === 'dotenv/config') return {};
    throw new Error(`prisma.config.ts 不应静态导入 ${id}`);
  };
  Function('require', 'module', 'exports', output)(mockRequire, module, module.exports);
  return module.exports.default;
}

function resolveConfiguredPath(packageDir, configuredPath) {
  return path.resolve(packageDir, configuredPath);
}

function extractSeedEntry(seedCommand) {
  const tokens = seedCommand.trim().split(/\s+/);
  return tokens.at(-1);
}

const errors = [];
const manifests = findPackageJsonFiles(ROOT).map((manifestPath) => ({
  manifestPath,
  packageDir: path.dirname(manifestPath),
  pkg: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
}));

for (const { manifestPath, pkg } of manifests) {
  if (Object.prototype.hasOwnProperty.call(pkg, 'prisma')) {
    errors.push(`${path.relative(ROOT, manifestPath)} 仍包含 deprecated package.json#prisma`);
  }
}

const prismaPackages = manifests.filter(
  ({ pkg }) => pkg.dependencies?.prisma || pkg.devDependencies?.prisma
);

if (prismaPackages.length === 0) errors.push('未发现依赖 Prisma CLI 的工作区包');

for (const { manifestPath, packageDir, pkg } of prismaPackages) {
  const relativeManifest = path.relative(ROOT, manifestPath);
  const configPath = path.join(packageDir, 'prisma.config.ts');
  if (!fs.existsSync(configPath)) {
    errors.push(`${relativeManifest} 缺少 prisma.config.ts`);
    continue;
  }

  let config;
  try {
    config = loadPrismaConfig(configPath);
  } catch (error) {
    errors.push(`${path.relative(ROOT, configPath)} 无法静态加载: ${error.message}`);
    continue;
  }

  if (!config?.schema) {
    errors.push(`${path.relative(ROOT, configPath)} 缺少 schema`);
  } else if (!fs.existsSync(resolveConfiguredPath(packageDir, config.schema))) {
    errors.push(`${path.relative(ROOT, configPath)} schema 不存在: ${config.schema}`);
  }

  if (!config?.migrations?.path) {
    errors.push(`${path.relative(ROOT, configPath)} 缺少 migrations.path`);
  } else if (!fs.existsSync(resolveConfiguredPath(packageDir, config.migrations.path))) {
    errors.push(
      `${path.relative(ROOT, configPath)} migrations.path 不存在: ${config.migrations.path}`
    );
  }

  const hasSeedScript = Object.values(pkg.scripts || {}).some((command) =>
    /\bprisma\s+db\s+seed\b/.test(String(command))
  );
  const seedCommand = config?.migrations?.seed;
  if (hasSeedScript && !seedCommand) {
    errors.push(
      `${path.relative(ROOT, configPath)} 有 prisma db seed 脚本但未配置 migrations.seed`
    );
  }
  if (!hasSeedScript && seedCommand) {
    errors.push(
      `${path.relative(ROOT, configPath)} 配置了 migrations.seed 但 package scripts 未使用 prisma db seed`
    );
  }
  if (seedCommand) {
    const seedEntry = extractSeedEntry(seedCommand);
    if (!seedEntry || !fs.existsSync(resolveConfiguredPath(packageDir, seedEntry))) {
      errors.push(
        `${path.relative(ROOT, configPath)} seed 入口不存在: ${seedEntry || seedCommand}`
      );
    }
  }
}

console.log(`正在检查 Prisma 配置（动态发现 ${prismaPackages.length} 个 Prisma 工作区包）...\n`);

if (errors.length) {
  console.error('错误（必须修复）：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Prisma 配置静态检查通过（schema / migrations / seed 均可解析，无 deprecated 字段）');
