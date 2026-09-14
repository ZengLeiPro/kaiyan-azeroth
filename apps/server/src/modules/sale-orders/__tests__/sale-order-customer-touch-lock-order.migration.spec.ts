import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATION_DIRECTORY = '20260824115000_order_sale_order_customer_touch_locks';
const migrationPath = [
  resolve(process.cwd(), 'prisma/migrations', MIGRATION_DIRECTORY, 'migration.sql'),
  resolve(process.cwd(), 'apps/server/prisma/migrations', MIGRATION_DIRECTORY, 'migration.sql'),
].find(existsSync);

if (!migrationPath) {
  throw new Error(`找不到 ${MIGRATION_DIRECTORY}/migration.sql`);
}

const migrationSql = readFileSync(migrationPath, 'utf8');
const executableSql = migrationSql.replace(/^\s*--.*$/gm, '');

function functionBody(operation: 'insert' | 'update' | 'delete'): string {
  const name = `touch_customers_updated_at_from_related_${operation}`;
  const match = migrationSql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION "public"\\."${name}"\\(\\)[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`
    )
  );
  if (!match?.[1]) throw new Error(`迁移缺少函数 ${name}`);
  return match[1];
}

describe('SaleOrder customer touch lock-order forward migration', () => {
  it('原位幂等替换三个函数，不删除或重建既有 statement-level triggers', () => {
    expect(executableSql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(3);
    expect(executableSql.match(/SET search_path = pg_catalog, public/g)).toHaveLength(3);
    expect(executableSql).not.toMatch(/\b(?:DROP|CREATE|ALTER)\s+TRIGGER\b/i);
    expect(executableSql).not.toMatch(/\bDROP\s+FUNCTION\b/i);
  });

  it.each(['insert', 'update', 'delete'] as const)(
    '%s 按 Opportunity(s) → Customer(s) 顺序取得排序行锁',
    (operation) => {
      const body = functionBody(operation);
      const opportunityLock = body.indexOf('FROM "public"."opportunities" AS opportunity');
      const customerLock = body.indexOf('FROM "public"."customers" AS customer');

      expect(body).toContain("TG_TABLE_SCHEMA = 'public'");
      expect(body).toContain("TG_TABLE_NAME = 'sale_orders'");
      expect(body).toMatch(
        /array_agg\(DISTINCT [\s\S]*?"opportunityId" ORDER BY [\s\S]*?"opportunityId"\)/
      );
      expect(opportunityLock).toBeGreaterThan(-1);
      expect(customerLock).toBeGreaterThan(opportunityLock);
      expect(body.slice(opportunityLock, customerLock)).toContain('FOR UPDATE');
      expect(body.slice(customerLock)).toContain('FOR UPDATE');
    }
  );

  it('UPDATE 对 old/new opportunityId 与 old/new customerId 均去重并排序', () => {
    const body = functionBody('update');

    for (const transitionReference of [
      'old_related."opportunityId"',
      'new_related."opportunityId"',
      'old_related."customerId"',
      'new_related."customerId"',
    ]) {
      expect(body).toContain(transitionReference);
    }

    expect(body.match(/array_agg\(DISTINCT affected\./g)).toHaveLength(2);
    expect(body.match(/ORDER BY affected\./g)).toHaveLength(2);
  });

  it('UPDATE transition rows 仅在占用或生效事实变化时纳入 Opportunity 行锁集合', () => {
    const body = functionBody('update');
    const relationshipFilter = [
      'old_related."opportunityId" IS DISTINCT FROM new_related."opportunityId"',
      'old_related."customerId" IS DISTINCT FROM new_related."customerId"',
      'old_related."deletedAt" IS DISTINCT FROM new_related."deletedAt"',
      'old_related."flowStatus" IS DISTINCT FROM new_related."flowStatus"',
    ];

    expect(body.match(/INNER JOIN (?:new|old)_rows AS/g)).toHaveLength(2);
    for (const predicate of relationshipFilter) {
      expect(body.match(new RegExp(predicate.replace(/[".]/g, '\\$&'), 'g'))).toHaveLength(2);
    }
    expect(body).toContain('Amount/remark/product aggregate/version-only updates proceed directly');
  });

  it('INSERT/DELETE 保留原 new/old customer touch 语义', () => {
    expect(functionBody('insert')).toMatch(/FROM new_rows AS related[\s\S]*?"customerId"/);
    expect(functionBody('delete')).toMatch(/FROM old_rows AS related[\s\S]*?"customerId"/);
  });
});
