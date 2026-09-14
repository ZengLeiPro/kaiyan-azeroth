-- 业务实体「显示名」统一规约：为 payments / invoices 增加业务摘要字段。
--
-- 字段语义：
--   payments.subject —— 回款/退款业务摘要，例：首期款、尾款、客户退款
--   invoices.subject —— 开票业务摘要，例：软件开发服务费、钉钉软件费
--
-- 上线策略：
--   1. ADD COLUMN 使用 DEFAULT 安全填充历史数据；
--   2. 历史退款按 direction='OUT' 改为「退款」；
--   3. 本次服务端所有创建路径都显式写 subject，因此迁移末尾移除 DEFAULT，
--      保持后续数据必须由业务层明确给出摘要。

ALTER TABLE "payments" ADD COLUMN "subject" VARCHAR(100) NOT NULL DEFAULT '回款';
UPDATE "payments" SET "subject" = '退款' WHERE "direction" = 'OUT' AND "subject" = '回款';
ALTER TABLE "payments" ALTER COLUMN "subject" DROP DEFAULT;

ALTER TABLE "invoices" ADD COLUMN "subject" VARCHAR(100) NOT NULL DEFAULT '开票';
ALTER TABLE "invoices" ALTER COLUMN "subject" DROP DEFAULT;
