import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_DIRECTORY = '20260824173000_approval_target_version_opportunity_won_provenance';
const migrationPath = [
  resolve(process.cwd(), 'prisma/migrations', MIGRATION_DIRECTORY, 'migration.sql'),
  resolve(process.cwd(), 'apps/server/prisma/migrations', MIGRATION_DIRECTORY, 'migration.sql'),
].find(existsSync);

if (!migrationPath) throw new Error(`找不到 ${MIGRATION_DIRECTORY}/migration.sql`);

const migrationSql = readFileSync(migrationPath, 'utf8');
const executableSql = migrationSql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');

describe('approval targetVersion + Opportunity WON provenance expand migration', () => {
  it('只新增 nullable 列，不附带 backfill、默认值或收紧约束', () => {
    expect(executableSql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|MERGE)\b/i);
    expect(executableSql).not.toMatch(/\b(?:NOT\s+NULL|DEFAULT|ADD\s+CONSTRAINT)\b/i);
    expect(executableSql.match(/\bADD\s+COLUMN\b/gi)).toHaveLength(6);
  });

  it('ApprovalInstance 保留精确 targetVersion 快照列', () => {
    expect(executableSql).toMatch(
      /ALTER TABLE "public"\."approval_instances"\s+ADD COLUMN "targetVersion" INTEGER;/
    );
  });

  it('Opportunity provenance 五列与 Prisma schema 命名和精度一致', () => {
    for (const column of [
      'wonSourceType',
      'wonSourceSaleOrderId',
      'wonSourcePreviousStage',
      'wonSourcePreviousDealDate',
      'wonSourcePreviousWinRate',
    ]) {
      expect(executableSql).toContain(`ADD COLUMN "${column}"`);
    }
    expect(executableSql).toContain('"wonSourcePreviousWinRate" DECIMAL(5,2)');
  });

  it('历史数据不猜 WON 来源：迁移不把 NULL provenance 回填为 manual/sale_order', () => {
    expect(executableSql).not.toMatch(/'manual'|'sale_order'/);
  });
});
