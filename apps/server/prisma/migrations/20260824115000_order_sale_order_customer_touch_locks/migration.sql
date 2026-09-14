-- Forward-only lock-order repair for the existing customer related-activity triggers.
--
-- The three shared trigger functions remain compatible with every related table. Only sale_orders
-- takes additional Opportunity row locks. UPDATE filters transition rows to occupancy-fact
-- changes (including flowStatus effectiveness transitions), then sorts/deduplicates OLD/NEW
-- opportunityId values before Customer locks:
--
--   SaleOrder row(s) -> Opportunity row(s), sorted -> Customer row(s), sorted
--
-- CREATE OR REPLACE is deliberate: the 24 installed statement-level triggers keep referencing the
-- same function identities, so there is no DROP/CREATE trigger window. Reapplying this migration is
-- idempotent, and it is safe to deploy before the application change.

CREATE OR REPLACE FUNCTION "public"."touch_customers_updated_at_from_related_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  affected_opportunity_ids TEXT[];
  affected_customer_ids TEXT[];
  touched_at TIMESTAMP(3);
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'sale_orders' THEN
    SELECT COALESCE(
      array_agg(DISTINCT related."opportunityId" ORDER BY related."opportunityId"),
      ARRAY[]::TEXT[]
    )
    INTO affected_opportunity_ids
    FROM new_rows AS related
    WHERE related."opportunityId" IS NOT NULL;

    -- The SaleOrder INSERT already owns its row lock. Lock referenced opportunities next, in a
    -- deterministic order, before the generic customer-touch path can lock any customer.
    PERFORM opportunity."id"
    FROM "public"."opportunities" AS opportunity
    WHERE opportunity."id" = ANY(affected_opportunity_ids)
    ORDER BY opportunity."id"
    FOR UPDATE;
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT related."customerId" ORDER BY related."customerId"),
    ARRAY[]::TEXT[]
  )
  INTO affected_customer_ids
  FROM new_rows AS related
  WHERE related."customerId" IS NOT NULL;

  IF cardinality(affected_customer_ids) = 0 THEN
    RETURN NULL;
  END IF;

  PERFORM customer."id"
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
$function$;

CREATE OR REPLACE FUNCTION "public"."touch_customers_updated_at_from_related_update"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  affected_opportunity_ids TEXT[];
  affected_customer_ids TEXT[];
  touched_at TIMESTAMP(3);
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'sale_orders' THEN
    SELECT COALESCE(
      array_agg(DISTINCT affected."opportunityId" ORDER BY affected."opportunityId"),
      ARRAY[]::TEXT[]
    )
    INTO affected_opportunity_ids
    FROM (
      SELECT old_related."opportunityId"
      FROM old_rows AS old_related
      INNER JOIN new_rows AS new_related ON new_related."id" = old_related."id"
      WHERE (
        old_related."opportunityId" IS DISTINCT FROM new_related."opportunityId"
        OR old_related."customerId" IS DISTINCT FROM new_related."customerId"
        OR old_related."deletedAt" IS DISTINCT FROM new_related."deletedAt"
        OR old_related."flowStatus" IS DISTINCT FROM new_related."flowStatus"
      )
        AND old_related."opportunityId" IS NOT NULL
      UNION ALL
      SELECT new_related."opportunityId"
      FROM new_rows AS new_related
      INNER JOIN old_rows AS old_related ON old_related."id" = new_related."id"
      WHERE (
        old_related."opportunityId" IS DISTINCT FROM new_related."opportunityId"
        OR old_related."customerId" IS DISTINCT FROM new_related."customerId"
        OR old_related."deletedAt" IS DISTINCT FROM new_related."deletedAt"
        OR old_related."flowStatus" IS DISTINCT FROM new_related."flowStatus"
      )
        AND new_related."opportunityId" IS NOT NULL
    ) AS affected;

    -- Only a new/rebound/restored/re-customered/effectiveness-transitioned occupancy fact needs
    -- Opportunity row locks. Amount/remark/product aggregate/version-only updates proceed directly
    -- to Customer(s). Include both sides of a relationship change; DISTINCT + ORDER BY fixes the
    -- batch lock order.
    PERFORM opportunity."id"
    FROM "public"."opportunities" AS opportunity
    WHERE opportunity."id" = ANY(affected_opportunity_ids)
    ORDER BY opportunity."id"
    FOR UPDATE;
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT affected."customerId" ORDER BY affected."customerId"),
    ARRAY[]::TEXT[]
  )
  INTO affected_customer_ids
  FROM (
    SELECT old_related."customerId"
    FROM old_rows AS old_related
    WHERE old_related."customerId" IS NOT NULL
    UNION ALL
    SELECT new_related."customerId"
    FROM new_rows AS new_related
    WHERE new_related."customerId" IS NOT NULL
  ) AS affected;

  IF cardinality(affected_customer_ids) = 0 THEN
    RETURN NULL;
  END IF;

  PERFORM customer."id"
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
$function$;

CREATE OR REPLACE FUNCTION "public"."touch_customers_updated_at_from_related_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  affected_opportunity_ids TEXT[];
  affected_customer_ids TEXT[];
  touched_at TIMESTAMP(3);
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'sale_orders' THEN
    SELECT COALESCE(
      array_agg(DISTINCT related."opportunityId" ORDER BY related."opportunityId"),
      ARRAY[]::TEXT[]
    )
    INTO affected_opportunity_ids
    FROM old_rows AS related
    WHERE related."opportunityId" IS NOT NULL;

    PERFORM opportunity."id"
    FROM "public"."opportunities" AS opportunity
    WHERE opportunity."id" = ANY(affected_opportunity_ids)
    ORDER BY opportunity."id"
    FOR UPDATE;
  END IF;

  SELECT COALESCE(
    array_agg(DISTINCT related."customerId" ORDER BY related."customerId"),
    ARRAY[]::TEXT[]
  )
  INTO affected_customer_ids
  FROM old_rows AS related
  WHERE related."customerId" IS NOT NULL;

  IF cardinality(affected_customer_ids) = 0 THEN
    RETURN NULL;
  END IF;

  PERFORM customer."id"
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
$function$;
