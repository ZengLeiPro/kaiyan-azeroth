-- 客户「最近修改」是客户主表及其 8 类直接关联业务对象的聚合活动时间。
--
-- 这里使用语句级触发器而不是 Service 钩子，确保 Prisma、审批流、批量操作、
-- 派生更新、内部脚本和直接 SQL 走同一条规则。触发器只更新时间：
-- 不递增 customers.version，不改 updaterEmployeeId，也不生成操作日志。

CREATE OR REPLACE FUNCTION "public"."touch_customers_updated_at_from_related_insert"()
RETURNS TRIGGER AS $$
DECLARE
  affected_customer_ids TEXT[];
  touched_at TIMESTAMP(3);
BEGIN
  SELECT COALESCE(
    array_agg(DISTINCT "customerId" ORDER BY "customerId"),
    ARRAY[]::TEXT[]
  )
  INTO affected_customer_ids
  FROM new_rows
  WHERE "customerId" IS NOT NULL;

  IF cardinality(affected_customer_ids) = 0 THEN
    RETURN NULL;
  END IF;

  -- 多客户语句按固定顺序加锁，降低并发批量操作的死锁概率。
  PERFORM 1
  FROM "public"."customers" AS customer
  WHERE customer."id" = ANY(affected_customer_ids)
  ORDER BY customer."id"
  FOR UPDATE;

  touched_at := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);

  UPDATE "public"."customers" AS customer
  SET "updatedAt" = GREATEST(customer."updatedAt", touched_at)
  WHERE customer."id" = ANY(affected_customer_ids);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_customers_updated_at_from_related_update"()
RETURNS TRIGGER AS $$
DECLARE
  affected_customer_ids TEXT[];
  touched_at TIMESTAMP(3);
BEGIN
  SELECT COALESCE(
    array_agg("customerId" ORDER BY "customerId"),
    ARRAY[]::TEXT[]
  )
  INTO affected_customer_ids
  FROM (
    SELECT "customerId"
    FROM old_rows
    WHERE "customerId" IS NOT NULL
    UNION
    SELECT "customerId"
    FROM new_rows
    WHERE "customerId" IS NOT NULL
  ) AS affected;

  IF cardinality(affected_customer_ids) = 0 THEN
    RETURN NULL;
  END IF;

  -- customerId 改绑时，旧客户与新客户都必须更新；同样按固定顺序加锁。
  PERFORM 1
  FROM "public"."customers" AS customer
  WHERE customer."id" = ANY(affected_customer_ids)
  ORDER BY customer."id"
  FOR UPDATE;

  touched_at := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);

  UPDATE "public"."customers" AS customer
  SET "updatedAt" = GREATEST(customer."updatedAt", touched_at)
  WHERE customer."id" = ANY(affected_customer_ids);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "public"."touch_customers_updated_at_from_related_delete"()
RETURNS TRIGGER AS $$
DECLARE
  affected_customer_ids TEXT[];
  touched_at TIMESTAMP(3);
BEGIN
  SELECT COALESCE(
    array_agg(DISTINCT "customerId" ORDER BY "customerId"),
    ARRAY[]::TEXT[]
  )
  INTO affected_customer_ids
  FROM old_rows
  WHERE "customerId" IS NOT NULL;

  IF cardinality(affected_customer_ids) = 0 THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM "public"."customers" AS customer
  WHERE customer."id" = ANY(affected_customer_ids)
  ORDER BY customer."id"
  FOR UPDATE;

  touched_at := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);

  UPDATE "public"."customers" AS customer
  SET "updatedAt" = GREATEST(customer."updatedAt", touched_at)
  WHERE customer."id" = ANY(affected_customer_ids);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 联系人
CREATE TRIGGER "contacts_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."contacts"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "contacts_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."contacts"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "contacts_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."contacts"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 跟进记录
CREATE TRIGGER "keep_records_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."keep_records"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "keep_records_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."keep_records"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "keep_records_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."keep_records"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 拜访记录
CREATE TRIGGER "visit_records_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."visit_records"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "visit_records_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."visit_records"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "visit_records_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."visit_records"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 商机
CREATE TRIGGER "opportunities_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."opportunities"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "opportunities_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."opportunities"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "opportunities_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."opportunities"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 合同订单
CREATE TRIGGER "sale_orders_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."sale_orders"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "sale_orders_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."sale_orders"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "sale_orders_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."sale_orders"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 回款 / 退款
CREATE TRIGGER "payments_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."payments"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "payments_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."payments"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "payments_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."payments"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 发票
CREATE TRIGGER "invoices_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."invoices"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "invoices_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."invoices"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "invoices_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."invoices"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 项目；customerId 可空，空值由函数统一忽略。
CREATE TRIGGER "projects_touch_customer_updated_at_insert"
AFTER INSERT ON "public"."projects"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_insert"();

CREATE TRIGGER "projects_touch_customer_updated_at_update"
AFTER UPDATE ON "public"."projects"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_update"();

CREATE TRIGGER "projects_touch_customer_updated_at_delete"
AFTER DELETE ON "public"."projects"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."touch_customers_updated_at_from_related_delete"();

-- 把存量客户的聚合活动时间补齐。保留客户主表原本更晚的时间，
-- 并纳入已软删除的关联对象，因为软删除本身也是一次客户活动。
WITH related_activity AS (
  SELECT activity."customerId", MAX(activity."updatedAt") AS "updatedAt"
  FROM (
    SELECT "customerId", "updatedAt" FROM "public"."contacts"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."keep_records"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."visit_records"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."opportunities"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."sale_orders"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."payments"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."invoices"
    UNION ALL
    SELECT "customerId", "updatedAt" FROM "public"."projects"
  ) AS activity
  WHERE activity."customerId" IS NOT NULL
  GROUP BY activity."customerId"
)
UPDATE "public"."customers" AS customer
SET "updatedAt" = GREATEST(customer."updatedAt", related_activity."updatedAt")
FROM related_activity
WHERE customer."id" = related_activity."customerId"
  AND related_activity."updatedAt" > customer."updatedAt";
