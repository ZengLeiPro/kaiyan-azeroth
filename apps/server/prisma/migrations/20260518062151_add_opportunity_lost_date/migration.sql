-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "lostDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "opportunities_lostDate_idx" ON "opportunities"("lostDate");
