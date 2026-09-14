-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "invoicedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "orderInvoiceStatus" VARCHAR(50);

-- CreateIndex
CREATE INDEX "sale_orders_invoicedAmount_idx" ON "sale_orders"("invoicedAmount");

-- CreateIndex
CREATE INDEX "sale_orders_orderInvoiceStatus_idx" ON "sale_orders"("orderInvoiceStatus");
