-- AlterTable
ALTER TABLE "effort_records" ADD COLUMN     "workDate" DATE;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "hourlyRate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project_sale_orders" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "project_sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_sale_orders_projectId_idx" ON "project_sale_orders"("projectId");

-- CreateIndex
CREATE INDEX "project_sale_orders_saleOrderId_idx" ON "project_sale_orders"("saleOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "project_sale_orders_projectId_saleOrderId_key" ON "project_sale_orders"("projectId", "saleOrderId");

-- CreateIndex
CREATE INDEX "effort_records_workDate_idx" ON "effort_records"("workDate");

-- CreateIndex
CREATE INDEX "effort_records_ownerId_workDate_idx" ON "effort_records"("ownerId", "workDate");

-- CreateIndex
CREATE INDEX "projects_customerId_idx" ON "projects"("customerId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sale_orders" ADD CONSTRAINT "project_sale_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sale_orders" ADD CONSTRAINT "project_sale_orders_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
