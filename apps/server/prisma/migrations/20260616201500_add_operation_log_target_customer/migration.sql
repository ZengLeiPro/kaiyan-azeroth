-- 活动时间线投影字段（2026-06-16）
-- 目的：让 GET /customers/:id/activities 能 O(log n) 过滤出某客户的所有
-- CrmChangeLogService 写入记录（订单/商机/回款/开票/联系人/跟进/拜访等
-- 字段级变更），与 keep_records / visit_records 一起 union 成统一时间线。

-- AlterTable
ALTER TABLE "operation_logs" ADD COLUMN "targetCustomerId" VARCHAR(50);

-- CreateIndex
CREATE INDEX "operation_logs_targetCustomerId_createdAt_idx"
  ON "operation_logs"("targetCustomerId", "createdAt" DESC);
