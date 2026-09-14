#!/usr/bin/env node
/**
 * 把 apps/cli 打包成 self-contained CJS bundle，放进 server 的 dist/static/。
 *
 * 设计目的：让 server 部署的"原子单位"包含最新 CLI bundle。
 * agent 平台运行时通过 GET /api/v1/cli-bundle 拉取，无需任何手工同步动作。
 *
 * 时机：作为 apps/server 的 postbuild 步骤运行（nest build 完成后）。
 * 输出：apps/server/dist/static/cli-bundle.cjs + cli-bundle.sha256
 *
 * 关键约束：
 *  - format=cjs：让 bundle 自带 shebang 后能直接 chmod +x 执行
 *  - bundle=true + 默认 packages=bundle：把所有依赖（axios/commander/zod 等）inline 进去
 *    （消费方 sandbox 禁读 ~/code，运行时不能查找 ky-azeroth/node_modules）
 *  - target=node22：与生产 FC + Mac Mini 上的 node 版本对齐
 */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(SERVER_ROOT, '..', '..');
const CLI_ENTRY = resolve(REPO_ROOT, 'apps/cli/src/index.ts');
const MIGRATION_ENTRY = resolve(SERVER_ROOT, 'src/migrate-handler.ts');
const STATIC_DIR = resolve(SERVER_ROOT, 'dist/static');
const OUT_FILE = resolve(STATIC_DIR, 'cli-bundle.cjs');
const HASH_FILE = resolve(STATIC_DIR, 'cli-bundle.sha256');
const MIGRATION_OUT_FILE = resolve(SERVER_ROOT, 'dist/migrate-handler.js');

mkdirSync(STATIC_DIR, { recursive: true });

await build({
  entryPoints: [CLI_ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: OUT_FILE,
  // CLI 源码顶部已有 #!/usr/bin/env node，esbuild 默认会保留
  logLevel: 'info',
});

// Nest webpack 只编译 main.ts；迁移事件函数需要独立入口，不能等到部署时才发现产物缺失。
await build({
  entryPoints: [MIGRATION_ENTRY],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: MIGRATION_OUT_FILE,
  logLevel: 'info',
});

// 写入 SHA256，供 GET /cli-bundle/hash 端点直接读取（避免每次请求重算）
const buf = readFileSync(OUT_FILE);
const sha256 = createHash('sha256').update(buf).digest('hex');
writeFileSync(HASH_FILE, sha256, 'utf-8');

console.log(`[bundle-cli] ✓ ${OUT_FILE}`);
console.log(
  `[bundle-cli]   size=${(buf.length / 1024).toFixed(1)}KB sha256=${sha256.slice(0, 16)}...`
);
console.log(`[bundle-migrator] ✓ ${MIGRATION_OUT_FILE}`);
