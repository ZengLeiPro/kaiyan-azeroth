-- 阶段 3 新增 Prisma 索引
--
-- 说明：本 migration 是在 20260418234619_add_filter_schemes 之后叠加的。
-- 使用 `prisma migrate diff --from-schema-datamodel <stage-0 HEAD> --to-schema-datamodel <current>`
-- 生成后，手工裁掉 stage 1 已覆盖的：
--   * CREATE TABLE filter_schemes / UNIQUE INDEX filter_schemes_pageKey_key
--   * 12 条 customers_* 索引
-- 只保留 stage 3 新增的索引定义。本机未连真实 DB，故本文件仅为 SQL 草案，
-- 上线前请 DBA 在生产 RDS 上以 `CREATE INDEX IF NOT EXISTS` 形式分批执行。

-- CreateIndex
CREATE INDEX "roles_status_idx" ON "roles"("status");

-- CreateIndex
CREATE INDEX "roles_createdAt_idx" ON "roles"("createdAt");

-- CreateIndex
CREATE INDEX "roles_updatedAt_idx" ON "roles"("updatedAt");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employees_gender_idx" ON "employees"("gender");

-- CreateIndex
CREATE INDEX "employees_entryDate_idx" ON "employees"("entryDate");

-- CreateIndex
CREATE INDEX "employees_createdAt_idx" ON "employees"("createdAt");

-- CreateIndex
CREATE INDEX "employees_updatedAt_idx" ON "employees"("updatedAt");

-- CreateIndex
CREATE INDEX "employees_isAdmin_idx" ON "employees"("isAdmin");

-- CreateIndex
CREATE INDEX "employees_isLeader_idx" ON "employees"("isLeader");

-- CreateIndex
CREATE INDEX "employees_dingtalkActive_idx" ON "employees"("dingtalkActive");

-- CreateIndex
CREATE INDEX "departments_status_idx" ON "departments"("status");

-- CreateIndex
CREATE INDEX "departments_createdAt_idx" ON "departments"("createdAt");

-- CreateIndex
CREATE INDEX "departments_updatedAt_idx" ON "departments"("updatedAt");

-- CreateIndex
CREATE INDEX "contacts_status_idx" ON "contacts"("status");

-- CreateIndex
CREATE INDEX "contacts_createdAt_idx" ON "contacts"("createdAt");

-- CreateIndex
CREATE INDEX "contacts_updatedAt_idx" ON "contacts"("updatedAt");

-- CreateIndex
CREATE INDEX "contacts_customerId_deletedAt_createdAt_idx" ON "contacts"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "opportunities_status_idx" ON "opportunities"("status");

-- CreateIndex
CREATE INDEX "opportunities_opportunityStage_idx" ON "opportunities"("opportunityStage");

-- CreateIndex
CREATE INDEX "opportunities_expectedDealDate_idx" ON "opportunities"("expectedDealDate");

-- CreateIndex
CREATE INDEX "opportunities_realDealDate_idx" ON "opportunities"("realDealDate");

-- CreateIndex
CREATE INDEX "opportunities_createdAt_idx" ON "opportunities"("createdAt");

-- CreateIndex
CREATE INDEX "opportunities_updatedAt_idx" ON "opportunities"("updatedAt");

-- CreateIndex
CREATE INDEX "opportunities_opportunityAmount_idx" ON "opportunities"("opportunityAmount");

-- CreateIndex
CREATE INDEX "opportunities_chargerId_deletedAt_createdAt_idx" ON "opportunities"("chargerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "opportunities_customerId_deletedAt_createdAt_idx" ON "opportunities"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "sale_orders_status_idx" ON "sale_orders"("status");

-- CreateIndex
CREATE INDEX "sale_orders_orderStatus_idx" ON "sale_orders"("orderStatus");

-- CreateIndex
CREATE INDEX "sale_orders_businessDate_idx" ON "sale_orders"("businessDate");

-- CreateIndex
CREATE INDEX "sale_orders_orderBeginDate_idx" ON "sale_orders"("orderBeginDate");

-- CreateIndex
CREATE INDEX "sale_orders_orderEndDate_idx" ON "sale_orders"("orderEndDate");

-- CreateIndex
CREATE INDEX "sale_orders_createdAt_idx" ON "sale_orders"("createdAt");

-- CreateIndex
CREATE INDEX "sale_orders_updatedAt_idx" ON "sale_orders"("updatedAt");

-- CreateIndex
CREATE INDEX "sale_orders_orderAmount_idx" ON "sale_orders"("orderAmount");

-- CreateIndex
CREATE INDEX "sale_orders_chargerId_deletedAt_createdAt_idx" ON "sale_orders"("chargerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "sale_orders_customerId_deletedAt_createdAt_idx" ON "sale_orders"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_paymentType_idx" ON "payments"("paymentType");

-- CreateIndex
CREATE INDEX "payments_businessDate_idx" ON "payments"("businessDate");

-- CreateIndex
CREATE INDEX "payments_createdAt_idx" ON "payments"("createdAt");

-- CreateIndex
CREATE INDEX "payments_updatedAt_idx" ON "payments"("updatedAt");

-- CreateIndex
CREATE INDEX "payments_paymentAmount_idx" ON "payments"("paymentAmount");

-- CreateIndex
CREATE INDEX "payments_chargerId_deletedAt_createdAt_idx" ON "payments"("chargerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "payments_customerId_deletedAt_createdAt_idx" ON "payments"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_invoiceStatus_idx" ON "invoices"("invoiceStatus");

-- CreateIndex
CREATE INDEX "invoices_invoiceType_idx" ON "invoices"("invoiceType");

-- CreateIndex
CREATE INDEX "invoices_itemType_idx" ON "invoices"("itemType");

-- CreateIndex
CREATE INDEX "invoices_invoiceDate_idx" ON "invoices"("invoiceDate");

-- CreateIndex
CREATE INDEX "invoices_createdAt_idx" ON "invoices"("createdAt");

-- CreateIndex
CREATE INDEX "invoices_updatedAt_idx" ON "invoices"("updatedAt");

-- CreateIndex
CREATE INDEX "invoices_invoiceAmount_idx" ON "invoices"("invoiceAmount");

-- CreateIndex
CREATE INDEX "invoices_customerId_deletedAt_createdAt_idx" ON "invoices"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "keep_records_keepRecordType_idx" ON "keep_records"("keepRecordType");

-- CreateIndex
CREATE INDEX "keep_records_keepRecordStatus_idx" ON "keep_records"("keepRecordStatus");

-- CreateIndex
CREATE INDEX "keep_records_keepRecordTime_idx" ON "keep_records"("keepRecordTime");

-- CreateIndex
CREATE INDEX "keep_records_createdAt_idx" ON "keep_records"("createdAt");

-- CreateIndex
CREATE INDEX "keep_records_updatedAt_idx" ON "keep_records"("updatedAt");

-- CreateIndex
CREATE INDEX "keep_records_chargerId_deletedAt_createdAt_idx" ON "keep_records"("chargerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "keep_records_customerId_deletedAt_createdAt_idx" ON "keep_records"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "visit_records_visitType_idx" ON "visit_records"("visitType");

-- CreateIndex
CREATE INDEX "visit_records_visitStatus_idx" ON "visit_records"("visitStatus");

-- CreateIndex
CREATE INDEX "visit_records_signInTime_idx" ON "visit_records"("signInTime");

-- CreateIndex
CREATE INDEX "visit_records_signOutTime_idx" ON "visit_records"("signOutTime");

-- CreateIndex
CREATE INDEX "visit_records_createdAt_idx" ON "visit_records"("createdAt");

-- CreateIndex
CREATE INDEX "visit_records_updatedAt_idx" ON "visit_records"("updatedAt");

-- CreateIndex
CREATE INDEX "visit_records_chargerId_deletedAt_createdAt_idx" ON "visit_records"("chargerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "visit_records_customerId_deletedAt_createdAt_idx" ON "visit_records"("customerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "crm_products_status_idx" ON "crm_products"("status");

-- CreateIndex
CREATE INDEX "crm_products_productStatus_idx" ON "crm_products"("productStatus");

-- CreateIndex
CREATE INDEX "crm_products_productTypes_idx" ON "crm_products"("productTypes");

-- CreateIndex
CREATE INDEX "crm_products_productUnit_idx" ON "crm_products"("productUnit");

-- CreateIndex
CREATE INDEX "crm_products_createdAt_idx" ON "crm_products"("createdAt");

-- CreateIndex
CREATE INDEX "crm_products_updatedAt_idx" ON "crm_products"("updatedAt");

-- CreateIndex
CREATE INDEX "crm_products_standardPrice_idx" ON "crm_products"("standardPrice");

-- CreateIndex
CREATE INDEX "crm_work_dailies_status_idx" ON "crm_work_dailies"("status");

-- CreateIndex
CREATE INDEX "crm_work_dailies_submitStatus_idx" ON "crm_work_dailies"("submitStatus");

-- CreateIndex
CREATE INDEX "crm_work_dailies_reportType_idx" ON "crm_work_dailies"("reportType");

-- CreateIndex
CREATE INDEX "crm_work_dailies_reportDate_idx" ON "crm_work_dailies"("reportDate");

-- CreateIndex
CREATE INDEX "crm_work_dailies_createdAt_idx" ON "crm_work_dailies"("createdAt");

-- CreateIndex
CREATE INDEX "crm_work_dailies_updatedAt_idx" ON "crm_work_dailies"("updatedAt");

-- CreateIndex
CREATE INDEX "crm_work_dailies_senderId_deletedAt_createdAt_idx" ON "crm_work_dailies"("senderId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "projects_category_idx" ON "projects"("category");

-- CreateIndex
CREATE INDEX "projects_startDate_idx" ON "projects"("startDate");

-- CreateIndex
CREATE INDEX "projects_endDate_idx" ON "projects"("endDate");

-- CreateIndex
CREATE INDEX "projects_createdAt_idx" ON "projects"("createdAt");

-- CreateIndex
CREATE INDEX "projects_updatedAt_idx" ON "projects"("updatedAt");

-- CreateIndex
CREATE INDEX "projects_ownerId_deletedAt_createdAt_idx" ON "projects"("ownerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "effort_records_workType_idx" ON "effort_records"("workType");

-- CreateIndex
CREATE INDEX "effort_records_recordType_idx" ON "effort_records"("recordType");

-- CreateIndex
CREATE INDEX "effort_records_createdAt_idx" ON "effort_records"("createdAt");

-- CreateIndex
CREATE INDEX "effort_records_updatedAt_idx" ON "effort_records"("updatedAt");

-- CreateIndex
CREATE INDEX "effort_records_actualTime_idx" ON "effort_records"("actualTime");

-- CreateIndex
CREATE INDEX "effort_records_ownerId_deletedAt_createdAt_idx" ON "effort_records"("ownerId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "project_tickets_ticketType_idx" ON "project_tickets"("ticketType");

-- CreateIndex
CREATE INDEX "project_tickets_priority_idx" ON "project_tickets"("priority");

-- CreateIndex
CREATE INDEX "project_tickets_updatedAt_idx" ON "project_tickets"("updatedAt");

-- CreateIndex
CREATE INDEX "project_tickets_assigneeId_deletedAt_createdAt_idx" ON "project_tickets"("assigneeId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "project_tickets_dispatcherId_deletedAt_createdAt_idx" ON "project_tickets"("dispatcherId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "dingtalk_logs_creatorId_idx" ON "dingtalk_logs"("creatorId");

-- CreateIndex
CREATE INDEX "dingtalk_logs_createTime_idx" ON "dingtalk_logs"("createTime");

-- CreateIndex
CREATE INDEX "dingtalk_logs_syncedAt_idx" ON "dingtalk_logs"("syncedAt");

-- CreateIndex
CREATE INDEX "employee_leaves_leaveTime_idx" ON "employee_leaves"("leaveTime");

-- CreateIndex
CREATE INDEX "employee_leaves_syncedAt_idx" ON "employee_leaves"("syncedAt");

-- CreateIndex
CREATE INDEX "approval_flows_status_idx" ON "approval_flows"("status");

-- CreateIndex
CREATE INDEX "approval_flows_createdAt_idx" ON "approval_flows"("createdAt");

-- CreateIndex
CREATE INDEX "approval_flows_updatedAt_idx" ON "approval_flows"("updatedAt");
