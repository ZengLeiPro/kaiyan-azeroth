-- AlterTable: Add yccrmId to CRM models
ALTER TABLE "customers" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "contacts" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "opportunities" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "sale_orders" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "payments" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "invoices" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "keep_records" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "visit_records" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "crm_products" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "opportunity_products" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "order_products" ADD COLUMN "yccrmId" VARCHAR(100);
ALTER TABLE "crm_work_dailies" ADD COLUMN "yccrmId" VARCHAR(100);

-- AlterTable: Add yunxiaoId to project management models
ALTER TABLE "projects" ADD COLUMN "yunxiaoId" VARCHAR(100);
ALTER TABLE "project_members" ADD COLUMN "yunxiaoId" VARCHAR(100);
ALTER TABLE "work_items" ADD COLUMN "yunxiaoId" VARCHAR(100);
ALTER TABLE "effort_records" ADD COLUMN "yunxiaoId" VARCHAR(100);

-- CreateIndex: Unique constraints for yccrmId
CREATE UNIQUE INDEX "customers_yccrmId_key" ON "customers"("yccrmId");
CREATE UNIQUE INDEX "contacts_yccrmId_key" ON "contacts"("yccrmId");
CREATE UNIQUE INDEX "opportunities_yccrmId_key" ON "opportunities"("yccrmId");
CREATE UNIQUE INDEX "sale_orders_yccrmId_key" ON "sale_orders"("yccrmId");
CREATE UNIQUE INDEX "payments_yccrmId_key" ON "payments"("yccrmId");
CREATE UNIQUE INDEX "invoices_yccrmId_key" ON "invoices"("yccrmId");
CREATE UNIQUE INDEX "keep_records_yccrmId_key" ON "keep_records"("yccrmId");
CREATE UNIQUE INDEX "visit_records_yccrmId_key" ON "visit_records"("yccrmId");
CREATE UNIQUE INDEX "crm_products_yccrmId_key" ON "crm_products"("yccrmId");
CREATE UNIQUE INDEX "opportunity_products_yccrmId_key" ON "opportunity_products"("yccrmId");
CREATE UNIQUE INDEX "order_products_yccrmId_key" ON "order_products"("yccrmId");
CREATE UNIQUE INDEX "crm_work_dailies_yccrmId_key" ON "crm_work_dailies"("yccrmId");

-- CreateIndex: Unique constraints for yunxiaoId
CREATE UNIQUE INDEX "projects_yunxiaoId_key" ON "projects"("yunxiaoId");
CREATE UNIQUE INDEX "project_members_yunxiaoId_key" ON "project_members"("yunxiaoId");
CREATE UNIQUE INDEX "work_items_yunxiaoId_key" ON "work_items"("yunxiaoId");
CREATE UNIQUE INDEX "effort_records_yunxiaoId_key" ON "effort_records"("yunxiaoId");
