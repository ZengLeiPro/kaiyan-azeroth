import { config } from 'dotenv';
import { resolve } from 'path';

import { assertSafeTestDatabaseConnection } from '../common/prisma/test-database-safety';

const explicitTestDatabaseUrl = process.env.TEST_DATABASE_URL;

// 禁止继承调用进程的 DATABASE_URL。自定义 E2E 数据库只能通过 TEST_DATABASE_URL 显式传入，
// 否则固定读取仓库 .env.test，避免误把生产连接带进测试进程。
delete process.env.DATABASE_URL;
process.env.NODE_ENV = 'test';

const result = config({ path: resolve(__dirname, '../../.env.test'), override: true });
if (result.error) {
  throw new Error(`加载 E2E 环境配置失败：${result.error.message}`);
}

if (explicitTestDatabaseUrl) {
  process.env.DATABASE_URL = explicitTestDatabaseUrl;
}

// dotenv 文件不得改变测试环境语义，数据库地址还要经过 host/name/user 三重白名单。
process.env.NODE_ENV = 'test';
assertSafeTestDatabaseConnection({
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
});
