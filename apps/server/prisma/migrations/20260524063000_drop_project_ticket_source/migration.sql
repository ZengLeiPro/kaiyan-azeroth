-- 删除 project_tickets.source 列（UI「来源描述」字段，业务上无意义）
-- 现存数据：68 工单中仅 3 条填了 placeholder 示例文本，无业务价值
ALTER TABLE "project_tickets" DROP COLUMN "source";
