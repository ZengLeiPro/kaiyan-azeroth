-- 绑定方案 v2.2 schema migration
-- 1. paymentId @unique → 普通 index（取消 v2.1 的 1:1 强约束）
-- 2. 新增 finance_ledgers.paymentItemId @unique（v2.2 真 1:1 主轴）
-- 3. 新建 payment_items 表（一笔 payment 拆 N 产品 × N 科目 × N mode）
-- 4. crm_products 加 defaultFinanceSubjectId + defaultPaymentMode
-- 5. order_products 加 financeSubjectId + paymentMode + totalReceivedAmount
-- 6. 各 FK：业务实体一律 onDelete: Restrict（payment_items.paymentId 不用 Cascade）

-- DropIndex（v2.1 的 paymentId @unique）
DROP INDEX "finance_ledgers_paymentId_key";

-- AlterTable
ALTER TABLE "crm_products" ADD COLUMN     "defaultFinanceSubjectId" TEXT,
ADD COLUMN     "defaultPaymentMode" VARCHAR(20) NOT NULL DEFAULT 'direct';

-- AlterTable
ALTER TABLE "finance_ledgers" ADD COLUMN     "paymentItemId" TEXT;

-- AlterTable
ALTER TABLE "order_products" ADD COLUMN     "financeSubjectId" TEXT,
ADD COLUMN     "paymentMode" VARCHAR(20) NOT NULL DEFAULT 'direct',
ADD COLUMN     "totalReceivedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payment_items" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "saleOrderProductId" TEXT,
    "itemSeq" INTEGER NOT NULL DEFAULT 1,
    "productName" VARCHAR(200) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "financeSubjectId" TEXT,
    "paymentMode" VARCHAR(20) NOT NULL DEFAULT 'direct',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_items_paymentId_idx" ON "payment_items"("paymentId");

-- CreateIndex
CREATE INDEX "payment_items_saleOrderProductId_idx" ON "payment_items"("saleOrderProductId");

-- CreateIndex
CREATE INDEX "payment_items_financeSubjectId_idx" ON "payment_items"("financeSubjectId");

-- CreateIndex
CREATE INDEX "payment_items_paymentMode_idx" ON "payment_items"("paymentMode");

-- CreateIndex
CREATE INDEX "payment_items_creatorEmployeeId_idx" ON "payment_items"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "payment_items_updaterEmployeeId_idx" ON "payment_items"("updaterEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_items_paymentId_itemSeq_key" ON "payment_items"("paymentId", "itemSeq");

-- CreateIndex
CREATE INDEX "crm_products_defaultFinanceSubjectId_idx" ON "crm_products"("defaultFinanceSubjectId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_ledgers_paymentItemId_key" ON "finance_ledgers"("paymentItemId");

-- CreateIndex
CREATE INDEX "finance_ledgers_paymentId_idx" ON "finance_ledgers"("paymentId");

-- CreateIndex
CREATE INDEX "order_products_financeSubjectId_idx" ON "order_products"("financeSubjectId");

-- CreateIndex
CREATE INDEX "order_products_paymentMode_idx" ON "order_products"("paymentMode");

-- AddForeignKey（payment_items.paymentId 用 RESTRICT，业务实体不允许 Cascade）
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_saleOrderProductId_fkey" FOREIGN KEY ("saleOrderProductId") REFERENCES "order_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_financeSubjectId_fkey" FOREIGN KEY ("financeSubjectId") REFERENCES "finance_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_products" ADD CONSTRAINT "crm_products_defaultFinanceSubjectId_fkey" FOREIGN KEY ("defaultFinanceSubjectId") REFERENCES "finance_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_financeSubjectId_fkey" FOREIGN KEY ("financeSubjectId") REFERENCES "finance_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_paymentItemId_fkey" FOREIGN KEY ("paymentItemId") REFERENCES "payment_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
