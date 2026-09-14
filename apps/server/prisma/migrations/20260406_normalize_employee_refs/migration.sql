-- Employee ID 归一化迁移
-- 将所有"负责人"字段从外部 ID（dingtalkUserId/云效userId）统一改为 Employee.id 外键

-- ============================================================
-- Step A: 创建占位 Employee（CRM + 日报表中的未知负责人）
-- ============================================================

-- 收集 CRM 7 张表中 chargerId/senderId 在 Employee 表找不到的值
INSERT INTO employees (id, "serialNumber", name, "dingtalkUserId", status, "createdAt", "updatedAt", version)
SELECT
  gen_random_uuid(),
  'PH-' || ROW_NUMBER() OVER (ORDER BY src.ext_id),
  '未知员工 (' || src.ext_id || ')',
  src.ext_id,
  'placeholder',
  NOW(),
  NOW(),
  1
FROM (
  SELECT DISTINCT ext_id FROM (
    SELECT "chargerId" AS ext_id FROM customers WHERE "chargerId" IS NOT NULL
    UNION
    SELECT "chargerId" FROM opportunities WHERE "chargerId" IS NOT NULL
    UNION
    SELECT "chargerId" FROM sale_orders WHERE "chargerId" IS NOT NULL
    UNION
    SELECT "chargerId" FROM payments WHERE "chargerId" IS NOT NULL
    UNION
    SELECT "chargerId" FROM keep_records WHERE "chargerId" IS NOT NULL
    UNION
    SELECT "chargerId" FROM visit_records WHERE "chargerId" IS NOT NULL
    UNION
    SELECT "senderId" AS ext_id FROM crm_work_dailies WHERE "senderId" IS NOT NULL
  ) all_ids
  WHERE ext_id NOT IN (SELECT "dingtalkUserId" FROM employees WHERE "dingtalkUserId" IS NOT NULL)
) src;

-- ============================================================
-- Step B: 回填 CRM 7 张表（dingtalkUserId → Employee.id）
-- ============================================================

-- B1: customers
UPDATE customers SET "chargerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = customers."chargerId"
  AND customers."chargerId" IS NOT NULL
  AND customers."chargerId" != e.id;

-- B2: opportunities
UPDATE opportunities SET "chargerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = opportunities."chargerId"
  AND opportunities."chargerId" IS NOT NULL
  AND opportunities."chargerId" != e.id;

-- B3: sale_orders
UPDATE sale_orders SET "chargerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = sale_orders."chargerId"
  AND sale_orders."chargerId" IS NOT NULL
  AND sale_orders."chargerId" != e.id;

-- B4: payments
UPDATE payments SET "chargerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = payments."chargerId"
  AND payments."chargerId" IS NOT NULL
  AND payments."chargerId" != e.id;

-- B5: keep_records
UPDATE keep_records SET "chargerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = keep_records."chargerId"
  AND keep_records."chargerId" IS NOT NULL
  AND keep_records."chargerId" != e.id;

-- B6: visit_records
UPDATE visit_records SET "chargerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = visit_records."chargerId"
  AND visit_records."chargerId" IS NOT NULL
  AND visit_records."chargerId" != e.id;

-- B7: crm_work_dailies (senderId)
UPDATE crm_work_dailies SET "senderId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = crm_work_dailies."senderId"
  AND crm_work_dailies."senderId" IS NOT NULL
  AND crm_work_dailies."senderId" != e.id;

-- ============================================================
-- Step C: 回填 Project / EffortRecord / ProjectMember
-- ============================================================

-- C1: Project.ownerId — 按 ownerName 匹配 Employee.name
UPDATE projects SET "ownerId" = e.id
FROM employees e
WHERE e.name = projects."ownerName"
  AND e."deletedAt" IS NULL
  AND projects."ownerId" IS NOT NULL
  AND projects."ownerId" != e.id;
-- 匹配不到的置 NULL（避免遗留无效外键值）
UPDATE projects SET "ownerId" = NULL
WHERE "ownerId" IS NOT NULL
  AND "ownerId" NOT IN (SELECT id FROM employees);

-- C2: EffortRecord.ownerId — 多策略匹配
-- C2a: 先按 dingtalkUserId 匹配
UPDATE effort_records SET "ownerId" = e.id
FROM employees e
WHERE e."dingtalkUserId" = effort_records."ownerId"
  AND effort_records."ownerId" IS NOT NULL
  AND effort_records."ownerId" != e.id;

-- C2b: 再按 ownerName 匹配 Employee.name（针对尚未匹配的记录）
UPDATE effort_records SET "ownerId" = e.id
FROM employees e
WHERE e.name = effort_records."ownerName"
  AND e."deletedAt" IS NULL
  AND effort_records."ownerId" IS NOT NULL
  AND effort_records."ownerId" NOT IN (SELECT id FROM employees);

-- C2c: 再按 User.id → User.employeeId 匹配
UPDATE effort_records SET "ownerId" = u."employeeId"
FROM users u
WHERE u.id = effort_records."ownerId"
  AND u."employeeId" IS NOT NULL
  AND effort_records."ownerId" IS NOT NULL
  AND effort_records."ownerId" NOT IN (SELECT id FROM employees);

-- C2d: 剩余置 NULL
UPDATE effort_records SET "ownerId" = NULL
WHERE "ownerId" IS NOT NULL
  AND "ownerId" NOT IN (SELECT id FROM employees);

-- C3: ProjectMember — 重命名列 userId → employeeId，再按 userName 匹配
-- 幂等：如果列已重命名则跳过
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'project_members' AND column_name = 'userId') THEN
    ALTER TABLE project_members RENAME COLUMN "userId" TO "employeeId";
  END IF;
END $$;

-- 按 userName 匹配 Employee.name
UPDATE project_members SET "employeeId" = e.id
FROM employees e
WHERE e.name = project_members."userName"
  AND e."deletedAt" IS NULL
  AND project_members."employeeId" IS NOT NULL
  AND project_members."employeeId" NOT IN (SELECT id FROM employees);

-- 匹配不到的置 NULL
UPDATE project_members SET "employeeId" = NULL
WHERE "employeeId" IS NOT NULL
  AND "employeeId" NOT IN (SELECT id FROM employees);

-- 更新唯一约束（先删旧的，再建新的）
ALTER TABLE project_members DROP CONSTRAINT IF EXISTS "project_members_projectId_userId_key";
DROP INDEX IF EXISTS "project_members_userId_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "project_members_projectId_employeeId_key" ON project_members ("projectId", "employeeId");
CREATE INDEX IF NOT EXISTS "project_members_employeeId_idx" ON project_members ("employeeId");

-- ============================================================
-- Step D0-pre: 删除依赖 chargerId/chargerName 列的数据库视图
-- 这些视图是手动创建的（不在 Prisma migration 历史中），
-- ALTER COLUMN TYPE 会因视图依赖而失败，需先删后重建。
-- ============================================================

DROP VIEW IF EXISTS v_daily_activity;
DROP VIEW IF EXISTS v_salesperson_full;
DROP VIEW IF EXISTS v_customer_full;

-- ============================================================
-- Step D0: 变更列类型（varchar → text，匹配 Prisma String 默认映射）
-- ============================================================

-- CRM 6 表 chargerId: varchar(100) → text
ALTER TABLE customers ALTER COLUMN "chargerId" TYPE TEXT;
ALTER TABLE opportunities ALTER COLUMN "chargerId" TYPE TEXT;
ALTER TABLE sale_orders ALTER COLUMN "chargerId" TYPE TEXT;
ALTER TABLE payments ALTER COLUMN "chargerId" TYPE TEXT;
ALTER TABLE keep_records ALTER COLUMN "chargerId" TYPE TEXT;
ALTER TABLE visit_records ALTER COLUMN "chargerId" TYPE TEXT;

-- CrmWorkDaily senderId: varchar(100) → text
ALTER TABLE crm_work_dailies ALTER COLUMN "senderId" TYPE TEXT;

-- Project ownerId: varchar(50) → text
ALTER TABLE projects ALTER COLUMN "ownerId" TYPE TEXT;

-- EffortRecord ownerId: varchar(50) → text
ALTER TABLE effort_records ALTER COLUMN "ownerId" TYPE TEXT;

-- ProjectMember employeeId: varchar(50) NOT NULL → text NULL
ALTER TABLE project_members ALTER COLUMN "employeeId" TYPE TEXT;
ALTER TABLE project_members ALTER COLUMN "employeeId" DROP NOT NULL;

-- ============================================================
-- Step D: 添加 FK 约束（所有字段均为 nullable，允许 NULL）
-- ============================================================

ALTER TABLE customers
  ADD CONSTRAINT "customers_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE opportunities
  ADD CONSTRAINT "opportunities_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE sale_orders
  ADD CONSTRAINT "sale_orders_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE payments
  ADD CONSTRAINT "payments_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE keep_records
  ADD CONSTRAINT "keep_records_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE visit_records
  ADD CONSTRAINT "visit_records_chargerId_fkey"
  FOREIGN KEY ("chargerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE crm_work_dailies
  ADD CONSTRAINT "crm_work_dailies_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE projects
  ADD CONSTRAINT "projects_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE effort_records
  ADD CONSTRAINT "effort_records_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE project_members
  ADD CONSTRAINT "project_members_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Step E: 添加索引（如果不存在）
-- ============================================================

CREATE INDEX IF NOT EXISTS "customers_chargerId_idx" ON customers ("chargerId");
CREATE INDEX IF NOT EXISTS "opportunities_chargerId_idx" ON opportunities ("chargerId");
CREATE INDEX IF NOT EXISTS "sale_orders_chargerId_idx" ON sale_orders ("chargerId");
CREATE INDEX IF NOT EXISTS "payments_chargerId_idx" ON payments ("chargerId");
CREATE INDEX IF NOT EXISTS "keep_records_chargerId_idx" ON keep_records ("chargerId");
CREATE INDEX IF NOT EXISTS "visit_records_chargerId_idx" ON visit_records ("chargerId");
CREATE INDEX IF NOT EXISTS "crm_work_dailies_senderId_idx" ON crm_work_dailies ("senderId");
CREATE INDEX IF NOT EXISTS "projects_ownerId_idx" ON projects ("ownerId");

-- ============================================================
-- Step F: 重建数据库视图（原样重建，chargerName 列仍存在可用）
-- Phase 2 删除 Name 列时需同步更新这些 VIEW 改为 JOIN Employee 取名
-- ============================================================

-- F1: v_customer_full
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
      'decisionMaker', ct."decisionMaker",
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

-- F2: v_salesperson_full
CREATE OR REPLACE VIEW v_salesperson_full AS
WITH charger_list AS (
  SELECT DISTINCT "chargerId", "chargerName"
  FROM customers
  WHERE "deletedAt" IS NULL
    AND "chargerName" IS NOT NULL
    AND "chargerName" <> ''
),
customer_stats AS (
  SELECT "chargerName", COUNT(*) AS customer_count,
    COUNT(*) FILTER (WHERE "lastKeepRecordTime" > NOW() - INTERVAL '30 days') AS active_customer_count_30d,
    COUNT(*) FILTER (WHERE ("lastKeepRecordTime" < NOW() - INTERVAL '7 days' OR "lastKeepRecordTime" IS NULL)
                      AND "dealStatus" NOT IN ('已赢单', '多次赢单')) AS overdue_customer_count
  FROM customers WHERE "deletedAt" IS NULL GROUP BY "chargerName"
),
opp_stats AS (
  SELECT "chargerName", COUNT(*) AS opportunity_count, COALESCE(SUM("opportunityAmount"), 0) AS total_opportunity_amount
  FROM opportunities WHERE "deletedAt" IS NULL GROUP BY "chargerName"
),
order_stats AS (
  SELECT "chargerName", COUNT(*) AS order_count, COALESCE(SUM("orderAmount"), 0) AS total_order_amount
  FROM sale_orders WHERE "deletedAt" IS NULL GROUP BY "chargerName"
),
payment_stats AS (
  SELECT "chargerName", COUNT(*) AS payment_count, COALESCE(SUM("paymentAmount"), 0) AS total_paid
  FROM payments WHERE "deletedAt" IS NULL GROUP BY "chargerName"
),
activity_30d AS (
  SELECT "chargerName", COUNT(*) AS follow_up_count_30d
  FROM keep_records WHERE "deletedAt" IS NULL AND "keepRecordTime" > NOW() - INTERVAL '30 days' GROUP BY "chargerName"
),
visit_30d AS (
  SELECT c."chargerName", COUNT(*) AS visit_count_30d
  FROM visit_records vr JOIN customers c ON c.id = vr."customerId" AND c."deletedAt" IS NULL
  WHERE vr."deletedAt" IS NULL AND vr."signInTime" > NOW() - INTERVAL '30 days' GROUP BY c."chargerName"
)
SELECT
  cl."chargerId", cl."chargerName",
  COALESCE(cs.customer_count, 0) AS customer_count,
  COALESCE(cs.active_customer_count_30d, 0) AS active_customer_count_30d,
  COALESCE(cs.overdue_customer_count, 0) AS overdue_customer_count,
  COALESCE(os.opportunity_count, 0) AS opportunity_count,
  COALESCE(os.total_opportunity_amount, 0) AS total_opportunity_amount,
  COALESCE(ors.order_count, 0) AS order_count,
  COALESCE(ors.total_order_amount, 0) AS total_order_amount,
  COALESCE(ps.total_paid, 0) AS total_paid,
  CASE WHEN COALESCE(ors.total_order_amount, 0) > 0
    THEN ROUND(COALESCE(ps.total_paid, 0) / ors.total_order_amount * 100, 1) ELSE 0 END AS collection_rate_pct,
  COALESCE(a30.follow_up_count_30d, 0) AS follow_up_count_30d,
  COALESCE(v30.visit_count_30d, 0) AS visit_count_30d,
  (SELECT jsonb_agg(sub.rec ORDER BY sub.amt DESC) FROM (
    SELECT jsonb_build_object('name', c2."customerName",
      'orderAmount', COALESCE((SELECT SUM(so2."orderAmount") FROM sale_orders so2 WHERE so2."customerId" = c2.id AND so2."deletedAt" IS NULL), 0),
      'paid', COALESCE((SELECT SUM(p2."paymentAmount") FROM payments p2 WHERE p2."customerId" = c2.id AND p2."deletedAt" IS NULL), 0),
      'lastFollowUp', c2."lastKeepRecordTime", 'dealStatus', c2."dealStatus"
    ) AS rec,
    COALESCE((SELECT SUM(so2."orderAmount") FROM sale_orders so2 WHERE so2."customerId" = c2.id AND so2."deletedAt" IS NULL), 0) AS amt
    FROM customers c2 WHERE c2."chargerName" = cl."chargerName" AND c2."deletedAt" IS NULL ORDER BY amt DESC LIMIT 5
  ) sub) AS top_customers,
  (SELECT jsonb_agg(jsonb_build_object('name', o2."opportunityName",
      'customer', (SELECT c3."customerName" FROM customers c3 WHERE c3.id = o2."customerId"),
      'amount', o2."opportunityAmount", 'stage', o2."opportunityStage",
      'winRate', o2."winRate", 'expectedDealDate', o2."expectedDealDate"
  ) ORDER BY o2."opportunityAmount" DESC)
  FROM opportunities o2
  WHERE o2."chargerName" = cl."chargerName" AND o2."deletedAt" IS NULL
    AND o2."opportunityStage" NOT IN ('赢单', '输单流失')
  ) AS active_opportunities,
  (SELECT jsonb_agg(sub.rec ORDER BY sub.t DESC) FROM (
    SELECT jsonb_build_object('customer', (SELECT c4."customerName" FROM customers c4 WHERE c4.id = kr2."customerId"),
      'time', kr2."keepRecordTime", 'type', kr2."keepRecordType", 'content', kr2."keepRecordContent"
    ) AS rec, kr2."keepRecordTime" AS t
    FROM keep_records kr2 WHERE kr2."chargerName" = cl."chargerName" AND kr2."deletedAt" IS NULL
    ORDER BY kr2."keepRecordTime" DESC LIMIT 10
  ) sub) AS recent_follow_ups,
  (SELECT jsonb_agg(jsonb_build_object('name', c5."customerName",
      'lastFollowUp', c5."lastKeepRecordTime",
      'daysSince', EXTRACT(DAY FROM NOW() - c5."lastKeepRecordTime")::int
  ) ORDER BY c5."lastKeepRecordTime" ASC)
  FROM customers c5
  WHERE c5."chargerName" = cl."chargerName" AND c5."deletedAt" IS NULL
    AND (c5."lastKeepRecordTime" < NOW() - INTERVAL '7 days' OR c5."lastKeepRecordTime" IS NULL)
    AND c5."dealStatus" NOT IN ('已赢单', '多次赢单')
  ) AS overdue_customers
FROM charger_list cl
LEFT JOIN customer_stats cs ON cs."chargerName" = cl."chargerName"
LEFT JOIN opp_stats os ON os."chargerName" = cl."chargerName"
LEFT JOIN order_stats ors ON ors."chargerName" = cl."chargerName"
LEFT JOIN payment_stats ps ON ps."chargerName" = cl."chargerName"
LEFT JOIN activity_30d a30 ON a30."chargerName" = cl."chargerName"
LEFT JOIN visit_30d v30 ON v30."chargerName" = cl."chargerName";

-- F3: v_daily_activity
CREATE OR REPLACE VIEW v_daily_activity AS
WITH date_range AS (
  SELECT MIN(d)::date AS min_date FROM (
    SELECT MIN("keepRecordTime") AS d FROM keep_records WHERE "deletedAt" IS NULL
    UNION ALL SELECT MIN("signInTime") FROM visit_records WHERE "deletedAt" IS NULL
    UNION ALL SELECT MIN("businessDate") FROM payments WHERE "deletedAt" IS NULL
    UNION ALL SELECT MIN("createdAt") FROM customers WHERE "deletedAt" IS NULL
    UNION ALL SELECT MIN("createdAt") FROM opportunities WHERE "deletedAt" IS NULL
    UNION ALL SELECT MIN("reportDate") FROM crm_work_dailies WHERE "deletedAt" IS NULL
  ) sub
),
date_series AS (
  SELECT generate_series((SELECT min_date FROM date_range), CURRENT_DATE, '1 day'::interval)::date AS date
),
daily_follow_ups AS (
  SELECT ("keepRecordTime" AT TIME ZONE 'Asia/Shanghai')::date AS date, COUNT(*) AS count,
    jsonb_agg(jsonb_build_object('charger', "chargerName",
      'customer', (SELECT c."customerName" FROM customers c WHERE c.id = kr."customerId"),
      'type', "keepRecordType", 'content', "keepRecordContent", 'time', "keepRecordTime"
    ) ORDER BY "keepRecordTime" DESC) AS details
  FROM keep_records kr WHERE "deletedAt" IS NULL
  GROUP BY ("keepRecordTime" AT TIME ZONE 'Asia/Shanghai')::date
),
daily_visits AS (
  SELECT ("signInTime" AT TIME ZONE 'Asia/Shanghai')::date AS date, COUNT(*) AS count,
    jsonb_agg(jsonb_build_object('customer', (SELECT c."customerName" FROM customers c WHERE c.id = vr."customerId"),
      'type', "visitType", 'content', content, 'address', "signAddress", 'duration', duration, 'time', "signInTime"
    ) ORDER BY "signInTime" DESC) AS details
  FROM visit_records vr WHERE "deletedAt" IS NULL
  GROUP BY ("signInTime" AT TIME ZONE 'Asia/Shanghai')::date
),
daily_payments AS (
  SELECT ("businessDate" AT TIME ZONE 'Asia/Shanghai')::date AS date, COUNT(*) AS count,
    COALESCE(SUM("paymentAmount"), 0) AS amount,
    jsonb_agg(jsonb_build_object('customer', (SELECT c."customerName" FROM customers c WHERE c.id = p."customerId"),
      'order', (SELECT so."orderTitle" FROM sale_orders so WHERE so.id = p."saleOrderId"),
      'amount', "paymentAmount", 'type', "paymentType", 'charger', "chargerName"
    ) ORDER BY "paymentAmount" DESC) AS details
  FROM payments p WHERE "deletedAt" IS NULL
  GROUP BY ("businessDate" AT TIME ZONE 'Asia/Shanghai')::date
),
daily_new_customers AS (
  SELECT ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date AS date, COUNT(*) AS count,
    jsonb_agg(jsonb_build_object('name', "customerName", 'source', "customerSource",
      'charger', "chargerName", 'industry', industry
    ) ORDER BY "createdAt" DESC) AS details
  FROM customers WHERE "deletedAt" IS NULL
  GROUP BY ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date
),
daily_new_opportunities AS (
  SELECT ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date AS date, COUNT(*) AS count,
    COALESCE(SUM("opportunityAmount"), 0) AS amount,
    jsonb_agg(jsonb_build_object('name', "opportunityName",
      'customer', (SELECT c."customerName" FROM customers c WHERE c.id = o."customerId"),
      'amount', "opportunityAmount", 'stage', "opportunityStage", 'charger', "chargerName"
    ) ORDER BY "opportunityAmount" DESC) AS details
  FROM opportunities o WHERE "deletedAt" IS NULL
  GROUP BY ("createdAt" AT TIME ZONE 'Asia/Shanghai')::date
),
daily_reports AS (
  SELECT ("reportDate" AT TIME ZONE 'Asia/Shanghai')::date AS date, COUNT(*) AS count,
    jsonb_agg(jsonb_build_object('sender', "senderName",
      'callsMade', "callsMadeCount", 'callsConnected', "callsConnectedCount",
      'visitCount', "visitCustomerCount", 'newCustomers', "newCustomerCount",
      'keySummary', "keyCustomerSummary", 'tomorrowPlan', "tomorrowVisitPlan"
    )) AS details
  FROM crm_work_dailies WHERE "deletedAt" IS NULL
  GROUP BY ("reportDate" AT TIME ZONE 'Asia/Shanghai')::date
)
SELECT
  ds.date, TO_CHAR(ds.date, 'YYYY-MM-DD Dy') AS date_display,
  COALESCE(df.count, 0) AS follow_up_count, COALESCE(dv.count, 0) AS visit_count,
  COALESCE(dp.count, 0) AS payment_count, COALESCE(dp.amount, 0) AS payment_amount,
  COALESCE(dnc.count, 0) AS new_customer_count, COALESCE(dno.count, 0) AS new_opportunity_count,
  COALESCE(dno.amount, 0) AS new_opportunity_amount, COALESCE(dr.count, 0) AS daily_report_count,
  df.details AS follow_ups, dv.details AS visits, dp.details AS payments,
  dnc.details AS new_customers, dno.details AS new_opportunities, dr.details AS daily_reports
FROM date_series ds
LEFT JOIN daily_follow_ups df ON df.date = ds.date
LEFT JOIN daily_visits dv ON dv.date = ds.date
LEFT JOIN daily_payments dp ON dp.date = ds.date
LEFT JOIN daily_new_customers dnc ON dnc.date = ds.date
LEFT JOIN daily_new_opportunities dno ON dno.date = ds.date
LEFT JOIN daily_reports dr ON dr.date = ds.date;
