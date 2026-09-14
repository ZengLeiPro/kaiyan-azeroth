ALTER TABLE "customers"
  ADD COLUMN "intentTemperature" VARCHAR(20) NOT NULL DEFAULT 'UNJUDGED',
  ADD COLUMN "intentReasons" JSONB,
  ADD COLUMN "nextFollowUpAt" DATE,
  ADD COLUMN "intentUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "intentUpdatedById" TEXT,
  ADD COLUMN "intentSourceKeepRecordId" TEXT,
  ADD COLUMN "leadValidity" VARCHAR(20) NOT NULL DEFAULT 'VALID',
  ADD COLUMN "leadInvalidReason" VARCHAR(30);

ALTER TABLE "keep_records"
  ADD COLUMN "intentTemperature" VARCHAR(20),
  ADD COLUMN "intentReasons" JSONB,
  ADD COLUMN "nextFollowUpAt" DATE;

CREATE INDEX "customers_intentTemperature_idx" ON "customers"("intentTemperature");
CREATE INDEX "customers_nextFollowUpAt_idx" ON "customers"("nextFollowUpAt");
CREATE INDEX "customers_leadValidity_idx" ON "customers"("leadValidity");
CREATE INDEX "customers_intentUpdatedById_idx" ON "customers"("intentUpdatedById");
CREATE INDEX "keep_records_customerId_intentTemperature_keepRecordTime_idx"
  ON "keep_records"("customerId", "intentTemperature", "keepRecordTime");
