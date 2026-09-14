-- Leads 推进状态与预约拜访时间。
ALTER TABLE "customers"
ADD COLUMN "leadProgressStatus" VARCHAR(30),
ADD COLUMN "leadAppointmentAt" TIMESTAMP(3),
ADD COLUMN "leadProgressReason" TEXT,
ADD COLUMN "leadProgressUpdatedAt" TIMESTAMP(3),
ADD COLUMN "leadProgressUpdatedById" TEXT;

-- 历史回填口径：赢单 > 已有拜访 > SQL 待补预约 > MQL 活跃。
-- 不虚构历史预约时间；历史 SQL 无拜访记录时 appointmentAt 保持 NULL。
UPDATE "customers" AS c
SET
  "leadProgressStatus" = CASE
    WHEN EXISTS (
      SELECT 1
      FROM "opportunities" AS o
      WHERE o."customerId" = c.id
        AND o."deletedAt" IS NULL
        AND o."opportunityStage" = '赢单'
    ) THEN 'WON'
    WHEN c."leadStage" = 'SQL' AND EXISTS (
      SELECT 1
      FROM "visit_records" AS v
      WHERE v."customerId" = c.id
        AND v."deletedAt" IS NULL
    ) THEN 'VISITED'
    WHEN c."leadStage" = 'SQL' THEN 'PENDING_VISIT'
    WHEN c."leadStage" = 'MQL' THEN 'ACTIVE'
    ELSE NULL
  END,
  "leadProgressUpdatedAt" = COALESCE(c."leadStageUpdatedAt", NOW())
WHERE c."leadStage" IN ('MQL', 'SQL');

CREATE INDEX "customers_leadProgressStatus_idx" ON "customers"("leadProgressStatus");
CREATE INDEX "customers_leadAppointmentAt_idx" ON "customers"("leadAppointmentAt");
CREATE INDEX "customers_leadProgressUpdatedById_idx" ON "customers"("leadProgressUpdatedById");

ALTER TABLE "customers"
ADD CONSTRAINT "customers_leadProgressUpdatedById_fkey"
FOREIGN KEY ("leadProgressUpdatedById") REFERENCES "employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
