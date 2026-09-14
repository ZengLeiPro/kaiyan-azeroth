-- 删除 contacts.decisionMaker 字段（P2-2，99.9% NULL，前端表单几乎无人勾选）
--
-- 依赖处理：v_customer_full view 通过 jsonb_agg 引用了该列，必须先 DROP VIEW，
-- DROP COLUMN 之后再 RECREATE VIEW（不含 decisionMaker）。
-- view 定义来源：20260406_normalize_employee_refs/migration.sql 第 260-383 行。

-- 1) 先删 view 解除依赖
DROP VIEW IF EXISTS v_customer_full;

-- 2) 删字段
ALTER TABLE "contacts" DROP COLUMN "decisionMaker";

-- 3) 重建 view（与 20260406 原版一致，仅去掉 contacts 子查询里的 decisionMaker）
CREATE OR REPLACE VIEW v_customer_full AS
SELECT
  c.id,
  c."serialNumber",
  c."customerName",
  c."shortName",
  c.industry,
  c."customerLevel",
  c."customerSource",
  c."customerRelationship",
  c.province,
  c.city,
  c.phone,
  c."chargerId",
  c."chargerName",
  c."collaboratorName",
  c."contactStatus",
  c."dealStatus",
  c."lastKeepRecordTime",
  c."lastKeepRecordContent",
  c."paidAmountLast365Days",
  c."accountsReceivable",
  c."createdAt",
  c.remark,
  (SELECT jsonb_agg(jsonb_build_object(
      'name', ct."contactName",
      'mobile', ct.mobile,
      'position', ct.position,
      'department', ct.department,
      'wechat', ct.wechat,
      'email', ct.email
  )) FROM contacts ct
  WHERE ct."customerId" = c.id AND ct."deletedAt" IS NULL
  ) AS contacts,
  (SELECT jsonb_agg(jsonb_build_object(
      'name', o."opportunityName",
      'amount', o."opportunityAmount",
      'stage', o."opportunityStage",
      'winRate', o."winRate",
      'expectedDealDate', o."expectedDealDate",
      'realDealDate', o."realDealDate",
      'charger', o."chargerName",
      'loseReason', o."loseReason",
      'createdAt', o."createdAt"
  ) ORDER BY o."createdAt" DESC)
  FROM opportunities o
  WHERE o."customerId" = c.id AND o."deletedAt" IS NULL
  ) AS opportunities,
  (SELECT jsonb_agg(jsonb_build_object(
      'title', so."orderTitle",
      'serialNumber', so."serialNumber",
      'amount', so."orderAmount",
      'totalReceived', so."totalReceived",
      'totalUncollected', so."totalUncollected",
      'status', so."orderStatus",
      'beginDate', so."orderBeginDate",
      'endDate', so."orderEndDate",
      'charger', so."chargerName",
      'products', (
        SELECT jsonb_agg(jsonb_build_object(
            'name', op."productName",
            'quantity', op.quantity,
            'unitPrice', op."unitPrice",
            'subtotal', op."subtotalAmount"
        ))
        FROM order_products op
        WHERE op."saleOrderId" = so.id AND op."deletedAt" IS NULL
      )
  ) ORDER BY so."createdAt" DESC)
  FROM sale_orders so
  WHERE so."customerId" = c.id AND so."deletedAt" IS NULL
  ) AS orders,
  (SELECT jsonb_agg(jsonb_build_object(
      'amount', p."paymentAmount",
      'type', p."paymentType",
      'date', p."businessDate",
      'payer', p.payer,
      'orderTitle', (SELECT so2."orderTitle" FROM sale_orders so2 WHERE so2.id = p."saleOrderId"),
      'charger', p."chargerName"
  ) ORDER BY p."businessDate" DESC)
  FROM payments p
  WHERE p."customerId" = c.id AND p."deletedAt" IS NULL
  ) AS payments,
  (SELECT jsonb_agg(jsonb_build_object(
      'amount', inv."invoiceAmount",
      'type', inv."invoiceType",
      'date', inv."invoiceDate",
      'number', inv."invoiceNumber",
      'status', inv."invoiceStatus"
  ) ORDER BY inv."invoiceDate" DESC)
  FROM invoices inv
  WHERE inv."customerId" = c.id AND inv."deletedAt" IS NULL
  ) AS invoices,
  (SELECT jsonb_agg(jsonb_build_object(
      'time', kr."keepRecordTime",
      'type', kr."keepRecordType",
      'content', kr."keepRecordContent",
      'charger', kr."chargerName"
  ) ORDER BY kr."keepRecordTime" DESC)
  FROM keep_records kr
  WHERE kr."customerId" = c.id AND kr."deletedAt" IS NULL
  ) AS follow_ups,
  (SELECT jsonb_agg(jsonb_build_object(
      'signInTime', vr."signInTime",
      'type', vr."visitType",
      'content', vr.content,
      'address', vr."signAddress",
      'duration', vr.duration
  ) ORDER BY vr."signInTime" DESC)
  FROM visit_records vr
  WHERE vr."customerId" = c.id AND vr."deletedAt" IS NULL
  ) AS visits,
  (SELECT COUNT(*) FROM contacts ct WHERE ct."customerId" = c.id AND ct."deletedAt" IS NULL) AS contact_count,
  (SELECT COUNT(*) FROM opportunities o WHERE o."customerId" = c.id AND o."deletedAt" IS NULL) AS opportunity_count,
  (SELECT COALESCE(SUM(o."opportunityAmount"), 0) FROM opportunities o WHERE o."customerId" = c.id AND o."deletedAt" IS NULL) AS total_opportunity_amount,
  (SELECT COUNT(*) FROM sale_orders so WHERE so."customerId" = c.id AND so."deletedAt" IS NULL) AS order_count,
  (SELECT COALESCE(SUM(so."orderAmount"), 0) FROM sale_orders so WHERE so."customerId" = c.id AND so."deletedAt" IS NULL) AS total_order_amount,
  (SELECT COALESCE(SUM(p."paymentAmount"), 0) FROM payments p WHERE p."customerId" = c.id AND p."deletedAt" IS NULL) AS total_paid,
  (SELECT COUNT(*) FROM keep_records kr WHERE kr."customerId" = c.id AND kr."deletedAt" IS NULL) AS follow_up_count,
  (SELECT COUNT(*) FROM visit_records vr WHERE vr."customerId" = c.id AND vr."deletedAt" IS NULL) AS visit_count
FROM customers c
WHERE c."deletedAt" IS NULL;
