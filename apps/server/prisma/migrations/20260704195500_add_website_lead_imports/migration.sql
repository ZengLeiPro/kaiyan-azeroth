-- 官网留资导入幂等台账。
-- 只防 collector 重试/并发导致重复建客户；业务操作仍落 customers / contacts / sales_action_items。

CREATE TABLE IF NOT EXISTS "public"."website_lead_imports" (
  "id" TEXT NOT NULL,
  "sourceId" VARCHAR(96) NOT NULL,
  "phone" VARCHAR(32) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'processing',
  "customerId" TEXT,
  "actionItemId" TEXT,
  "sourceSite" VARCHAR(255),
  "sourcePath" VARCHAR(512),
  "placement" VARCHAR(120),
  "channel" VARCHAR(120),
  "payload" JSONB,
  "importedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "website_lead_imports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "website_lead_imports_sourceId_key"
  ON "public"."website_lead_imports"("sourceId");

CREATE INDEX IF NOT EXISTS "website_lead_imports_phone_idx"
  ON "public"."website_lead_imports"("phone");

CREATE INDEX IF NOT EXISTS "website_lead_imports_customerId_idx"
  ON "public"."website_lead_imports"("customerId");

CREATE INDEX IF NOT EXISTS "website_lead_imports_actionItemId_idx"
  ON "public"."website_lead_imports"("actionItemId");

CREATE INDEX IF NOT EXISTS "website_lead_imports_status_createdAt_idx"
  ON "public"."website_lead_imports"("status", "createdAt");
