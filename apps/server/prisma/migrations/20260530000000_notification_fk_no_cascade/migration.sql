-- 业务实体软删除策略修复（CLAUDE.md 9.7.2）：
-- Notification 是含 deletedAt + version 的软删除业务实体，其 employeeId 外键不应级联物理删除，
-- 否则物理删除 Employee 时会连带物理清除其全部通知，绕过软删除策略。
-- 将 ON DELETE CASCADE 改为 ON DELETE RESTRICT（与 contacts/opportunities 等业务外键一致）。

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_employeeId_fkey";

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
