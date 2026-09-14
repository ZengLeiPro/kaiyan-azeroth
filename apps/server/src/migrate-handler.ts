import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

export const MIGRATION_SUCCESS_MARKER = 'KY_AZEROTH_MIGRATION_OK';
export const LEGACY_ADJUSTMENT_BROKEN_MIGRATION = '20260827113500_add_sale_order_legacy_adjustment';

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type PrismaCommandRunner = (
  args: string[],
  env: NodeJS.ProcessEnv
) => Promise<CommandResult>;

export type LegacyMigrationProbe = (databaseUrl: string) => Promise<'deploy' | 'resolve-broken'>;

export function runPrismaCommand(args: string[], env: NodeJS.ProcessEnv): Promise<CommandResult> {
  const prismaCli = resolve(__dirname, '../node_modules/prisma/build/index.js');
  const schemaPath = resolve(__dirname, '../prisma/schema.prisma');

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [prismaCli, ...args, '--schema', schemaPath], {
      cwd: resolve(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(new Error(`Prisma command failed (${code}): ${args.join(' ')}\n${stderr}`));
      }
    });
  });
}

export async function probeLegacyAdjustmentMigration(
  databaseUrl: string
): Promise<'deploy' | 'resolve-broken'> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    // @prisma-raw-sql: Prisma 没有查询 PostgreSQL relation 是否存在的模型 API。
    const prerequisites = await prisma.$queryRaw<
      Array<{
        saleOrders: string | null;
        prismaMigrations: string | null;
        paymentLegacyAdjustment: boolean;
      }>
    >`
      SELECT
        to_regclass('public.sale_orders')::text AS "saleOrders",
        to_regclass('public._prisma_migrations')::text AS "prismaMigrations",
        EXISTS (
          SELECT 1
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'payments'
             AND column_name = 'legacyAdjustment'
        ) AS "paymentLegacyAdjustment"
    `;
    const prerequisite = prerequisites[0];
    if (
      !prerequisite?.saleOrders ||
      !prerequisite.prismaMigrations ||
      !prerequisite.paymentLegacyAdjustment
    ) {
      return 'deploy';
    }

    // @prisma-raw-sql: 恢复演练必须读取 Prisma 自身迁移元数据，且名称通过 tagged 参数绑定。
    const migrations = await prisma.$queryRaw<Array<{ finishedAt: Date | null }>>`
      SELECT "finished_at" AS "finishedAt"
         FROM "public"."_prisma_migrations"
        WHERE "migration_name" = ${LEGACY_ADJUSTMENT_BROKEN_MIGRATION}
        ORDER BY "started_at" DESC
        LIMIT 1
    `;
    if (migrations[0]?.finishedAt) return 'deploy';

    // 公开副本不携带实例订单/回款指纹，也不自动 resolve 历史错误迁移。
    return 'deploy';
  } finally {
    await prisma.$disconnect();
  }
}

export async function runProductionMigrations(
  runner: PrismaCommandRunner = runPrismaCommand,
  databaseUrl = process.env['DATABASE_URL'],
  probe: LegacyMigrationProbe = probeLegacyAdjustmentMigration
): Promise<CommandResult> {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL 未配置，拒绝执行生产迁移');
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  if ((await probe(databaseUrl)) === 'resolve-broken') {
    console.warn(`恢复库命中已知错误迁移指纹，安全跳过 ${LEGACY_ADJUSTMENT_BROKEN_MIGRATION}`);
    await runner(['migrate', 'resolve', '--applied', LEGACY_ADJUSTMENT_BROKEN_MIGRATION], env);
  }
  return runner(['migrate', 'deploy'], env);
}

/**
 * 独立 FC 事件函数入口：只执行 Prisma 迁移，不启动 NestJS、cron 或任何业务服务。
 * 由 GitHub Actions 通过阿里云鉴权的 `s invoke` 调用，不暴露 HTTP trigger。
 */
export async function handler(): Promise<{
  success: true;
  marker: string;
  output: string;
}> {
  const { stdout, stderr } = await runProductionMigrations();
  const output = [stdout, stderr].filter(Boolean).join('\n');
  console.log(MIGRATION_SUCCESS_MARKER);
  return { success: true, marker: MIGRATION_SUCCESS_MARKER, output };
}
