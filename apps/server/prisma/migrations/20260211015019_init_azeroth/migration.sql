-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(100),
    "password" VARCHAR(255) NOT NULL,
    "avatar" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" VARCHAR(50),
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceType" VARCHAR(20) NOT NULL,
    "deviceName" VARCHAR(100) NOT NULL,
    "browser" VARCHAR(50) NOT NULL,
    "os" VARCHAR(50) NOT NULL,
    "ipAddress" VARCHAR(50) NOT NULL,
    "location" VARCHAR(100),
    "refreshToken" VARCHAR(500) NOT NULL,
    "loginTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "menu" VARCHAR(50) NOT NULL,
    "view" BOOLEAN NOT NULL DEFAULT false,
    "create" BOOLEAN NOT NULL DEFAULT false,
    "edit" BOOLEAN NOT NULL DEFAULT false,
    "delete" BOOLEAN NOT NULL DEFAULT false,
    "export" BOOLEAN NOT NULL DEFAULT false,
    "approve" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configs" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "group" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "ipAddress" VARCHAR(50),
    "module" VARCHAR(50) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "target" VARCHAR(100),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(36) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "link" VARCHAR(500),
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_number_counters" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "dateKey" VARCHAR(10),
    "counter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "serial_number_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "serialNumber" VARCHAR(32) NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(100),
    "gender" VARCHAR(10),
    "position" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "entryDate" TIMESTAMP(3),
    "avatar" VARCHAR(500),
    "dingtalkUserId" VARCHAR(50),
    "dingtalkUnionId" VARCHAR(50),
    "jobNumber" VARCHAR(50),
    "workPlace" VARCHAR(200),
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isBoss" BOOLEAN NOT NULL DEFAULT false,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "dingtalkActive" BOOLEAN NOT NULL DEFAULT true,
    "dingtalkExtension" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "managerId" TEXT,
    "dingtalkDeptId" INTEGER,
    "dingtalkParentId" INTEGER,
    "createDeptGroup" BOOLEAN NOT NULL DEFAULT false,
    "autoAddUser" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_departments" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "employee_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "serialNumber" VARCHAR(32) NOT NULL,
    "customerName" VARCHAR(200) NOT NULL,
    "shortName" VARCHAR(100),
    "industry" VARCHAR(100),
    "customerLevel" VARCHAR(50),
    "customerSource" VARCHAR(50),
    "customerRelationship" VARCHAR(50),
    "customerTags" JSONB,
    "country" VARCHAR(50),
    "province" VARCHAR(50),
    "city" VARCHAR(50),
    "district" VARCHAR(50),
    "address" TEXT,
    "phone" VARCHAR(50),
    "remark" TEXT,
    "organizationId" VARCHAR(100),
    "uncId" VARCHAR(50),
    "headcountRange" VARCHAR(50),
    "chargerId" VARCHAR(100),
    "chargerName" VARCHAR(50),
    "collaboratorName" TEXT,
    "contactStatus" VARCHAR(50),
    "dealStatus" VARCHAR(50),
    "lastKeepRecordTime" TIMESTAMP(3),
    "lastKeepRecordContent" TEXT,
    "paidAmountLast365Days" DECIMAL(12,2),
    "accountsReceivable" DECIMAL(12,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "contactName" VARCHAR(100) NOT NULL,
    "customerId" TEXT NOT NULL,
    "sex" VARCHAR(10),
    "mobile" VARCHAR(50),
    "phone" VARCHAR(50),
    "email" VARCHAR(100),
    "wechat" VARCHAR(100),
    "position" VARCHAR(100),
    "department" VARCHAR(100),
    "decisionMaker" VARCHAR(20),
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "serialNumber" VARCHAR(32) NOT NULL,
    "opportunityName" VARCHAR(200) NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "opportunityStage" VARCHAR(50),
    "opportunityAmount" DECIMAL(12,2),
    "winRate" DECIMAL(5,2),
    "expectedDealDate" TIMESTAMP(3),
    "realDealDate" TIMESTAMP(3),
    "chargerId" VARCHAR(100),
    "chargerName" VARCHAR(50),
    "loseReason" TEXT,
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_orders" (
    "id" TEXT NOT NULL,
    "serialNumber" VARCHAR(32) NOT NULL,
    "orderTitle" VARCHAR(200),
    "customerId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "orderAmount" DECIMAL(12,2),
    "productAmount" DECIMAL(12,2),
    "totalReceivables" DECIMAL(12,2),
    "totalReceived" DECIMAL(12,2),
    "totalUncollected" DECIMAL(12,2),
    "orderStatus" VARCHAR(50),
    "businessDate" TIMESTAMP(3),
    "orderBeginDate" TIMESTAMP(3),
    "orderEndDate" TIMESTAMP(3),
    "chargerId" VARCHAR(100),
    "chargerName" VARCHAR(50),
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "serialNumber" VARCHAR(32) NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentAmount" DECIMAL(12,2) NOT NULL,
    "paymentType" VARCHAR(50),
    "businessDate" TIMESTAMP(3),
    "payer" VARCHAR(100),
    "bankName" VARCHAR(100),
    "tradeSerialNumber" VARCHAR(100),
    "chargerId" VARCHAR(100),
    "chargerName" VARCHAR(50),
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "serialNumber" VARCHAR(32) NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceAmount" DECIMAL(12,2) NOT NULL,
    "invoiceType" VARCHAR(50),
    "invoiceDate" TIMESTAMP(3),
    "invoiceNumber" VARCHAR(100),
    "title" VARCHAR(200),
    "taxIdentifyNum" VARCHAR(50),
    "invoiceStatus" VARCHAR(50),
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keep_records" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "keepRecordType" VARCHAR(50),
    "keepRecordTime" TIMESTAMP(3),
    "keepRecordContent" TEXT,
    "keepRecordStatus" VARCHAR(50),
    "signLocation" TEXT,
    "signAddress" TEXT,
    "attachments" JSONB,
    "chargerId" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "keep_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_records" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "visitType" VARCHAR(50),
    "content" TEXT,
    "signInTime" TIMESTAMP(3),
    "signOutTime" TIMESTAMP(3),
    "signAddress" TEXT,
    "duration" INTEGER,
    "visitStatus" VARCHAR(50),
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "visit_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_products" (
    "id" TEXT NOT NULL,
    "productName" VARCHAR(200) NOT NULL,
    "productNumber" VARCHAR(50),
    "productTypes" VARCHAR(100),
    "productUnit" VARCHAR(50),
    "standardPrice" DECIMAL(12,2),
    "productStatus" VARCHAR(50),
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "crm_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_products" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "productName" VARCHAR(200) NOT NULL,
    "productNumber" VARCHAR(50),
    "productPrice" DECIMAL(12,2),
    "quantity" DECIMAL(12,2),
    "unitPrice" DECIMAL(12,2),
    "discount" DECIMAL(5,2),
    "subtotalAmount" DECIMAL(12,2),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_products" (
    "id" TEXT NOT NULL,
    "saleOrderId" TEXT NOT NULL,
    "productName" VARCHAR(200) NOT NULL,
    "productNumber" VARCHAR(50),
    "productPrice" DECIMAL(12,2),
    "quantity" DECIMAL(12,2),
    "unitPrice" DECIMAL(12,2),
    "discount" DECIMAL(5,2),
    "subtotalAmount" DECIMAL(12,2),
    "remark" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_work_dailies" (
    "id" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3),
    "reportType" VARCHAR(50),
    "submitStatus" VARCHAR(50),
    "senderId" VARCHAR(100),
    "senderName" VARCHAR(100),
    "keyCustomerSummary" TEXT,
    "tomorrowVisitPlan" TEXT,
    "otherPlanArrangements" TEXT,
    "coordinationItems" TEXT,
    "callsMadeCount" INTEGER,
    "callsConnectedCount" INTEGER,
    "visitCustomerCount" INTEGER,
    "newCustomerCount" INTEGER,
    "attachments" JSONB,
    "remark" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "crm_work_dailies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "logicalStatus" VARCHAR(50),
    "ownerId" VARCHAR(50),
    "ownerName" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" VARCHAR(50) NOT NULL,
    "userName" VARCHAR(100),
    "email" VARCHAR(200),
    "role" VARCHAR(50),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "workItemType" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'open',
    "priority" VARCHAR(50),
    "description" TEXT,
    "assigneeId" VARCHAR(50),
    "assigneeName" VARCHAR(100),
    "dueDate" TIMESTAMP(3),
    "estimatedHours" DECIMAL(10,2),
    "actualHours" DECIMAL(10,2),
    "progress" INTEGER DEFAULT 0,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "effort_records" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "actualTime" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "workType" VARCHAR(100),
    "ownerId" VARCHAR(50),
    "ownerName" VARCHAR(100),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "effort_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dingtalk_logs" (
    "reportId" VARCHAR(50) NOT NULL,
    "templateName" VARCHAR(50),
    "creatorId" VARCHAR(50),
    "creatorName" VARCHAR(100),
    "deptName" VARCHAR(100),
    "contents" TEXT,
    "createTime" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dingtalk_logs_pkey" PRIMARY KEY ("reportId")
);

-- CreateTable
CREATE TABLE "dingtalk_calendar_events" (
    "eventId" VARCHAR(100) NOT NULL,
    "title" VARCHAR(500),
    "description" TEXT,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "location" VARCHAR(200),
    "creator" VARCHAR(100),
    "attendees" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dingtalk_calendar_events_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "employee_leaves" (
    "id" TEXT NOT NULL,
    "dingtalkUserId" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "mobile" VARCHAR(20),
    "leaveTime" TIMESTAMP(3),
    "leaveReason" VARCHAR(500),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flows" (
    "id" TEXT NOT NULL,
    "groupId" VARCHAR(50) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "copyToIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "approval_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_flow_nodes" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeOrder" INTEGER NOT NULL,
    "nodeName" VARCHAR(100) NOT NULL,
    "approverType" VARCHAR(20) NOT NULL,
    "approverUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approverRoleId" TEXT,
    "managerLevel" INTEGER NOT NULL DEFAULT 1,
    "multiType" VARCHAR(20) NOT NULL DEFAULT 'or',
    "timeoutHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_flow_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_instances" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersion" INTEGER NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "formId" TEXT NOT NULL,
    "formCode" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "currentNode" INTEGER NOT NULL DEFAULT 1,
    "totalNodes" INTEGER NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "initiatorName" VARCHAR(50) NOT NULL,
    "copyToIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "approval_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_tasks" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeOrder" INTEGER NOT NULL,
    "nodeName" VARCHAR(100) NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverName" VARCHAR(50) NOT NULL,
    "approverType" VARCHAR(20) NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "comment" TEXT,
    "actionTime" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_records" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "nodeOrder" INTEGER NOT NULL,
    "nodeName" VARCHAR(100),
    "operatorId" TEXT NOT NULL,
    "operatorName" VARCHAR(50) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "result" VARCHAR(20),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeId_key" ON "users"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshToken_key" ON "sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_refreshToken_idx" ON "sessions"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_module_menu_key" ON "role_permissions"("roleId", "module", "menu");

-- CreateIndex
CREATE UNIQUE INDEX "system_configs_code_key" ON "system_configs"("code");

-- CreateIndex
CREATE INDEX "operation_logs_userId_idx" ON "operation_logs"("userId");

-- CreateIndex
CREATE INDEX "operation_logs_module_idx" ON "operation_logs"("module");

-- CreateIndex
CREATE INDEX "operation_logs_createdAt_idx" ON "operation_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "serial_number_counters_type_dateKey_key" ON "serial_number_counters"("type", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "employees_serialNumber_key" ON "employees"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_dingtalkUserId_key" ON "employees"("dingtalkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_dingtalkDeptId_key" ON "departments"("dingtalkDeptId");

-- CreateIndex
CREATE INDEX "departments_parentId_idx" ON "departments"("parentId");

-- CreateIndex
CREATE INDEX "departments_managerId_idx" ON "departments"("managerId");

-- CreateIndex
CREATE INDEX "employee_departments_employeeId_idx" ON "employee_departments"("employeeId");

-- CreateIndex
CREATE INDEX "employee_departments_departmentId_idx" ON "employee_departments"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_departments_employeeId_departmentId_key" ON "employee_departments"("employeeId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_serialNumber_key" ON "customers"("serialNumber");

-- CreateIndex
CREATE INDEX "contacts_customerId_idx" ON "contacts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_serialNumber_key" ON "opportunities"("serialNumber");

-- CreateIndex
CREATE INDEX "opportunities_customerId_idx" ON "opportunities"("customerId");

-- CreateIndex
CREATE INDEX "opportunities_contactId_idx" ON "opportunities"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_serialNumber_key" ON "sale_orders"("serialNumber");

-- CreateIndex
CREATE INDEX "sale_orders_customerId_idx" ON "sale_orders"("customerId");

-- CreateIndex
CREATE INDEX "sale_orders_opportunityId_idx" ON "sale_orders"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_serialNumber_key" ON "payments"("serialNumber");

-- CreateIndex
CREATE INDEX "payments_saleOrderId_idx" ON "payments"("saleOrderId");

-- CreateIndex
CREATE INDEX "payments_customerId_idx" ON "payments"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_serialNumber_key" ON "invoices"("serialNumber");

-- CreateIndex
CREATE INDEX "invoices_saleOrderId_idx" ON "invoices"("saleOrderId");

-- CreateIndex
CREATE INDEX "invoices_customerId_idx" ON "invoices"("customerId");

-- CreateIndex
CREATE INDEX "keep_records_customerId_idx" ON "keep_records"("customerId");

-- CreateIndex
CREATE INDEX "keep_records_contactId_idx" ON "keep_records"("contactId");

-- CreateIndex
CREATE INDEX "visit_records_customerId_idx" ON "visit_records"("customerId");

-- CreateIndex
CREATE INDEX "visit_records_contactId_idx" ON "visit_records"("contactId");

-- CreateIndex
CREATE INDEX "opportunity_products_opportunityId_idx" ON "opportunity_products"("opportunityId");

-- CreateIndex
CREATE INDEX "order_products_saleOrderId_idx" ON "order_products"("saleOrderId");

-- CreateIndex
CREATE INDEX "project_members_projectId_idx" ON "project_members"("projectId");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "work_items_projectId_idx" ON "work_items"("projectId");

-- CreateIndex
CREATE INDEX "work_items_assigneeId_idx" ON "work_items"("assigneeId");

-- CreateIndex
CREATE INDEX "effort_records_workItemId_idx" ON "effort_records"("workItemId");

-- CreateIndex
CREATE INDEX "effort_records_ownerId_idx" ON "effort_records"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "employee_leaves_dingtalkUserId_leaveTime_key" ON "employee_leaves"("dingtalkUserId", "leaveTime");

-- CreateIndex
CREATE INDEX "approval_flows_groupId_version_idx" ON "approval_flows"("groupId", "version");

-- CreateIndex
CREATE INDEX "approval_flows_eventType_status_idx" ON "approval_flows"("eventType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "approval_flow_nodes_flowId_nodeOrder_key" ON "approval_flow_nodes"("flowId", "nodeOrder");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_code_key" ON "approval_instances"("code");

-- CreateIndex
CREATE UNIQUE INDEX "approval_instances_eventType_formId_key" ON "approval_instances"("eventType", "formId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_tasks_instanceId_nodeOrder_approverId_key" ON "approval_tasks"("instanceId", "nodeOrder", "approverId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keep_records" ADD CONSTRAINT "keep_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keep_records" ADD CONSTRAINT "keep_records_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_records" ADD CONSTRAINT "visit_records_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_products" ADD CONSTRAINT "opportunity_products_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_saleOrderId_fkey" FOREIGN KEY ("saleOrderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effort_records" ADD CONSTRAINT "effort_records_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow_nodes" ADD CONSTRAINT "approval_flow_nodes_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
