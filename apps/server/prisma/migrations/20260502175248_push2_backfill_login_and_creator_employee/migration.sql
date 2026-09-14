-- =====================================================================
-- Push 2: 数据回填迁移
--
-- 内容：
--   A. employees 登录字段从 users 表反向回填（8 字段）
--   B. 44 张业务表的 createdBy → creatorEmployeeId 反查回填
--   C. 44 张业务表的 updatedBy → updaterEmployeeId 反查回填
--   D. 12 张 yccrm 表的 creator/updaterEmployeeId 已有 dingtalk-sync 写入的值，
--      回填 SQL 加 IS NULL 兜底避免覆盖
--   E. diet_*.ownerId 二义性消除（从 user.id 改为 employee.id）
--
-- 前置依赖：push 1 schema 已应用（33 张表 creator/updaterEmployeeId 列已加，
--          employees 8 个登录字段列已加）。
--
-- 数据假设：user 均已绑定 employeeId，可用 INNER JOIN 回填。
-- 软删 user 仍保留 employeeId，回填可命中。
--
-- 回滚：直接 UPDATE 各列回 NULL。但本 migration 无 destructive 操作，
--       回滚意义有限（创建即默认 NULL，回填后变成 employee.id）。
-- =====================================================================

-- ------------------------------------------------------------
-- A. employees 登录字段从 users 表反向回填
-- ------------------------------------------------------------
UPDATE employees e
SET "username"         = u.username,
    "password"         = u.password,
    "loginStatus"      = u.status,
    "canLogin"         = TRUE,
    "lastLoginAt"      = u."lastLoginAt",
    "lastLoginIp"      = u."lastLoginIp",
    "loginFailCount"   = u."loginFailCount",
    "lockUntil"        = u."lockUntil"
FROM users u
WHERE u."employeeId" = e.id
  AND u."deletedAt" IS NULL;

-- ------------------------------------------------------------
-- B. system 9 张表的 creator/updater 回填
-- ------------------------------------------------------------

-- users 表自身（push 6 会删除，但 push 4 切流量前部分链路可能仍依赖）
UPDATE users t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE users t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- personal_access_tokens（仅 createdBy）
UPDATE personal_access_tokens t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;

-- roles
UPDATE roles t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE roles t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- system_configs
UPDATE system_configs t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE system_configs t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- filter_schemes（仅 updatedBy）
UPDATE filter_schemes t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- notifications
UPDATE notifications t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE notifications t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- employees（自我引用：员工记录的创建/修改人也是员工）
UPDATE employees t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE employees t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- departments
UPDATE departments t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE departments t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- employee_departments（仅 createdBy）
UPDATE employee_departments t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;

-- ------------------------------------------------------------
-- C. yccrm 12 张表（04-28 已有 creator/updaterEmployeeId，
--    dingtalk-sync 同步路径的数据已经写入。
--    此处仅回填 azeroth server 端创建的 NULL 数据：
--    WHERE creator/updaterEmployeeId IS NULL 兜底避免覆盖 yccrm 的值。）
-- ------------------------------------------------------------

UPDATE customers t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE customers t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE contacts t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE contacts t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE opportunities t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE opportunities t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE sale_orders t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE sale_orders t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE payments t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE payments t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE invoices t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE invoices t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE keep_records t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE keep_records t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE visit_records t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE visit_records t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE crm_products t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE crm_products t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE opportunity_products t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE opportunity_products t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE order_products t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE order_products t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE crm_work_dailies t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE crm_work_dailies t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- ------------------------------------------------------------
-- D. payroll 3 张表
-- ------------------------------------------------------------

UPDATE payroll_import_batches t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE payroll_import_batches t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE payroll_periods t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE payroll_periods t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE payroll_records t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE payroll_records t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- ------------------------------------------------------------
-- E. project 5 张表
-- ------------------------------------------------------------

UPDATE projects t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE projects t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE project_sale_orders t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;

UPDATE project_members t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE project_members t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE effort_records t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE effort_records t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE project_tickets t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE project_tickets t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- ------------------------------------------------------------
-- F. approval 4 张表
-- ------------------------------------------------------------

UPDATE approval_flows t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE approval_flows t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE approval_flow_nodes t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE approval_flow_nodes t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE approval_instances t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE approval_instances t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE approval_tasks t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE approval_tasks t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

-- ------------------------------------------------------------
-- G. diet/body 12 张表 — 注意 ownerId 二义性消除
-- ------------------------------------------------------------

UPDATE diet_foods t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_foods t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE diet_supplements t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_supplements t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE diet_plans t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_plans t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;
-- diet_plans.ownerId 二义性消除：从 user.id 改为 employee.id
UPDATE diet_plans t SET "ownerId" = u."employeeId" FROM users u WHERE u.id = t."ownerId" AND u."employeeId" IS NOT NULL;

UPDATE diet_meal_slots t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_meal_slots t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE diet_plan_supplements t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_plan_supplements t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE diet_daily_logs t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_daily_logs t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;
UPDATE diet_daily_logs t SET "ownerId" = u."employeeId" FROM users u WHERE u.id = t."ownerId" AND u."employeeId" IS NOT NULL;

UPDATE diet_daily_meal_entries t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_daily_meal_entries t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE diet_daily_supplement_entries t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_daily_supplement_entries t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;

UPDATE diet_water_logs t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_water_logs t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;
UPDATE diet_water_logs t SET "ownerId" = u."employeeId" FROM users u WHERE u.id = t."ownerId" AND u."employeeId" IS NOT NULL;

UPDATE diet_subjective_logs t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_subjective_logs t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;
UPDATE diet_subjective_logs t SET "ownerId" = u."employeeId" FROM users u WHERE u.id = t."ownerId" AND u."employeeId" IS NOT NULL;

UPDATE body_metrics t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE body_metrics t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;
UPDATE body_metrics t SET "ownerId" = u."employeeId" FROM users u WHERE u.id = t."ownerId" AND u."employeeId" IS NOT NULL;

UPDATE diet_purchase_items t SET "creatorEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."createdBy" AND t."creatorEmployeeId" IS NULL;
UPDATE diet_purchase_items t SET "updaterEmployeeId" = u."employeeId" FROM users u WHERE u.id = t."updatedBy" AND t."updaterEmployeeId" IS NULL;
UPDATE diet_purchase_items t SET "ownerId" = u."employeeId" FROM users u WHERE u.id = t."ownerId" AND u."employeeId" IS NOT NULL;

-- ------------------------------------------------------------
-- 验证查询（注释；运行 migration 后人工跑一次）
-- ------------------------------------------------------------
-- 1. 登录字段回填验证（应等于 39）：
--    SELECT count(*) FROM employees WHERE can_login = TRUE;
--
-- 2. 关键表 creator 残余 NULL 验证（应为 0 或仅指向已删 user 的孤儿）：
--    SELECT count(*) FROM customers WHERE created_by IS NOT NULL AND "creatorEmployeeId" IS NULL;
--    SELECT count(*) FROM employees WHERE created_by IS NOT NULL AND "creatorEmployeeId" IS NULL;
--    SELECT count(*) FROM payroll_records WHERE created_by IS NOT NULL AND "creatorEmployeeId" IS NULL;
--
-- 3. diet_*.ownerId 二义性消除验证（应为 0，所有 ownerId 都是 employee.id 而不是 user.id）：
--    SELECT count(*) FROM diet_daily_logs t INNER JOIN users u ON u.id = t.owner_id;
