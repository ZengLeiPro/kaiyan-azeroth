-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "direction" VARCHAR(10) NOT NULL DEFAULT 'IN',
ADD COLUMN     "refundReason" TEXT,
ADD COLUMN     "refundType" VARCHAR(50),
ADD COLUMN     "relatedInvoiceId" TEXT,
ADD COLUMN     "relatedPaymentId" TEXT;

-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "totalRefunded" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "payments_direction_flowStatus_deletedAt_idx" ON "payments"("direction", "flowStatus", "deletedAt");

-- CreateIndex
CREATE INDEX "payments_relatedPaymentId_idx" ON "payments"("relatedPaymentId");

-- CreateIndex
CREATE INDEX "payments_relatedInvoiceId_idx" ON "payments"("relatedInvoiceId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_relatedPaymentId_fkey" FOREIGN KEY ("relatedPaymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
