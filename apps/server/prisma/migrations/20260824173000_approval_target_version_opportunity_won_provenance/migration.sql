-- Expand-only approval target-version snapshot and Opportunity WON provenance.
-- Every new column is nullable so this migration can deploy before the application change.
-- No historical row is rewritten: legacy NULL values are interpreted fail-closed (approval)
-- or fail-safe/non-destructive (WON provenance) by the application.

ALTER TABLE "public"."approval_instances"
  ADD COLUMN "targetVersion" INTEGER;

ALTER TABLE "public"."opportunities"
  ADD COLUMN "wonSourceType" VARCHAR(20),
  ADD COLUMN "wonSourceSaleOrderId" TEXT,
  ADD COLUMN "wonSourcePreviousStage" VARCHAR(50),
  ADD COLUMN "wonSourcePreviousDealDate" TIMESTAMP(3),
  ADD COLUMN "wonSourcePreviousWinRate" DECIMAL(5,2);
