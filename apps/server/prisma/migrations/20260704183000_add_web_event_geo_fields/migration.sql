-- Align ky-azeroth Prisma migrations with collector-owned web_analytics.events geo fields.
--
-- Source of truth for the collector table is 独立 analytics collector.
-- Production has these columns through collector migration 0004_events_geo_fields.sql;
-- keep this migration idempotent so prisma migrate deploy is safe on production RDS.

ALTER TABLE "web_analytics"."events"
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "isp" TEXT;
