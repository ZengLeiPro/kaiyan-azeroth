-- AlterTable: 新增 loseReasonDetail 字段（承载「其他」时的自由文本备注）
ALTER TABLE "opportunities" ADD COLUMN     "loseReasonDetail" TEXT;

-- Data migration:
-- 历史 loseReason 为自由文本（DB 中共 ~599 种不重复值），失单原因即将改为枚举（7 项）。
-- 策略：把所有不属于新枚举集合的非空旧值搬到 loseReasonDetail，loseReason 统一置为 '其他'。
-- 排除已合规值使迁移幂等（即便重复执行也不会破坏数据）。
UPDATE "opportunities"
SET "loseReasonDetail" = "loseReason",
    "loseReason" = '其他'
WHERE "loseReason" IS NOT NULL
  AND "loseReason" <> ''
  AND "loseReason" NOT IN (
    '客户无需求 / 暂不考虑',
    '价格 / 预算不足',
    '竞品胜出',
    '联系不上客户',
    '需求不匹配',
    '项目搁置 / 决策延迟',
    '其他'
  );
