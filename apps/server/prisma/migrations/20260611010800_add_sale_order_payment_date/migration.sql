-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "paymentDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sale_orders_paymentDate_idx" ON "sale_orders"("paymentDate");
