-- AlterTable
ALTER TABLE "effort_records" ADD COLUMN "recordType" VARCHAR(20) NOT NULL DEFAULT 'ACTUAL';

-- CreateIndex
CREATE INDEX "effort_records_ownerId_workDate_recordType_idx" ON "effort_records"("ownerId", "workDate", "recordType");
