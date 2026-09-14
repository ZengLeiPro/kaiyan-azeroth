-- AlterTable
ALTER TABLE "keep_records" ADD COLUMN     "source" VARCHAR(50),
ADD COLUMN     "sourceActionItemId" TEXT;

-- CreateTable
CREATE TABLE "sales_action_items" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "category" VARCHAR(24) NOT NULL,
    "priority" INTEGER NOT NULL,
    "refType" VARCHAR(30),
    "refId" TEXT,
    "title" VARCHAR(200) NOT NULL,
    "reason" TEXT NOT NULL,
    "suggestedAction" TEXT,
    "aiDraft" JSONB,
    "evidence" JSONB,
    "confidence" VARCHAR(10) NOT NULL,
    "dedupKey" VARCHAR(120) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "resolveNote" TEXT,
    "snoozeUntil" TIMESTAMP(3),
    "remindCount" INTEGER NOT NULL DEFAULT 0,
    "resultType" VARCHAR(30),
    "resultId" TEXT,
    "sourceRunId" VARCHAR(64),
    "createdVia" VARCHAR(40) NOT NULL DEFAULT 'agent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creatorEmployeeId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updaterEmployeeId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_dedup_ledger" (
    "id" TEXT NOT NULL,
    "runId" VARCHAR(64) NOT NULL,
    "sourceEmployeeId" TEXT NOT NULL,
    "sourceType" VARCHAR(30) NOT NULL,
    "sourceMessageId" VARCHAR(128),
    "dedupKey" VARCHAR(120) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'seen',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sync_dedup_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_action_items_employeeId_status_priority_idx" ON "sales_action_items"("employeeId", "status", "priority");

-- CreateIndex
CREATE INDEX "sales_action_items_sourceRunId_idx" ON "sales_action_items"("sourceRunId");

-- CreateIndex
CREATE INDEX "sales_action_items_dedupKey_idx" ON "sales_action_items"("dedupKey");

-- CreateIndex
CREATE INDEX "sales_action_items_creatorEmployeeId_idx" ON "sales_action_items"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "sales_action_items_updaterEmployeeId_idx" ON "sales_action_items"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "sales_action_items_resolvedById_idx" ON "sales_action_items"("resolvedById");

-- CreateIndex
CREATE UNIQUE INDEX "sync_dedup_ledger_dedupKey_key" ON "sync_dedup_ledger"("dedupKey");

-- CreateIndex
CREATE INDEX "sync_dedup_ledger_runId_idx" ON "sync_dedup_ledger"("runId");

-- CreateIndex
CREATE INDEX "sync_dedup_ledger_sourceEmployeeId_idx" ON "sync_dedup_ledger"("sourceEmployeeId");

-- CreateIndex
CREATE INDEX "keep_records_source_idx" ON "keep_records"("source");

-- CreateIndex
CREATE INDEX "keep_records_sourceActionItemId_idx" ON "keep_records"("sourceActionItemId");

-- AddForeignKey
ALTER TABLE "keep_records" ADD CONSTRAINT "keep_records_sourceActionItemId_fkey" FOREIGN KEY ("sourceActionItemId") REFERENCES "sales_action_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_action_items" ADD CONSTRAINT "sales_action_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_action_items" ADD CONSTRAINT "sales_action_items_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_action_items" ADD CONSTRAINT "sales_action_items_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_action_items" ADD CONSTRAINT "sales_action_items_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 活跃待办防重：同一销售同一 dedupKey 的「未处理」待办唯一（pending 与 snoozed 不可并存）。
-- 手写 partial unique index（schema.prisma 不写 @@unique，因 Prisma 不支持带 WHERE 的部分唯一索引）。
-- 已处理(adopted/done/ignored/auto_expired)与软删行不参与约束，允许历史多条。
-- 夜间 cron 经 upsertCandidate 按本索引 ON CONFLICT 合并 evidence、不堆重复待办（Codex 改进）。
CREATE UNIQUE INDEX "sales_action_items_active_uniq" ON "sales_action_items" ("employeeId", "dedupKey") WHERE "status" IN ('pending', 'snoozed') AND "deletedAt" IS NULL;
