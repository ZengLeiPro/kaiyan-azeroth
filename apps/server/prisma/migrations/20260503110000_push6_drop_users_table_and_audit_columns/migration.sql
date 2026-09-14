-- =====================================================================
-- Push 6: destructive 清理 完成 users to employees 合并工程
--
-- 前置条件 push 5 已完成
-- 1 service 全部读写 employee.id 维度 createdBy/updatedBy 已停写
-- 2 user_roles 主键已切到 employeeId roleId
-- 3 sessions personal_access_tokens notifications.userId 已 nullable 停写
--
-- 执行内容
-- A 前置数据清理 删除 sessions PAT notifications 中 employeeId NULL 的孤儿行
-- B DROP CONSTRAINT 9 个 user.id 相关 FK
-- C DROP INDEX 6 个 user.id 相关索引
-- D ALTER TABLE 删字段
--    6 张表 DROP userId 列
--    53 张表 DROP createdBy updatedBy
--    sessions notifications PAT.employeeId SET NOT NULL
-- E DROP TABLE users CASCADE
--
-- 风险 极高 destructive 不可逆 执行前必须 RDS 备份 + 恢复测试
-- =====================================================================

-- A 前置清理 删除孤儿行 避免 SET NOT NULL 失败
DELETE FROM "sessions" WHERE "employeeId" IS NULL;
DELETE FROM "personal_access_tokens" WHERE "employeeId" IS NULL;
DELETE FROM "notifications" WHERE "employeeId" IS NULL;

-- B-E prisma migrate diff 生成的 destructive SQL


-- DropForeignKey
ALTER TABLE "login_logs" DROP CONSTRAINT "login_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_userId_fkey";

-- DropForeignKey
ALTER TABLE "operation_logs" DROP CONSTRAINT "operation_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "personal_access_tokens" DROP CONSTRAINT "personal_access_tokens_userId_fkey";

-- DropForeignKey
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_userId_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_userId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_creatorEmployeeId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_employeeId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_updaterEmployeeId_fkey";

-- DropIndex
DROP INDEX "login_logs_userId_idx";

-- DropIndex
DROP INDEX "notifications_userId_idx";

-- DropIndex
DROP INDEX "operation_logs_userId_idx";

-- DropIndex
DROP INDEX "personal_access_tokens_userId_idx";

-- DropIndex
DROP INDEX "sessions_userId_idx";

-- DropIndex
DROP INDEX "user_roles_userId_idx";

-- AlterTable
ALTER TABLE "approval_flow_nodes" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "approval_flows" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "approval_instances" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "approval_tasks" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "body_metrics" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "crm_products" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "crm_work_dailies" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "customers" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "departments" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_daily_logs" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_daily_meal_entries" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_daily_supplement_entries" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_foods" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_meal_slots" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_plan_supplements" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_plans" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_purchase_items" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_subjective_logs" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_supplements" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "diet_water_logs" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "effort_records" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "employee_departments" DROP COLUMN "createdBy";

-- AlterTable
ALTER TABLE "employees" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "filter_schemes" DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "keep_records" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "login_logs" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "notifications" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy",
DROP COLUMN "userId",
ALTER COLUMN "employeeId" SET NOT NULL;

-- AlterTable
ALTER TABLE "operation_logs" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "opportunities" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "opportunity_products" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "order_products" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "payroll_import_batches" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "payroll_periods" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "payroll_records" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "personal_access_tokens" DROP COLUMN "createdBy",
DROP COLUMN "userId",
ALTER COLUMN "employeeId" SET NOT NULL;

-- AlterTable
ALTER TABLE "project_members" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "project_sale_orders" DROP COLUMN "createdBy";

-- AlterTable
ALTER TABLE "project_tickets" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "sale_orders" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "userId",
ALTER COLUMN "employeeId" SET NOT NULL;

-- AlterTable
ALTER TABLE "system_configs" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- AlterTable
ALTER TABLE "user_roles" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "visit_records" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy";

-- DropTable
DROP TABLE "users";



-- =====================================================================
-- 验证查询 注释 部署后手工跑
-- =====================================================================
-- 1 users 表已删除 \dt users 应报 relation does not exist
-- 2 6 张鉴权 FK 表已无 userId 列
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('sessions','personal_access_tokens','user_roles','operation_logs','login_logs','notifications')
--     AND column_name = 'userId';
-- 3 53 张表已无 createdBy updatedBy 列
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE column_name IN ('createdBy','updatedBy') AND table_schema='public';
-- 4 sessions PAT notifications.employeeId 全 NOT NULL
--   SELECT count(*) FROM sessions WHERE "employeeId" IS NULL;
