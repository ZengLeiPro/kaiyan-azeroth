import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { assertSafeTestDatabaseConnection } from './test-database-safety';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('数据库连接成功');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('数据库连接已关闭');
  }

  /**
   * 清理数据库（仅用于测试）
   */
  async cleanDatabase(): Promise<void> {
    assertSafeTestDatabaseConnection({
      nodeEnv: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL,
    });

    // @prisma-raw-sql: 获取所有表名用于测试环境清理（pg_tables 系统表查询，Prisma Client 不支持）
    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    const tables = tablenames
      .map(({ tablename }) => tablename)
      .filter((name) => name !== '_prisma_migrations')
      .map((name) => `"public"."${name}"`)
      .join(', ');

    if (!tables) {
      return;
    }

    try {
      // @prisma-raw-sql-unsafe: 批量 TRUNCATE 清理测试数据，需动态拼接表名（Prisma Client 不支持批量 TRUNCATE CASCADE）
      await this.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
    } catch (error) {
      this.logger.error('清理数据库失败', error);
      throw error;
    }
  }
}
