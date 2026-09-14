-- =====================================================================
-- Push 5: 切流量到 employeeId 单写 + user_roles 主键切换
--
-- 前置条件（Push 4 已完成）：
-- - 6 张 FK 表 employeeId 列已加 + 数据已回填
-- - approval 历史 ID 已迁移
-- - service 双写中（push 5 起删 userId 写入侧）
--
-- 包含：
-- A. user_roles 主键切换 (userId, roleId) → (employeeId, roleId)
-- B. sessions / PAT / notifications.userId 改 nullable（停止写入预备）
-- C. notifications.userId FK 从 NoAction 改 SET NULL（user 删除时通知 userId 清空）
-- =====================================================================

-- ===================== A. user_roles 主键切换 =====================
-- 验证前置（应为 0）：
--   SELECT count(*) FROM user_roles WHERE "employeeId" IS NULL;

ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey",
  ALTER COLUMN "userId" DROP NOT NULL,
  ALTER COLUMN "employeeId" SET NOT NULL,
  ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("employeeId", "roleId");

-- 删除 push 4 加的临时 unique 约束（已成主键）
DROP INDEX IF EXISTS "user_roles_employeeId_idx";
DROP INDEX IF EXISTS "user_roles_employeeId_roleId_key";
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- ===================== B. 停写 userId 准备：改 nullable =====================

ALTER TABLE "sessions" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "personal_access_tokens" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "userId" DROP NOT NULL;

-- ===================== C. notifications.userId FK 改 SET NULL =====================

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- 验证查询（注释）
-- =====================================================================
-- 1. user_roles 主键切换成功：
--    SELECT count(*) FROM user_roles GROUP BY "employeeId", "roleId" HAVING count(*) > 1;  -- 应空
--
-- 2. 6 表的 userId 仍为非 NULL（push 5 期间保留旧数据）：
--    SELECT count(*) FROM sessions WHERE "userId" IS NOT NULL;  -- 应等同 push 4 后值
--
-- 3. push 5 后新创建的记录 userId 应为 NULL（service 已停止写入）：
--    SELECT count(*) FROM sessions WHERE "userId" IS NULL AND created_at > NOW() - INTERVAL '1 day';
