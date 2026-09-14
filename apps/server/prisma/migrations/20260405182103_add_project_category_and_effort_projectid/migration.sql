-- DropForeignKey
ALTER TABLE "effort_records" DROP CONSTRAINT "effort_records_workItemId_fkey";

-- AlterTable
ALTER TABLE "effort_records" ADD COLUMN     "projectId" TEXT,
ALTER COLUMN "workItemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "category" VARCHAR(100);

-- CreateIndex
CREATE INDEX "effort_records_projectId_idx" ON "effort_records"("projectId");

-- AddForeignKey
ALTER TABLE "effort_records" ADD CONSTRAINT "effort_records_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effort_records" ADD CONSTRAINT "effort_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
