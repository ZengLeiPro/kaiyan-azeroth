-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "crm_products" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "crm_work_dailies" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "keep_records" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "opportunity_products" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "order_products" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "visit_records" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- CreateIndex
CREATE INDEX "contacts_creatorEmployeeId_idx" ON "contacts"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "contacts_updaterEmployeeId_idx" ON "contacts"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "crm_products_creatorEmployeeId_idx" ON "crm_products"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "crm_products_updaterEmployeeId_idx" ON "crm_products"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "crm_work_dailies_creatorEmployeeId_idx" ON "crm_work_dailies"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "crm_work_dailies_updaterEmployeeId_idx" ON "crm_work_dailies"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "customers_creatorEmployeeId_idx" ON "customers"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "customers_updaterEmployeeId_idx" ON "customers"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "invoices_creatorEmployeeId_idx" ON "invoices"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "invoices_updaterEmployeeId_idx" ON "invoices"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "keep_records_creatorEmployeeId_idx" ON "keep_records"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "keep_records_updaterEmployeeId_idx" ON "keep_records"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "opportunities_creatorEmployeeId_idx" ON "opportunities"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "opportunities_updaterEmployeeId_idx" ON "opportunities"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "opportunity_products_creatorEmployeeId_idx" ON "opportunity_products"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "opportunity_products_updaterEmployeeId_idx" ON "opportunity_products"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "order_products_creatorEmployeeId_idx" ON "order_products"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "order_products_updaterEmployeeId_idx" ON "order_products"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "payments_creatorEmployeeId_idx" ON "payments"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "payments_updaterEmployeeId_idx" ON "payments"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "sale_orders_creatorEmployeeId_idx" ON "sale_orders"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "sale_orders_updaterEmployeeId_idx" ON "sale_orders"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "visit_records_creatorEmployeeId_idx" ON "visit_records"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "visit_records_updaterEmployeeId_idx" ON "visit_records"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keep_records" ADD CONSTRAINT "keep_records_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keep_records" ADD CONSTRAINT "keep_records_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_products" ADD CONSTRAINT "crm_products_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_products" ADD CONSTRAINT "crm_products_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_work_dailies" ADD CONSTRAINT "crm_work_dailies_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_work_dailies" ADD CONSTRAINT "crm_work_dailies_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
