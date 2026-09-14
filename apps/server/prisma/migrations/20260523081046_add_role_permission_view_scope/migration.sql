-- AlterTable
ALTER TABLE "role_permissions" ADD COLUMN     "viewScope" VARCHAR(20) NOT NULL DEFAULT 'SELF';

-- CreateIndex
CREATE INDEX "role_permissions_module_menu_idx" ON "role_permissions"("module", "menu");

-- Backfill: 给 CRM_MANAGER 角色已存在的所有 RolePermission 行设置 viewScope = 'ALL'
-- 决策依据：D1（DEPT 档已砍，CRM_MANAGER 从“部门内”扩权为“全部”，与产品决策一致）
UPDATE "role_permissions"
SET "viewScope" = 'ALL'
WHERE "roleId" IN (
  SELECT id FROM "roles" WHERE code = 'CRM_MANAGER' AND "deletedAt" IS NULL
);

-- Backfill: 给 PM 角色的 projects.effort_stats 菜单设置 ALL（项目经理需要看跨员工工时）
UPDATE "role_permissions"
SET "viewScope" = 'ALL'
WHERE module = 'projects' AND menu = 'effort_stats'
  AND "roleId" IN (
    SELECT id FROM "roles" WHERE code = 'PM' AND "deletedAt" IS NULL
  );

-- 其他所有现有行保持 viewScope = 'SELF'（默认值已写入）
-- 验证：所有 RolePermission 行必须有 viewScope 值，不应有 NULL
-- 由 schema 默认值 + UPDATE 双保险，无需额外 NOT NULL 兜底
