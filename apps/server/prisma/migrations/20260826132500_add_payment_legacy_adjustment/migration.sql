-- Expand-only：为 YCCRM 历史负数订单提供显式负向调整语义。
-- 本迁移只新增带默认值的列，不触碰生产历史数据；数据治理由受控 contract 执行器另行完成。
ALTER TABLE "public"."payments"
ADD COLUMN "legacyAdjustment" BOOLEAN NOT NULL DEFAULT FALSE;
