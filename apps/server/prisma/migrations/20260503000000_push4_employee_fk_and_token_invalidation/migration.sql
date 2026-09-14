-- =====================================================================
-- Push 4: 鉴权身份切换里程碑
--
-- 包含：
-- A. 6 张 FK 表加 employeeId 列 + FK + 索引（双写预备）
-- B. employees 加 tokenInvalidAfter 列（强制重登机制）
-- C. 数据回填：6 张 FK 表 employeeId 从 user.employeeId 反查
-- D. approval 历史 ID 迁移：approverId/initiatorId/operatorId 从 user.id → employee.id
--
-- 部署后运维步骤（详见 push5-push6-预演SQL.md "Push 4 部署日运维步骤"）：
-- 1. 验证 6 表 employeeId 回填成功（无 NULL，除非该 user 没绑 employee，但生产 39/39 都绑了）
-- 2. 批量 UPDATE employees SET "tokenInvalidAfter" = NOW(); 强制全员重登
-- =====================================================================

-- ===================== A. 6 张 FK 表加 employeeId 列 =====================

ALTER TABLE "sessions" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "personal_access_tokens" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "user_roles" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "operation_logs" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "login_logs" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "employeeId" TEXT;

-- ===================== B. employees 加 tokenInvalidAfter =====================

ALTER TABLE "employees" ADD COLUMN "tokenInvalidAfter" TIMESTAMP(3);

-- ===================== C. 数据回填（6 表 employeeId） =====================
-- 生产 39 user 100% 绑定 employeeId，INNER JOIN 全命中

UPDATE "sessions" t SET "employeeId" = u."employeeId"
  FROM "users" u WHERE u.id = t."userId" AND u."employeeId" IS NOT NULL;

UPDATE "personal_access_tokens" t SET "employeeId" = u."employeeId"
  FROM "users" u WHERE u.id = t."userId" AND u."employeeId" IS NOT NULL;

UPDATE "user_roles" t SET "employeeId" = u."employeeId"
  FROM "users" u WHERE u.id = t."userId" AND u."employeeId" IS NOT NULL;

UPDATE "operation_logs" t SET "employeeId" = u."employeeId"
  FROM "users" u WHERE u.id = t."userId" AND u."employeeId" IS NOT NULL;

UPDATE "login_logs" t SET "employeeId" = u."employeeId"
  FROM "users" u WHERE u.id = t."userId" AND u."employeeId" IS NOT NULL;

UPDATE "notifications" t SET "employeeId" = u."employeeId"
  FROM "users" u WHERE u.id = t."userId" AND u."employeeId" IS NOT NULL;

-- ===================== D. approval 历史 ID 迁移 =====================
-- approver_id / initiator_id / operator_id 字段历史值是 user.id，迁移到 employee.id

UPDATE "approval_tasks" t SET "approverId" = u."employeeId"
  FROM "users" u WHERE u.id = t."approverId" AND u."employeeId" IS NOT NULL;

UPDATE "approval_instances" t SET "initiatorId" = u."employeeId"
  FROM "users" u WHERE u.id = t."initiatorId" AND u."employeeId" IS NOT NULL;

UPDATE "approval_records" t SET "operatorId" = u."employeeId"
  FROM "users" u WHERE u.id = t."operatorId" AND u."employeeId" IS NOT NULL;

-- ===================== 索引 + 外键 =====================

CREATE INDEX "sessions_employeeId_idx" ON "sessions"("employeeId");
CREATE INDEX "personal_access_tokens_employeeId_idx" ON "personal_access_tokens"("employeeId");
CREATE INDEX "user_roles_employeeId_idx" ON "user_roles"("employeeId");
CREATE INDEX "operation_logs_employeeId_idx" ON "operation_logs"("employeeId");
CREATE INDEX "login_logs_employeeId_idx" ON "login_logs"("employeeId");
CREATE INDEX "notifications_employeeId_idx" ON "notifications"("employeeId");

CREATE UNIQUE INDEX "user_roles_employeeId_roleId_key" ON "user_roles"("employeeId", "roleId");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- 验证查询（注释；运行 migration 后人工跑一次）
-- =====================================================================
-- 1. 6 表 employeeId 回填验证（应都为 0 或仅记录指向已删 user 的孤儿）：
--    SELECT count(*) FROM sessions WHERE "userId" IS NOT NULL AND "employeeId" IS NULL;
--    SELECT count(*) FROM personal_access_tokens WHERE "userId" IS NOT NULL AND "employeeId" IS NULL;
--    SELECT count(*) FROM user_roles WHERE "employeeId" IS NULL;
--    SELECT count(*) FROM operation_logs WHERE "userId" IS NOT NULL AND "employeeId" IS NULL;
--    SELECT count(*) FROM login_logs WHERE "userId" IS NOT NULL AND "employeeId" IS NULL;
--    SELECT count(*) FROM notifications WHERE "userId" IS NOT NULL AND "employeeId" IS NULL;
--
-- 2. approval 迁移验证（应为 0，无 approverId 仍在 users 表中）：
--    SELECT count(*) FROM approval_tasks t INNER JOIN users u ON u.id = t."approverId";
--    SELECT count(*) FROM approval_instances t INNER JOIN users u ON u.id = t."initiatorId";
--    SELECT count(*) FROM approval_records t INNER JOIN users u ON u.id = t."operatorId";
--
-- 3. 强制全员重登（部署后手动跑）：
--    UPDATE employees SET "tokenInvalidAfter" = NOW();
