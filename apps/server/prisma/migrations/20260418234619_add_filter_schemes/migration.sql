-- CreateTable
CREATE TABLE "filter_schemes" (
    "id" TEXT NOT NULL,
    "pageKey" VARCHAR(80) NOT NULL,
    "configJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "filter_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "filter_schemes_pageKey_key" ON "filter_schemes"("pageKey");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "customers_customerLevel_idx" ON "customers"("customerLevel");

-- CreateIndex
CREATE INDEX "customers_customerSource_idx" ON "customers"("customerSource");

-- CreateIndex
CREATE INDEX "customers_contactStatus_idx" ON "customers"("contactStatus");

-- CreateIndex
CREATE INDEX "customers_dealStatus_idx" ON "customers"("dealStatus");

-- CreateIndex
CREATE INDEX "customers_industry_idx" ON "customers"("industry");

-- CreateIndex
CREATE INDEX "customers_customerRelationship_idx" ON "customers"("customerRelationship");

-- CreateIndex
CREATE INDEX "customers_createdAt_idx" ON "customers"("createdAt");

-- CreateIndex
CREATE INDEX "customers_updatedAt_idx" ON "customers"("updatedAt");

-- CreateIndex
CREATE INDEX "customers_accountsReceivable_idx" ON "customers"("accountsReceivable");

-- CreateIndex
CREATE INDEX "customers_paidAmountLast365Days_idx" ON "customers"("paidAmountLast365Days");

-- CreateIndex
CREATE INDEX "customers_chargerId_deletedAt_createdAt_idx" ON "customers"("chargerId", "deletedAt", "createdAt");

