-- CreateTable
CREATE TABLE "personal_filter_preferences" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "pageKey" VARCHAR(80) NOT NULL,
    "configJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personal_filter_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_filter_presets" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "pageKey" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "filtersJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "personal_filter_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_filter_preferences_employeeId_pageKey_key" ON "personal_filter_preferences"("employeeId", "pageKey");
CREATE INDEX "personal_filter_preferences_pageKey_idx" ON "personal_filter_preferences"("pageKey");
CREATE UNIQUE INDEX "personal_filter_presets_employeeId_pageKey_name_key" ON "personal_filter_presets"("employeeId", "pageKey", "name");
CREATE INDEX "personal_filter_presets_employeeId_pageKey_updatedAt_idx" ON "personal_filter_presets"("employeeId", "pageKey", "updatedAt");

-- AddForeignKey
ALTER TABLE "personal_filter_preferences" ADD CONSTRAINT "personal_filter_preferences_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE;
ALTER TABLE "personal_filter_presets" ADD CONSTRAINT "personal_filter_presets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE;
