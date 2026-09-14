-- v2.2 Phase 11：PaymentItem.saleOrderProductId NOT NULL 收紧
--
-- 前置（push 前必须验证通过）：
--   SELECT COUNT(*) FROM payment_items
--   WHERE "saleOrderProductId" IS NULL AND "deletedAt" IS NULL;
--   -- 期望：0
--
-- 由 fallback service (PR #50) execute=true 跑完 98 条填充后才能 push。
-- 若仍有 NULL 行，此 migration 在生产 RDS 会失败回滚整个部署。

-- AlterTable
ALTER TABLE "payment_items" ALTER COLUMN "saleOrderProductId" SET NOT NULL;
