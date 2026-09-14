-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "leadStage" VARCHAR(10),
ADD COLUMN     "leadStageQualifiedAt" TIMESTAMP(3),
ADD COLUMN     "leadStageQualifiedById" TEXT,
ADD COLUMN     "leadStageUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "leadStageUpdatedById" TEXT;

-- CreateIndex
CREATE INDEX "customers_leadStage_idx" ON "customers"("leadStage");

-- CreateIndex
CREATE INDEX "customers_leadStage_leadStageUpdatedAt_idx" ON "customers"("leadStage", "leadStageUpdatedAt");

-- CreateIndex
CREATE INDEX "customers_leadStageUpdatedById_idx" ON "customers"("leadStageUpdatedById");

-- CreateIndex
CREATE INDEX "customers_leadStageQualifiedById_idx" ON "customers"("leadStageQualifiedById");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_leadStageUpdatedById_fkey" FOREIGN KEY ("leadStageUpdatedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_leadStageQualifiedById_fkey" FOREIGN KEY ("leadStageQualifiedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
