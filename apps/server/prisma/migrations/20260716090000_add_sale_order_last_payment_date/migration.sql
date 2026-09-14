-- 合同订单：新增 lastPaymentDate（最近回款日期）派生列
-- 口径：MAX(Payment.businessDate WHERE direction='IN' AND flowStatus='approved' AND deletedAt IS NULL)
-- 与 totalReceived 同口径，由 payment-summary.helper 在回款增删改/审批后维护；
-- 与手工录入的 paymentDate（「回款时间」）语义不同。
ALTER TABLE "sale_orders" ADD COLUMN "lastPaymentDate" TIMESTAMP(3);

CREATE INDEX "sale_orders_lastPaymentDate_idx" ON "sale_orders"("lastPaymentDate");

-- 存量回填：只 UPDATE 新列，不触碰其他数据
UPDATE "sale_orders" so
SET "lastPaymentDate" = agg.max_business_date
FROM (
  SELECT "saleOrderId", MAX("businessDate") AS max_business_date
  FROM "payments"
  WHERE "direction" = 'IN'
    AND "flowStatus" = 'approved'
    AND "deletedAt" IS NULL
  GROUP BY "saleOrderId"
) agg
WHERE so."id" = agg."saleOrderId";
