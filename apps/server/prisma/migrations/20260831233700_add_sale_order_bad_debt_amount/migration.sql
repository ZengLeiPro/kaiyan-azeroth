-- 坏账按订单维度登记，并从未收余额/客户应收中核销；不伪造成实际回款。
ALTER TABLE "public"."sale_orders"
ADD COLUMN "badDebtAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
