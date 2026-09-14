-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "chargerId" TEXT,
ADD COLUMN     "chargerName" VARCHAR(50),
ADD COLUMN     "sourcePaymentIds" JSONB;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "invoicedByInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "invoices_chargerId_idx" ON "invoices"("chargerId");

-- CreateIndex
CREATE INDEX "invoices_chargerId_deletedAt_createdAt_idx" ON "invoices"("chargerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "payments_invoicedByInvoiceId_idx" ON "payments"("invoicedByInvoiceId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoicedByInvoiceId_fkey" FOREIGN KEY ("invoicedByInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_chargerId_fkey" FOREIGN KEY ("chargerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill：让历史发票自然挂到对应订单的负责人名下。
-- 仅回填 chargerId 为空且对应订单有 chargerId 的行；chargerName 留空，让服务层读取时按 employee.id 动态拼接。
UPDATE "invoices" inv
SET "chargerId" = so."chargerId"
FROM "sale_orders" so
WHERE inv."saleOrderId" = so.id
  AND inv."chargerId" IS NULL
  AND so."chargerId" IS NOT NULL;
