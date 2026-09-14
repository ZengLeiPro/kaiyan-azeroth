#!/usr/bin/env node
/**
 * CLI/server 路由覆盖门禁。
 *
 * 先构建 shared，确保 doctor 读取当前契约；再以 strict 模式扫描 CLI extras、
 * ghost 路由和服务端权限装饰器。作为文件型 check 接入 check:all，避免该门禁
 * 游离于 rules.md / package.json / check:all 三方一致性检查之外。
 */
const { spawnSync } = require('node:child_process');

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const env = { ...process.env, NO_COLOR: '1' };

function run(args) {
  const result = spawnSync(pnpm, args, { env, stdio: 'inherit' });
  if (result.error) {
    console.error(`CLI doctor 门禁启动失败: ${result.error.message}`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`CLI doctor 门禁被信号终止: ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(['--filter', '@ky-azeroth/shared', 'build']);
run(['--filter', '@ky-azeroth/cli', 'exec', 'tsx', 'src/index.ts', 'doctor', '--strict']);
