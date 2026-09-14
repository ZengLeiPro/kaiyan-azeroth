-- CreateTable
CREATE TABLE "table_preferences" (
    "id" TEXT NOT NULL,
    "pageKey" VARCHAR(200) NOT NULL,
    "configJson" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "creatorEmployeeId" TEXT,
    "updaterEmployeeId" TEXT,

    CONSTRAINT "table_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "table_preferences_pageKey_key" ON "table_preferences"("pageKey");

-- CreateIndex
CREATE INDEX "table_preferences_creatorEmployeeId_idx" ON "table_preferences"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "table_preferences_updaterEmployeeId_idx" ON "table_preferences"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "table_preferences" ADD CONSTRAINT "table_preferences_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_preferences" ADD CONSTRAINT "table_preferences_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
