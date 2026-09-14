-- CreateTable
CREATE TABLE "diet_foods" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "brand" VARCHAR(80),
    "skuRef" VARCHAR(200),
    "purchaseUrl" VARCHAR(500),
    "kcalPer100g" DECIMAL(8,2),
    "proteinPer100g" DECIMAL(8,2),
    "carbsPer100g" DECIMAL(8,2),
    "fatPer100g" DECIMAL(8,2),
    "fiberPer100g" DECIMAL(8,2),
    "sodiumMgPer100g" DECIMAL(8,2),
    "defaultServingG" DECIMAL(8,2),
    "unit" VARCHAR(20) NOT NULL DEFAULT 'g',
    "unitPrice" DECIMAL(10,2),
    "unitSize" DECIMAL(10,2),
    "pickingNotes" TEXT,
    "phytochemicals" TEXT,
    "tags" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_foods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_supplements" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "brand" VARCHAR(80),
    "skuRef" VARCHAR(200),
    "purchaseUrl" VARCHAR(500),
    "dosagePerPill" VARCHAR(100),
    "dailyDoseCount" DECIMAL(6,2),
    "dailyDoseDesc" VARCHAR(200),
    "timing" VARCHAR(50),
    "packSize" INTEGER,
    "packPrice" DECIMAL(10,2),
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "stockWarnDays" INTEGER NOT NULL DEFAULT 7,
    "problemSolved" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plans" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "name" VARCHAR(100) NOT NULL,
    "planType" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "targetKcal" DECIMAL(8,2),
    "targetProtein" DECIMAL(8,2),
    "targetCarbs" DECIMAL(8,2),
    "targetFat" DECIMAL(8,2),
    "targetFiber" DECIMAL(8,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_meal_slots" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "mealType" VARCHAR(30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "foodId" TEXT NOT NULL,
    "foodNameSnapshot" VARCHAR(100),
    "kcalPer100gSnap" DECIMAL(8,2),
    "proteinPer100gSnap" DECIMAL(8,2),
    "carbsPer100gSnap" DECIMAL(8,2),
    "fatPer100gSnap" DECIMAL(8,2),
    "fiberPer100gSnap" DECIMAL(8,2),
    "sodiumMgPer100gSnap" DECIMAL(8,2),
    "quantity" DECIMAL(8,2),
    "unit" VARCHAR(20),
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_meal_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_plan_supplements" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "supplementNameSnapshot" VARCHAR(100),
    "timing" VARCHAR(50),
    "doseCount" DECIMAL(6,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_plan_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_daily_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "logDate" DATE NOT NULL,
    "planId" TEXT,
    "planNameSnapshot" VARCHAR(100),
    "isTrainingDay" BOOLEAN NOT NULL DEFAULT false,
    "actualKcal" DECIMAL(8,2),
    "actualProtein" DECIMAL(8,2),
    "actualCarbs" DECIMAL(8,2),
    "actualFat" DECIMAL(8,2),
    "actualSodium" DECIMAL(8,2),
    "complianceScore" DECIMAL(5,2),
    "bottomLineMet" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_daily_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_daily_meal_entries" (
    "id" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "mealType" VARCHAR(30) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "foodId" TEXT NOT NULL,
    "foodNameSnapshot" VARCHAR(100),
    "kcalPer100gSnap" DECIMAL(8,2),
    "proteinPer100gSnap" DECIMAL(8,2),
    "carbsPer100gSnap" DECIMAL(8,2),
    "fatPer100gSnap" DECIMAL(8,2),
    "fiberPer100gSnap" DECIMAL(8,2),
    "sodiumMgPer100gSnap" DECIMAL(8,2),
    "quantity" DECIMAL(8,2),
    "unit" VARCHAR(20),
    "consumed" BOOLEAN NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_daily_meal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_daily_supplement_entries" (
    "id" TEXT NOT NULL,
    "dailyLogId" TEXT NOT NULL,
    "supplementId" TEXT NOT NULL,
    "supplementNameSnapshot" VARCHAR(100),
    "timing" VARCHAR(50),
    "doseCount" DECIMAL(6,2),
    "consumed" BOOLEAN NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_daily_supplement_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_water_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "logDate" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "amountMl" DECIMAL(8,2) NOT NULL,
    "source" VARCHAR(30) NOT NULL DEFAULT 'water',
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_water_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_subjective_logs" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "logDate" DATE NOT NULL,
    "energyLevel" INTEGER,
    "sleepQualityLevel" INTEGER,
    "bloating" BOOLEAN NOT NULL DEFAULT false,
    "edema" BOOLEAN NOT NULL DEFAULT false,
    "cramps" BOOLEAN NOT NULL DEFAULT false,
    "stoolQuality" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_subjective_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "body_metrics" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "measuredDate" DATE NOT NULL,
    "source" VARCHAR(30) NOT NULL DEFAULT 'manual',
    "weightKg" DECIMAL(6,2),
    "bodyFatRate" DECIMAL(5,2),
    "muscleMassKg" DECIMAL(6,2),
    "visceralFat" DECIMAL(5,2),
    "waistCm" DECIMAL(5,2),
    "hipCm" DECIMAL(5,2),
    "bmr" DECIMAL(8,2),
    "rawData" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "body_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_purchase_items" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerName" VARCHAR(50),
    "planPeriod" VARCHAR(30),
    "foodId" TEXT,
    "foodNameSnapshot" VARCHAR(100),
    "supplementId" TEXT,
    "supplementNameSnapshot" VARCHAR(100),
    "quantity" DECIMAL(10,2),
    "unit" VARCHAR(20),
    "estimatedPrice" DECIMAL(10,2),
    "actualPrice" DECIMAL(10,2),
    "platform" VARCHAR(50),
    "status" VARCHAR(30) NOT NULL DEFAULT 'planned',
    "orderedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "diet_purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diet_foods_category_deletedAt_idx" ON "diet_foods"("category", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_foods_isActive_deletedAt_idx" ON "diet_foods"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_supplements_category_deletedAt_idx" ON "diet_supplements"("category", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_supplements_isActive_deletedAt_idx" ON "diet_supplements"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_plans_ownerId_deletedAt_idx" ON "diet_plans"("ownerId", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_plans_ownerId_isActive_deletedAt_idx" ON "diet_plans"("ownerId", "isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_meal_slots_planId_mealType_sortOrder_idx" ON "diet_meal_slots"("planId", "mealType", "sortOrder");

-- CreateIndex
CREATE INDEX "diet_meal_slots_foodId_idx" ON "diet_meal_slots"("foodId");

-- CreateIndex
CREATE INDEX "diet_plan_supplements_planId_sortOrder_idx" ON "diet_plan_supplements"("planId", "sortOrder");

-- CreateIndex
CREATE INDEX "diet_plan_supplements_supplementId_idx" ON "diet_plan_supplements"("supplementId");

-- CreateIndex
CREATE INDEX "diet_daily_logs_ownerId_logDate_deletedAt_idx" ON "diet_daily_logs"("ownerId", "logDate", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_daily_logs_planId_idx" ON "diet_daily_logs"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "diet_daily_logs_ownerId_logDate_key" ON "diet_daily_logs"("ownerId", "logDate");

-- CreateIndex
CREATE INDEX "diet_daily_meal_entries_dailyLogId_mealType_sortOrder_idx" ON "diet_daily_meal_entries"("dailyLogId", "mealType", "sortOrder");

-- CreateIndex
CREATE INDEX "diet_daily_meal_entries_foodId_idx" ON "diet_daily_meal_entries"("foodId");

-- CreateIndex
CREATE INDEX "diet_daily_supplement_entries_dailyLogId_idx" ON "diet_daily_supplement_entries"("dailyLogId");

-- CreateIndex
CREATE INDEX "diet_daily_supplement_entries_supplementId_idx" ON "diet_daily_supplement_entries"("supplementId");

-- CreateIndex
CREATE INDEX "diet_water_logs_ownerId_logDate_deletedAt_idx" ON "diet_water_logs"("ownerId", "logDate", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_water_logs_ownerId_recordedAt_idx" ON "diet_water_logs"("ownerId", "recordedAt");

-- CreateIndex
CREATE INDEX "diet_subjective_logs_ownerId_logDate_deletedAt_idx" ON "diet_subjective_logs"("ownerId", "logDate", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "diet_subjective_logs_ownerId_logDate_key" ON "diet_subjective_logs"("ownerId", "logDate");

-- CreateIndex
CREATE INDEX "body_metrics_ownerId_measuredDate_deletedAt_idx" ON "body_metrics"("ownerId", "measuredDate", "deletedAt");

-- CreateIndex
CREATE INDEX "body_metrics_ownerId_source_idx" ON "body_metrics"("ownerId", "source");

-- CreateIndex
CREATE INDEX "diet_purchase_items_ownerId_status_deletedAt_idx" ON "diet_purchase_items"("ownerId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "diet_purchase_items_ownerId_planPeriod_idx" ON "diet_purchase_items"("ownerId", "planPeriod");

-- CreateIndex
CREATE INDEX "diet_purchase_items_foodId_idx" ON "diet_purchase_items"("foodId");

-- CreateIndex
CREATE INDEX "diet_purchase_items_supplementId_idx" ON "diet_purchase_items"("supplementId");

-- AddForeignKey
ALTER TABLE "diet_meal_slots" ADD CONSTRAINT "diet_meal_slots_planId_fkey" FOREIGN KEY ("planId") REFERENCES "diet_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_supplements" ADD CONSTRAINT "diet_plan_supplements_planId_fkey" FOREIGN KEY ("planId") REFERENCES "diet_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_logs" ADD CONSTRAINT "diet_daily_logs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "diet_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_meal_entries" ADD CONSTRAINT "diet_daily_meal_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "diet_daily_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_supplement_entries" ADD CONSTRAINT "diet_daily_supplement_entries_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "diet_daily_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
