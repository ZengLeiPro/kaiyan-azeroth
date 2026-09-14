BEGIN;

-- 历史负向订单显式建模：新代码只读该标识，普通创建/编辑接口不可写。
ALTER TABLE "public"."sale_orders"
ADD COLUMN IF NOT EXISTS "legacyAdjustment" BOOLEAN NOT NULL DEFAULT FALSE;

-- 空库/新环境无负向订单时跳过。公开副本不包含实例订单或金额指纹。
LOCK TABLE "public"."sale_orders" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "public"."payments" IN SHARE MODE;

DO $$
DECLARE
  negative_order_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
    INTO negative_order_count
    FROM "public"."sale_orders"
   WHERE "deletedAt" IS NULL
     AND "orderAmount" < 0;

  IF negative_order_count = 0 THEN
    RETURN;
  END IF;

  -- 公开副本不按外部系统 ID 回填存量。负向订单保持默认 false，由安装方自行治理。
  RETURN;
END $$;

COMMIT;
