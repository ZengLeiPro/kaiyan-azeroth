-- 二次归一化 flowStatus 中文标签 -> 英文枚举值
--
-- 背景：迁移 20260508055034 曾把 invoices/sale_orders/payments 三表的中文 '已通过'
-- 归一化为 'approved'，但之后被 YCCRM 全量重同步（yccrm-sync 写入 raw.flow_status 中文原值）
-- 整表冲回。证据：2026-05-30 RDS 快照中三表中文行数与 20260508055034 注释记录的
-- 归一化前数量完全一致（invoices 271 / sale_orders 1042 / payments 1036）。
--
-- YCCRM / dingtalk-sync 全量同步 FC 已于 2026-05-23 彻底下线（s.dingtalk-sync.prod.yaml
-- 删除、CI 部署段移除、无 timer/HTTP/cron 触发），故本次为根治性二次归一化，不会再被冲回。
--
-- 影响范围（基于 2026-05-30T03:54Z RDS 快照）：
--   invoices:    271 行 '已通过' -> 'approved'
--   sale_orders: 1042 行 '已通过' -> 'approved'
--   payments:    1036 行 '已通过' -> 'approved'
--   pending（payments 17 / sale_orders 13）是真·待审批，WHERE 已排除，不动
--
-- ⚠️ 顺序铁律：本 migration 仅归一化 flowStatus 值；orderStatus / accountsReceivable /
-- invoicedAmount / orderInvoiceStatus 等派生缓存由随后【手动触发】的 backfill-crm-cache
-- 端点重算。必须「先本 migration 归一化 -> 后 backfill recalc」，不可颠倒、不可只 recalc，
-- 否则 recalc 用 'approved' 聚合不到中文回款，会把订单错刷为「未回款」。

UPDATE "invoices"    SET "flowStatus" = 'approved' WHERE "flowStatus" = '已通过';
UPDATE "sale_orders" SET "flowStatus" = 'approved' WHERE "flowStatus" = '已通过';
UPDATE "payments"    SET "flowStatus" = 'approved' WHERE "flowStatus" = '已通过';
