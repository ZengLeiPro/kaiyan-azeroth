-- DropForeignKey
ALTER TABLE "effort_records" DROP CONSTRAINT "effort_records_projectId_fkey";

-- DropForeignKey
ALTER TABLE "effort_records" DROP CONSTRAINT "effort_records_workItemId_fkey";

-- DropForeignKey
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_projectId_fkey";

-- DropIndex
DROP INDEX "effort_records_workItemId_idx";

-- AlterTable
ALTER TABLE "effort_records" DROP COLUMN "workItemId",
ALTER COLUMN "projectId" SET NOT NULL;

-- DropTable
DROP TABLE "work_items";

-- AddForeignKey
ALTER TABLE "effort_records" ADD CONSTRAINT "effort_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
