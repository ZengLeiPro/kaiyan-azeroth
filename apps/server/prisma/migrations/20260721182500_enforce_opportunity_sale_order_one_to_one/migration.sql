-- 商机与有效合同订单从本迁移起严格一对一。
--
-- 生产库存在少量历史一商机多订单数据，不能直接创建普通 UNIQUE(opportunityId)。
-- 该触发器只拦截今后的新建、改绑和恢复，不触碰历史关联，也不阻断历史订单的普通编辑。
CREATE OR REPLACE FUNCTION "enforce_sale_order_opportunity_one_to_one"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."opportunityId" IS NULL OR NEW."deletedAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW."opportunityId" IS NOT DISTINCT FROM OLD."opportunityId"
       AND OLD."deletedAt" IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('sale_order_opportunity:' || NEW."opportunityId", 0)
  );

  IF EXISTS (
    SELECT 1
    FROM "public"."sale_orders" AS existing
    WHERE existing."opportunityId" = NEW."opportunityId"
      AND existing."deletedAt" IS NULL
      AND existing."id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'sale_orders_opportunity_one_to_one',
      DETAIL = '一条商机只能关联一份有效合同订单';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "sale_orders_opportunity_one_to_one_guard"
BEFORE INSERT OR UPDATE OF "opportunityId", "deletedAt"
ON "public"."sale_orders"
FOR EACH ROW
EXECUTE FUNCTION "enforce_sale_order_opportunity_one_to_one"();
