-- AlterTable: User 新增登录失败锁定字段
ALTER TABLE "users" ADD COLUMN "loginFailCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockUntil" TIMESTAMP(3);

-- AlterTable: LoginLog.userId 改为可选（支持记录用户不存在的登录失败）
ALTER TABLE "login_logs" ALTER COLUMN "userId" DROP NOT NULL;

-- DropForeignKey: 移除旧的必填外键约束
ALTER TABLE "login_logs" DROP CONSTRAINT IF EXISTS "login_logs_userId_fkey";

-- AddForeignKey: 重新添加为可选外键约束
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
