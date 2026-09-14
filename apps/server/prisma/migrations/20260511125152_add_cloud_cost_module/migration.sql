-- CreateTable
CREATE TABLE "cloud_bill_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotDate" DATE NOT NULL,
    "vendor" VARCHAR(20) NOT NULL DEFAULT 'aliyun',
    "billingCycle" VARCHAR(7) NOT NULL,
    "accountId" VARCHAR(100),
    "balanceAvailable" DECIMAL(12,2),
    "balanceCash" DECIMAL(12,2),
    "mtdAmount" DECIMAL(12,2),
    "mtdGrossAmount" DECIMAL(12,2),
    "productBills" JSONB NOT NULL DEFAULT '[]',
    "resourcePackages" JSONB NOT NULL DEFAULT '[]',
    "subscriptions" JSONB NOT NULL DEFAULT '[]',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cloud_bill_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_usage_metrics" (
    "id" TEXT NOT NULL,
    "metricDate" DATE NOT NULL,
    "vendor" VARCHAR(20) NOT NULL DEFAULT 'aliyun',
    "productCode" VARCHAR(20) NOT NULL,
    "metricName" VARCHAR(80) NOT NULL,
    "instanceId" VARCHAR(300),
    "value" DECIMAL(20,6) NOT NULL,
    "unit" VARCHAR(20),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cloud_usage_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_instance_metas" (
    "id" TEXT NOT NULL,
    "vendor" VARCHAR(20) NOT NULL DEFAULT 'aliyun',
    "productCode" VARCHAR(20) NOT NULL,
    "instanceId" VARCHAR(300) NOT NULL,
    "alias" VARCHAR(100),
    "purpose" TEXT,
    "ownerCategory" VARCHAR(30),
    "ownerName" VARCHAR(100),
    "renewalIntent" VARCHAR(20),
    "notes" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cloud_instance_metas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_alerts" (
    "id" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor" VARCHAR(20) NOT NULL DEFAULT 'aliyun',
    "level" VARCHAR(10) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "relatedResource" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cloud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cloud_bill_snapshots_snapshotDate_idx" ON "cloud_bill_snapshots"("snapshotDate");

-- CreateIndex
CREATE INDEX "cloud_bill_snapshots_billingCycle_idx" ON "cloud_bill_snapshots"("billingCycle");

-- CreateIndex
CREATE INDEX "cloud_bill_snapshots_vendor_billingCycle_idx" ON "cloud_bill_snapshots"("vendor", "billingCycle");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_bill_snapshots_vendor_snapshotDate_key" ON "cloud_bill_snapshots"("vendor", "snapshotDate");

-- CreateIndex
CREATE INDEX "cloud_usage_metrics_metricDate_idx" ON "cloud_usage_metrics"("metricDate");

-- CreateIndex
CREATE INDEX "cloud_usage_metrics_productCode_metricDate_idx" ON "cloud_usage_metrics"("productCode", "metricDate");

-- CreateIndex
CREATE INDEX "cloud_usage_metrics_productCode_metricName_metricDate_idx" ON "cloud_usage_metrics"("productCode", "metricName", "metricDate");

-- CreateIndex
CREATE INDEX "cloud_usage_metrics_instanceId_metricDate_idx" ON "cloud_usage_metrics"("instanceId", "metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_usage_metrics_vendor_productCode_metricName_instanceI_key" ON "cloud_usage_metrics"("vendor", "productCode", "metricName", "instanceId", "metricDate");

-- CreateIndex
CREATE INDEX "cloud_instance_metas_vendor_productCode_idx" ON "cloud_instance_metas"("vendor", "productCode");

-- CreateIndex
CREATE INDEX "cloud_instance_metas_ownerCategory_idx" ON "cloud_instance_metas"("ownerCategory");

-- CreateIndex
CREATE INDEX "cloud_instance_metas_renewalIntent_idx" ON "cloud_instance_metas"("renewalIntent");

-- CreateIndex
CREATE INDEX "cloud_instance_metas_archived_idx" ON "cloud_instance_metas"("archived");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_instance_metas_vendor_productCode_instanceId_key" ON "cloud_instance_metas"("vendor", "productCode", "instanceId");

-- CreateIndex
CREATE INDEX "cloud_alerts_triggeredAt_idx" ON "cloud_alerts"("triggeredAt");

-- CreateIndex
CREATE INDEX "cloud_alerts_level_idx" ON "cloud_alerts"("level");

-- CreateIndex
CREATE INDEX "cloud_alerts_category_idx" ON "cloud_alerts"("category");

-- CreateIndex
CREATE INDEX "cloud_alerts_status_idx" ON "cloud_alerts"("status");

-- CreateIndex
CREATE INDEX "cloud_alerts_status_level_triggeredAt_idx" ON "cloud_alerts"("status", "level", "triggeredAt");
