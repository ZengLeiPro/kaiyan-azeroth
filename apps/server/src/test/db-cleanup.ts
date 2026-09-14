// eslint-disable-next-line no-restricted-imports -- 测试基础设施需要调用 prisma migrate deploy
import { execSync } from 'child_process';
import path from 'path';

import { PrismaService } from '../common/prisma/prisma.service';
import { assertSafeTestDatabaseConnection } from '../common/prisma/test-database-safety';

/**
 * 清理测试数据库所有数据（TRUNCATE CASCADE）
 *
 * 封装 PrismaService.cleanDatabase()，确保 NODE_ENV=test。
 */
export async function cleanTestDatabase(prisma: PrismaService): Promise<void> {
  await prisma.cleanDatabase();
}

/**
 * 对测试数据库执行 Prisma 迁移
 *
 * 用于 E2E 测试的 beforeAll，确保表结构是最新的。
 * 注意：需要 DATABASE_URL 指向测试数据库。
 */
export function migrateTestDatabase(): void {
  const dbUrl = process.env.DATABASE_URL;
  assertSafeTestDatabaseConnection({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: dbUrl,
  });

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: dbUrl },
    stdio: 'pipe',
  });
}
