-- 删除 customers.paidAmountLast365Days 字段、索引、view 引用（2026-06-20 治理体检产出）
--
-- 背景：该派生缓存字段定义于 schema，但代码层从未实现写入/重算/滑窗刷新逻辑
--      （全代码库 grep recalc/refresh/updatePaidAmount 零结果，payments 模块无任何 trigger）。
--      当前值是 yccrm（销帮帮）迁移时的一次性快照，Azeroth 上线后无人维护。
--
-- 该缓存没有写入/重算路径，与真实回款不一致，删除。
-- 前端列默认 visible=false，删除后用户感知 = 0。
-- 不可回滚（DROP COLUMN 删除数据，且原数据本来就是错的）。
--
-- 依赖处理：v_customer_full view 第 17 列引用了 customers.paidAmountLast365Days，必须先 DROP VIEW
-- 再删字段，最后 CREATE OR REPLACE VIEW 不含该列。模式与 20260510 drop_contact_decision_maker /
-- 20260520 drop_customer_phone 两次历史 view 改造完全一致。

-- 1) 先 DROP VIEW 解依赖
DROP VIEW IF EXISTS v_customer_full;

-- 2) DROP INDEX + DROP COLUMN
DROP INDEX IF EXISTS "customers_paidAmountLast365Days_idx";
ALTER TABLE "customers" DROP COLUMN IF EXISTS "paidAmountLast365Days";

-- 3) 重建 v_customer_full（从 20260520092515 版本去掉 paidAmountLast365Days 列；其余字段、聚合子查询、
-- WHERE 子句完全一致）
CREATE OR REPLACE VIEW v_customer_full AS
SELECT id,
    "serialNumber",
    "customerName",
    "shortName",
    industry,
    "customerLevel",
    "customerSource",
    "customerRelationship",
    province,
    city,
    "chargerId",
    "chargerName",
    "collaboratorName",
    "contactStatus",
    "dealStatus",
    "lastKeepRecordTime",
    "lastKeepRecordContent",
    "accountsReceivable",
    "createdAt",
    remark,
    ( SELECT jsonb_agg(jsonb_build_object('name', ct."contactName", 'mobile', ct.mobile, 'position', ct."position", 'department', ct.department, 'wechat', ct.wechat, 'email', ct.email)) AS jsonb_agg
           FROM contacts ct
          WHERE ct."customerId" = c.id AND ct."deletedAt" IS NULL) AS contacts,
    ( SELECT jsonb_agg(jsonb_build_object('name', o."opportunityName", 'amount', o."opportunityAmount", 'stage', o."opportunityStage", 'winRate', o."winRate", 'expectedDealDate', o."expectedDealDate", 'realDealDate', o."realDealDate", 'charger', o."chargerName", 'loseReason', o."loseReason", 'createdAt', o."createdAt") ORDER BY o."createdAt" DESC) AS jsonb_agg
           FROM opportunities o
          WHERE o."customerId" = c.id AND o."deletedAt" IS NULL) AS opportunities,
    ( SELECT jsonb_agg(jsonb_build_object('title', so."orderTitle", 'serialNumber', so."serialNumber", 'amount', so."orderAmount", 'totalReceived', so."totalReceived", 'totalUncollected', so."totalUncollected", 'status', so."orderStatus", 'beginDate', so."orderBeginDate", 'endDate', so."orderEndDate", 'charger', so."chargerName", 'products', ( SELECT jsonb_agg(jsonb_build_object('name', op."productName", 'quantity', op.quantity, 'unitPrice', op."unitPrice", 'subtotal', op."subtotalAmount")) AS jsonb_agg
                   FROM order_products op
                  WHERE op."saleOrderId" = so.id AND op."deletedAt" IS NULL)) ORDER BY so."createdAt" DESC) AS jsonb_agg
           FROM sale_orders so
          WHERE so."customerId" = c.id AND so."deletedAt" IS NULL) AS orders,
    ( SELECT jsonb_agg(jsonb_build_object('amount', p."paymentAmount", 'type', p."paymentType", 'date', p."businessDate", 'payer', p.payer, 'orderTitle', ( SELECT so2."orderTitle"
                   FROM sale_orders so2
                  WHERE so2.id = p."saleOrderId"), 'charger', p."chargerName") ORDER BY p."businessDate" DESC) AS jsonb_agg
           FROM payments p
          WHERE p."customerId" = c.id AND p."deletedAt" IS NULL) AS payments,
    ( SELECT jsonb_agg(jsonb_build_object('amount', inv."invoiceAmount", 'type', inv."invoiceType", 'date', inv."invoiceDate", 'number', inv."invoiceNumber", 'status', inv."invoiceStatus") ORDER BY inv."invoiceDate" DESC) AS jsonb_agg
           FROM invoices inv
          WHERE inv."customerId" = c.id AND inv."deletedAt" IS NULL) AS invoices,
    ( SELECT jsonb_agg(jsonb_build_object('time', kr."keepRecordTime", 'type', kr."keepRecordType", 'content', kr."keepRecordContent", 'charger', kr."chargerName") ORDER BY kr."keepRecordTime" DESC) AS jsonb_agg
           FROM keep_records kr
          WHERE kr."customerId" = c.id AND kr."deletedAt" IS NULL) AS follow_ups,
    ( SELECT jsonb_agg(jsonb_build_object('signInTime', vr."signInTime", 'type', vr."visitType", 'content', vr.content, 'address', vr."signAddress", 'duration', vr.duration) ORDER BY vr."signInTime" DESC) AS jsonb_agg
           FROM visit_records vr
          WHERE vr."customerId" = c.id AND vr."deletedAt" IS NULL) AS visits,
    ( SELECT count(*) AS count
           FROM contacts ct
          WHERE ct."customerId" = c.id AND ct."deletedAt" IS NULL) AS contact_count,
    ( SELECT count(*) AS count
           FROM opportunities o
          WHERE o."customerId" = c.id AND o."deletedAt" IS NULL) AS opportunity_count,
    ( SELECT COALESCE(sum(o."opportunityAmount"), 0::numeric) AS "coalesce"
           FROM opportunities o
          WHERE o."customerId" = c.id AND o."deletedAt" IS NULL) AS total_opportunity_amount,
    ( SELECT count(*) AS count
           FROM sale_orders so
          WHERE so."customerId" = c.id AND so."deletedAt" IS NULL) AS order_count,
    ( SELECT COALESCE(sum(so."orderAmount"), 0::numeric) AS "coalesce"
           FROM sale_orders so
          WHERE so."customerId" = c.id AND so."deletedAt" IS NULL) AS total_order_amount,
    ( SELECT COALESCE(sum(p."paymentAmount"), 0::numeric) AS "coalesce"
           FROM payments p
          WHERE p."customerId" = c.id AND p."deletedAt" IS NULL) AS total_paid,
    ( SELECT count(*) AS count
           FROM keep_records kr
          WHERE kr."customerId" = c.id AND kr."deletedAt" IS NULL) AS follow_up_count,
    ( SELECT count(*) AS count
           FROM visit_records vr
          WHERE vr."customerId" = c.id AND vr."deletedAt" IS NULL) AS visit_count
   FROM customers c
  WHERE "deletedAt" IS NULL;
