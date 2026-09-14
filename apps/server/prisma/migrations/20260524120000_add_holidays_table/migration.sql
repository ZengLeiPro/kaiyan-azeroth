-- CreateTable
-- 节假日设置表：仅存「打破默认规则的日期」
-- HOLIDAY = 法定节假日（默认工作日 → 改休），WORKDAY = 调休补班（默认周末 → 改上班）
-- 周末按 dayOfWeek 实时计算，不入库。
CREATE TABLE "holidays" (
    "id"                TEXT          NOT NULL,
    "date"              DATE          NOT NULL,
    "year"              INTEGER       NOT NULL,
    "type"              VARCHAR(20)   NOT NULL,
    "note"              VARCHAR(100),
    "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt"         TIMESTAMP(3)  NOT NULL,
    "updaterEmployeeId" TEXT,
    "version"           INTEGER       NOT NULL DEFAULT 1,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE INDEX "holidays_year_idx" ON "holidays"("year");

-- CreateIndex
CREATE INDEX "holidays_creatorEmployeeId_idx" ON "holidays"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "holidays_updaterEmployeeId_idx" ON "holidays"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
