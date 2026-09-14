-- CreateTable
CREATE TABLE "finance_accounts" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'CNY',
    "openingBalance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_subjects" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 2,
    "parentId" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_ledgers" (
    "id" TEXT NOT NULL,
    "txDate" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "remark" TEXT,
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "dingtalkSheetName" VARCHAR(50),
    "dingtalkRowIndex" INTEGER,
    "dingtalkRowHash" VARCHAR(64),
    "saleOrderId" TEXT,
    "payrollRecordId" TEXT,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_personal_ledgers" (
    "id" TEXT NOT NULL,
    "txDate" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "direction" VARCHAR(4) NOT NULL,
    "remark" TEXT,
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "dingtalkSheetName" VARCHAR(50),
    "dingtalkRowIndex" INTEGER,
    "dingtalkRowHash" VARCHAR(64),
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_personal_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_import_batches" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'dingtalk',
    "workbookId" VARCHAR(64),
    "sheetNames" TEXT[],
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "personalRows" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "previewJson" JSONB,
    "summaryJson" JSONB,
    "errorReportJson" JSONB,
    "reconciliationJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updaterEmployeeId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "finance_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_accounts_code_key" ON "finance_accounts"("code");

-- CreateIndex
CREATE INDEX "finance_accounts_deletedAt_displayOrder_idx" ON "finance_accounts"("deletedAt", "displayOrder");

-- CreateIndex
CREATE INDEX "finance_accounts_creatorEmployeeId_idx" ON "finance_accounts"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "finance_accounts_updaterEmployeeId_idx" ON "finance_accounts"("updaterEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_subjects_code_key" ON "finance_subjects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "finance_subjects_name_key" ON "finance_subjects"("name");

-- CreateIndex
CREATE INDEX "finance_subjects_parentId_idx" ON "finance_subjects"("parentId");

-- CreateIndex
CREATE INDEX "finance_subjects_category_displayOrder_idx" ON "finance_subjects"("category", "displayOrder");

-- CreateIndex
CREATE INDEX "finance_subjects_deletedAt_idx" ON "finance_subjects"("deletedAt");

-- CreateIndex
CREATE INDEX "finance_subjects_creatorEmployeeId_idx" ON "finance_subjects"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "finance_subjects_updaterEmployeeId_idx" ON "finance_subjects"("updaterEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_ledgers_dingtalkRowHash_key" ON "finance_ledgers"("dingtalkRowHash");

-- CreateIndex
CREATE INDEX "finance_ledgers_txDate_accountId_idx" ON "finance_ledgers"("txDate", "accountId");

-- CreateIndex
CREATE INDEX "finance_ledgers_accountId_txDate_idx" ON "finance_ledgers"("accountId", "txDate");

-- CreateIndex
CREATE INDEX "finance_ledgers_subjectId_txDate_idx" ON "finance_ledgers"("subjectId", "txDate");

-- CreateIndex
CREATE INDEX "finance_ledgers_deletedAt_txDate_idx" ON "finance_ledgers"("deletedAt", "txDate");

-- CreateIndex
CREATE INDEX "finance_ledgers_importBatchId_idx" ON "finance_ledgers"("importBatchId");

-- CreateIndex
CREATE INDEX "finance_ledgers_saleOrderId_idx" ON "finance_ledgers"("saleOrderId");

-- CreateIndex
CREATE INDEX "finance_ledgers_payrollRecordId_idx" ON "finance_ledgers"("payrollRecordId");

-- CreateIndex
CREATE INDEX "finance_ledgers_creatorEmployeeId_idx" ON "finance_ledgers"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "finance_ledgers_updaterEmployeeId_idx" ON "finance_ledgers"("updaterEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_personal_ledgers_dingtalkRowHash_key" ON "finance_personal_ledgers"("dingtalkRowHash");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_txDate_accountId_idx" ON "finance_personal_ledgers"("txDate", "accountId");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_accountId_txDate_idx" ON "finance_personal_ledgers"("accountId", "txDate");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_subjectId_txDate_idx" ON "finance_personal_ledgers"("subjectId", "txDate");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_deletedAt_txDate_idx" ON "finance_personal_ledgers"("deletedAt", "txDate");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_importBatchId_idx" ON "finance_personal_ledgers"("importBatchId");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_creatorEmployeeId_idx" ON "finance_personal_ledgers"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "finance_personal_ledgers_updaterEmployeeId_idx" ON "finance_personal_ledgers"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "finance_import_batches_deletedAt_createdAt_idx" ON "finance_import_batches"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "finance_import_batches_status_idx" ON "finance_import_batches"("status");

-- CreateIndex
CREATE INDEX "finance_import_batches_creatorEmployeeId_idx" ON "finance_import_batches"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "finance_import_batches_updaterEmployeeId_idx" ON "finance_import_batches"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_subjects" ADD CONSTRAINT "finance_subjects_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "finance_subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_subjects" ADD CONSTRAINT "finance_subjects_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_subjects" ADD CONSTRAINT "finance_subjects_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "finance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "payroll_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "finance_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_personal_ledgers" ADD CONSTRAINT "finance_personal_ledgers_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_personal_ledgers" ADD CONSTRAINT "finance_personal_ledgers_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "finance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_personal_ledgers" ADD CONSTRAINT "finance_personal_ledgers_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "finance_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_personal_ledgers" ADD CONSTRAINT "finance_personal_ledgers_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_personal_ledgers" ADD CONSTRAINT "finance_personal_ledgers_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_import_batches" ADD CONSTRAINT "finance_import_batches_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_import_batches" ADD CONSTRAINT "finance_import_batches_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
