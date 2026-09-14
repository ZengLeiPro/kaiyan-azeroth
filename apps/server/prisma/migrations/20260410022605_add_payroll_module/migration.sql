-- CreateTable
CREATE TABLE "payroll_import_batches" (
    "id" TEXT NOT NULL,
    "sourceFileName" VARCHAR(255),
    "totalSheets" INTEGER NOT NULL DEFAULT 0,
    "parsedSheets" INTEGER NOT NULL DEFAULT 0,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "strategy" VARCHAR(50) NOT NULL DEFAULT 'replace_period',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "previewJson" JSONB,
    "summaryJson" JSONB,
    "errorReportJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payroll_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" TEXT NOT NULL,
    "periodKey" VARCHAR(7) NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "sheetName" VARCHAR(100),
    "companyName" VARCHAR(200),
    "expectedWorkDays" DECIMAL(8,3),
    "statementDate" TIMESTAMP(3),
    "sourceFileName" VARCHAR(255),
    "importBatchId" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'imported',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_records" (
    "id" TEXT NOT NULL,
    "payrollPeriodId" TEXT NOT NULL,
    "employeeId" TEXT,
    "departmentId" TEXT,
    "employeeNameSnapshot" VARCHAR(100) NOT NULL,
    "departmentNameSnapshot" VARCHAR(100),
    "positionSnapshot" VARCHAR(100),
    "entryDateSnapshot" TIMESTAMP(3),
    "bankNameSnapshot" VARCHAR(100),
    "bankCardNoSnapshot" VARCHAR(100),
    "remarkSnapshot" TEXT,
    "actualAttendanceDays" DECIMAL(8,3),
    "absenceDays" DECIMAL(8,3),
    "grossBaseSalary" DECIMAL(12,2),
    "grossPerformance" DECIMAL(12,2),
    "grossCommission" DECIMAL(12,2),
    "grossOther" DECIMAL(12,2),
    "grossBonusYearEnd" DECIMAL(12,2),
    "grossTotal" DECIMAL(12,2),
    "absenceDeductionAmount" DECIMAL(12,2),
    "lateDeductionAmount" DECIMAL(12,2),
    "adminDeductionAmount" DECIMAL(12,2),
    "socialSecurityPersonalAmount" DECIMAL(12,2),
    "housingFundPersonalAmount" DECIMAL(12,2),
    "deductionOtherTotal" DECIMAL(12,2),
    "deductionTotal" DECIMAL(12,2),
    "socialSecurityCompanyAmount" DECIMAL(12,2),
    "housingFundCompanyAmount" DECIMAL(12,2),
    "companyBurdenTotal" DECIMAL(12,2),
    "netSalary" DECIMAL(12,2),
    "totalLaborCost" DECIMAL(12,2),
    "sourceSheetName" VARCHAR(100),
    "sourceRowIndex" INTEGER,
    "sourceRawJson" JSONB,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payroll_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_import_batches_deletedAt_createdAt_idx" ON "payroll_import_batches"("deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_periodKey_key" ON "payroll_periods"("periodKey");

-- CreateIndex
CREATE INDEX "payroll_periods_year_month_idx" ON "payroll_periods"("year", "month");

-- CreateIndex
CREATE INDEX "payroll_periods_importBatchId_idx" ON "payroll_periods"("importBatchId");

-- CreateIndex
CREATE INDEX "payroll_periods_deletedAt_idx" ON "payroll_periods"("deletedAt");

-- CreateIndex
CREATE INDEX "payroll_records_payrollPeriodId_idx" ON "payroll_records"("payrollPeriodId");

-- CreateIndex
CREATE INDEX "payroll_records_employeeId_idx" ON "payroll_records"("employeeId");

-- CreateIndex
CREATE INDEX "payroll_records_departmentId_idx" ON "payroll_records"("departmentId");

-- CreateIndex
CREATE INDEX "payroll_records_importBatchId_idx" ON "payroll_records"("importBatchId");

-- CreateIndex
CREATE INDEX "payroll_records_payrollPeriodId_deletedAt_idx" ON "payroll_records"("payrollPeriodId", "deletedAt");

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "payroll_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_payrollPeriodId_fkey" FOREIGN KEY ("payrollPeriodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "payroll_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
