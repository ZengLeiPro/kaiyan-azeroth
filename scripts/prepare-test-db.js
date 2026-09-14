#!/usr/bin/env node
/**
 * 本地 E2E 测试前置脚本
 * 确保测试数据库存在 → 运行迁移 → 执行 E2E 测试
 *
 * 用法: node scripts/prepare-test-db.js
 *       pnpm test:e2e:local
 */
const { execSync } = require('child_process');
const path = require('path');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASS = process.env.DB_PASS || 'postgres';
const DB_NAME = 'ky-azeroth-test';
const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public`;

const serverDir = path.resolve(__dirname, '../apps/server');

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function psql(sql) {
  execSync(
    `psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "${sql}"`,
    { stdio: 'pipe', env: { ...process.env, PGPASSWORD: DB_PASS } }
  );
}

// 1. 检查 PostgreSQL 连接
try {
  execSync(`psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -c "\\q"`, {
    stdio: 'pipe',
    env: { ...process.env, PGPASSWORD: DB_PASS },
  });
} catch {
  console.error(`错误：无法连接到 PostgreSQL (${DB_HOST}:${DB_PORT})`);
  console.error('请先启动数据库：docker compose up -d');
  process.exit(1);
}

// 2. 创建测试数据库（如不存在）
try {
  const result = execSync(
    `psql -h ${DB_HOST} -p ${DB_PORT} -U ${DB_USER} -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'"`,
    { encoding: 'utf-8', env: { ...process.env, PGPASSWORD: DB_PASS } }
  ).trim();

  if (result !== '1') {
    console.log(`创建测试数据库 ${DB_NAME} ...`);
    psql(`CREATE DATABASE \\"${DB_NAME}\\"`);
    console.log('测试数据库已创建');
  } else {
    console.log(`测试数据库 ${DB_NAME} 已存在`);
  }
} catch (e) {
  console.error('检查/创建测试数据库失败:', e.message);
  process.exit(1);
}

// 3. 运行 Prisma 迁移
console.log('运行 Prisma 迁移...');
run('npx prisma migrate deploy', {
  cwd: serverDir,
  env: { ...process.env, DATABASE_URL },
});

// 4. 运行 E2E 测试
console.log('测试数据库准备完毕，开始运行 E2E 测试...');
run('pnpm test:e2e', { cwd: serverDir });
