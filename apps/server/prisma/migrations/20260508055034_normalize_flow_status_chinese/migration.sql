-- 归一化 flowStatus 中文标签 -> 英文枚举值
--
-- 背景：YCCRM 同步路径写入的 flowStatus 是中文 '已通过'，本地审批流写入英文 'approved'，
-- 两套并存导致下游过滤逻辑（如 SaleOrder.invoicedAmount 聚合、business-approval 重复提交守护）
-- 必须维护双值兜底。yccrm-sync 已永久禁用，可一次性归一化历史数据。
--
-- 影响范围（基于 RDS 数据快照）：
--   invoices: 271 行 '已通过'
--   sale_orders: 1042 行 '已通过'
--   payments: 1036 行 '已通过'
--   visit_records / projects: 无中文 flowStatus，跳过

UPDATE "invoices" SET "flowStatus" = 'approved' WHERE "flowStatus" = '已通过';
UPDATE "sale_orders" SET "flowStatus" = 'approved' WHERE "flowStatus" = '已通过';
UPDATE "payments" SET "flowStatus" = 'approved' WHERE "flowStatus" = '已通过';
