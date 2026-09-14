-- AlterTable: 新增销售待办「办结类型」字段（仅 status=done 时使用）
ALTER TABLE "sales_action_items" ADD COLUMN "doneType" VARCHAR(16);

-- 让 system/filter-schemes 中 crm.sales_action_items 的现有持久化方案默认纳入「办结类型」。
-- 若没有持久化配置，服务端 registry defaults 会自然生效；若已有配置，则幂等插入到 status 后面。
WITH target AS (
  SELECT
    id,
    COALESCE("configJson" -> 'fields', '[]'::jsonb) AS fields
  FROM "filter_schemes"
  WHERE "pageKey" = 'crm.sales_action_items'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE("configJson" -> 'fields', '[]'::jsonb)) AS field
      WHERE field ->> 'fieldKey' = 'doneType'
    )
), rebuilt AS (
  SELECT
    target.id,
    jsonb_agg(source.item ORDER BY source.sort_order) AS fields
  FROM target
  CROSS JOIN LATERAL (
    SELECT
      existing.item,
      existing.ord::numeric AS sort_order
    FROM jsonb_array_elements(target.fields) WITH ORDINALITY AS existing(item, ord)
    UNION ALL
    SELECT
      '{"fieldKey":"doneType","control":"multiSelect","label":null}'::jsonb AS item,
      COALESCE(
        (
          SELECT existing.ord + 0.1
          FROM jsonb_array_elements(target.fields) WITH ORDINALITY AS existing(item, ord)
          WHERE existing.item ->> 'fieldKey' = 'status'
          LIMIT 1
        ),
        jsonb_array_length(target.fields) + 1
      )::numeric AS sort_order
  ) AS source
  GROUP BY target.id
)
UPDATE "filter_schemes" AS schemes
SET
  "configJson" = jsonb_set(schemes."configJson", '{fields}', rebuilt.fields, true),
  "version" = schemes."version" + 1,
  "updatedAt" = now()
FROM rebuilt
WHERE schemes.id = rebuilt.id;

-- 若管理员曾为销售待办表格推送过全员默认列顺序，则把新列插入到 resolveNote 前面并提升版本，
-- 避免新字段因为旧 order 配置落到表格末尾。没有 order 的配置无需处理，会使用 schema order。
WITH target AS (
  SELECT
    id,
    COALESCE("configJson" -> 'order', '[]'::jsonb) AS order_json
  FROM "table_preferences"
  WHERE "pageKey" IN (
      '/crm/sales-action-items:sales-action-items-all',
      '/crm/sales-action-items:sales-action-items-mine'
    )
    AND "deletedAt" IS NULL
    AND "configJson" ? 'order'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(COALESCE("configJson" -> 'order', '[]'::jsonb)) AS key(value)
      WHERE key.value = 'doneType'
    )
), rebuilt AS (
  SELECT
    target.id,
    jsonb_agg(to_jsonb(source.value) ORDER BY source.sort_order) AS order_json
  FROM target
  CROSS JOIN LATERAL (
    SELECT
      existing.value,
      existing.ord::numeric AS sort_order
    FROM jsonb_array_elements_text(target.order_json) WITH ORDINALITY AS existing(value, ord)
    UNION ALL
    SELECT
      'doneType' AS value,
      COALESCE(
        (
          SELECT existing.ord - 0.1
          FROM jsonb_array_elements_text(target.order_json) WITH ORDINALITY AS existing(value, ord)
          WHERE existing.value = 'resolveNote'
          LIMIT 1
        ),
        jsonb_array_length(target.order_json) + 1
      )::numeric AS sort_order
  ) AS source
  GROUP BY target.id
)
UPDATE "table_preferences" AS preferences
SET
  "configJson" = jsonb_set(preferences."configJson", '{order}', rebuilt.order_json, true),
  "version" = preferences."version" + 1,
  "updatedAt" = now()
FROM rebuilt
WHERE preferences.id = rebuilt.id;
