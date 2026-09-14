-- 一次性数据迁移：customer.accountsReceivable 切换为派生口径后的基线回填
--
-- 背景：commit d776a96 已把 customer.accountsReceivable 的写入责任收归
-- recomputeCustomerAccountsReceivable helper（仅在订单/回款变更时增量重算）。
-- 历史 dingtalk-sync（已废弃）写入的存量数据是脏值——本 migration 一次性
-- 全量重算对齐到"派生"基线。
--
-- 口径（与 customer-accounts-receivable.helper 等价）：
--   accountsReceivable = SUM(sale_orders.totalUncollected WHERE deletedAt IS NULL)
--
-- 安全性：
-- - 只 UPDATE customers.accountsReceivable 一个字段，不删数据、不动其他字段
-- - 幂等：Prisma migration 系统天然保证只跑一次（migration_lock）
-- - 数据量小（~5000 客户 + ~3000 订单），单事务亚秒完成
-- - 软删客户跳过（WHERE c."deletedAt" IS NULL），不复活脏数据

UPDATE "customers" c
SET "accountsReceivable" = COALESCE(
  (SELECT SUM(so."totalUncollected")
   FROM "sale_orders" so
   WHERE so."customerId" = c.id AND so."deletedAt" IS NULL),
  0
)
WHERE c."deletedAt" IS NULL;
