-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "firstMqlAt" TIMESTAMP(3),
ADD COLUMN     "firstSqlAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "customers_firstMqlAt_idx" ON "customers"("firstMqlAt");

-- CreateIndex
CREATE INDEX "customers_firstSqlAt_idx" ON "customers"("firstSqlAt");
