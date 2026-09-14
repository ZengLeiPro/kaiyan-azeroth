-- AlterTable
-- 扩展 dingtalk_logs 表，支持本地新增/编辑（混合同步表 + 本地表）。
-- 新列均带默认值，对已有同步行向后兼容。
ALTER TABLE "dingtalk_logs"
  ADD COLUMN "contentsJson"    JSONB,
  ADD COLUMN "isLocallyEdited" BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "source"          VARCHAR(20) NOT NULL DEFAULT 'dingtalk',
  ADD COLUMN "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "dingtalk_logs_source_idx" ON "dingtalk_logs"("source");
