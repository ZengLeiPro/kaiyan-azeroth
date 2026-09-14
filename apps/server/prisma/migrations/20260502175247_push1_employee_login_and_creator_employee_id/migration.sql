-- AlterTable
ALTER TABLE "approval_flow_nodes" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "approval_flows" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "approval_instances" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "approval_tasks" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "body_metrics" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_daily_logs" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_daily_meal_entries" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_daily_supplement_entries" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_foods" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_meal_slots" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_plan_supplements" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_plans" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_purchase_items" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_subjective_logs" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_supplements" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "diet_water_logs" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "effort_records" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "employee_departments" ADD COLUMN     "creatorEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "canLogin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lastLoginIp" VARCHAR(50),
ADD COLUMN     "lockUntil" TIMESTAMP(3),
ADD COLUMN     "loginFailCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loginStatus" VARCHAR(20) NOT NULL DEFAULT 'active',
ADD COLUMN     "password" VARCHAR(255),
ADD COLUMN     "updaterEmployeeId" TEXT,
ADD COLUMN     "username" VARCHAR(50);

-- AlterTable
ALTER TABLE "filter_schemes" ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "payroll_import_batches" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "payroll_periods" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "payroll_records" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "personal_access_tokens" ADD COLUMN     "creatorEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "project_members" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "project_sale_orders" ADD COLUMN     "creatorEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "project_tickets" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "system_configs" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "creatorEmployeeId" TEXT,
ADD COLUMN     "updaterEmployeeId" TEXT;

-- CreateIndex
CREATE INDEX "approval_flow_nodes_creatorEmployeeId_idx" ON "approval_flow_nodes"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "approval_flow_nodes_updaterEmployeeId_idx" ON "approval_flow_nodes"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "approval_flows_creatorEmployeeId_idx" ON "approval_flows"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "approval_flows_updaterEmployeeId_idx" ON "approval_flows"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "approval_instances_creatorEmployeeId_idx" ON "approval_instances"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "approval_instances_updaterEmployeeId_idx" ON "approval_instances"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "approval_tasks_creatorEmployeeId_idx" ON "approval_tasks"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "approval_tasks_updaterEmployeeId_idx" ON "approval_tasks"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "body_metrics_creatorEmployeeId_idx" ON "body_metrics"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "body_metrics_updaterEmployeeId_idx" ON "body_metrics"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "departments_creatorEmployeeId_idx" ON "departments"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "departments_updaterEmployeeId_idx" ON "departments"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_daily_logs_creatorEmployeeId_idx" ON "diet_daily_logs"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_daily_logs_updaterEmployeeId_idx" ON "diet_daily_logs"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_daily_meal_entries_creatorEmployeeId_idx" ON "diet_daily_meal_entries"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_daily_meal_entries_updaterEmployeeId_idx" ON "diet_daily_meal_entries"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_daily_supplement_entries_creatorEmployeeId_idx" ON "diet_daily_supplement_entries"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_daily_supplement_entries_updaterEmployeeId_idx" ON "diet_daily_supplement_entries"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_foods_creatorEmployeeId_idx" ON "diet_foods"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_foods_updaterEmployeeId_idx" ON "diet_foods"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_meal_slots_creatorEmployeeId_idx" ON "diet_meal_slots"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_meal_slots_updaterEmployeeId_idx" ON "diet_meal_slots"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_plan_supplements_creatorEmployeeId_idx" ON "diet_plan_supplements"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_plan_supplements_updaterEmployeeId_idx" ON "diet_plan_supplements"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_plans_creatorEmployeeId_idx" ON "diet_plans"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_plans_updaterEmployeeId_idx" ON "diet_plans"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_purchase_items_creatorEmployeeId_idx" ON "diet_purchase_items"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_purchase_items_updaterEmployeeId_idx" ON "diet_purchase_items"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_subjective_logs_creatorEmployeeId_idx" ON "diet_subjective_logs"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_subjective_logs_updaterEmployeeId_idx" ON "diet_subjective_logs"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_supplements_creatorEmployeeId_idx" ON "diet_supplements"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_supplements_updaterEmployeeId_idx" ON "diet_supplements"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "diet_water_logs_creatorEmployeeId_idx" ON "diet_water_logs"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "diet_water_logs_updaterEmployeeId_idx" ON "diet_water_logs"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "effort_records_creatorEmployeeId_idx" ON "effort_records"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "effort_records_updaterEmployeeId_idx" ON "effort_records"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "employee_departments_creatorEmployeeId_idx" ON "employee_departments"("creatorEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_username_key" ON "employees"("username");

-- CreateIndex
CREATE INDEX "employees_username_idx" ON "employees"("username");

-- CreateIndex
CREATE INDEX "employees_canLogin_idx" ON "employees"("canLogin");

-- CreateIndex
CREATE INDEX "employees_creatorEmployeeId_idx" ON "employees"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "employees_updaterEmployeeId_idx" ON "employees"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "filter_schemes_updaterEmployeeId_idx" ON "filter_schemes"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "notifications_creatorEmployeeId_idx" ON "notifications"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "notifications_updaterEmployeeId_idx" ON "notifications"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "payroll_import_batches_creatorEmployeeId_idx" ON "payroll_import_batches"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "payroll_import_batches_updaterEmployeeId_idx" ON "payroll_import_batches"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "payroll_periods_creatorEmployeeId_idx" ON "payroll_periods"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "payroll_periods_updaterEmployeeId_idx" ON "payroll_periods"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "payroll_records_creatorEmployeeId_idx" ON "payroll_records"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "payroll_records_updaterEmployeeId_idx" ON "payroll_records"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "personal_access_tokens_creatorEmployeeId_idx" ON "personal_access_tokens"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "project_members_creatorEmployeeId_idx" ON "project_members"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "project_members_updaterEmployeeId_idx" ON "project_members"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "project_sale_orders_creatorEmployeeId_idx" ON "project_sale_orders"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "project_tickets_creatorEmployeeId_idx" ON "project_tickets"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "project_tickets_updaterEmployeeId_idx" ON "project_tickets"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "projects_creatorEmployeeId_idx" ON "projects"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "projects_updaterEmployeeId_idx" ON "projects"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "roles_creatorEmployeeId_idx" ON "roles"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "roles_updaterEmployeeId_idx" ON "roles"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "system_configs_creatorEmployeeId_idx" ON "system_configs"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "system_configs_updaterEmployeeId_idx" ON "system_configs"("updaterEmployeeId");

-- CreateIndex
CREATE INDEX "users_creatorEmployeeId_idx" ON "users"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "users_updaterEmployeeId_idx" ON "users"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_schemes" ADD CONSTRAINT "filter_schemes_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_import_batches" ADD CONSTRAINT "payroll_import_batches_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_import_batches" ADD CONSTRAINT "payroll_import_batches_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_sale_orders" ADD CONSTRAINT "project_sale_orders_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effort_records" ADD CONSTRAINT "effort_records_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "effort_records" ADD CONSTRAINT "effort_records_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flows" ADD CONSTRAINT "approval_flows_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flows" ADD CONSTRAINT "approval_flows_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow_nodes" ADD CONSTRAINT "approval_flow_nodes_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_flow_nodes" ADD CONSTRAINT "approval_flow_nodes_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_foods" ADD CONSTRAINT "diet_foods_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_foods" ADD CONSTRAINT "diet_foods_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_supplements" ADD CONSTRAINT "diet_supplements_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_supplements" ADD CONSTRAINT "diet_supplements_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plans" ADD CONSTRAINT "diet_plans_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_meal_slots" ADD CONSTRAINT "diet_meal_slots_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_meal_slots" ADD CONSTRAINT "diet_meal_slots_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_supplements" ADD CONSTRAINT "diet_plan_supplements_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_plan_supplements" ADD CONSTRAINT "diet_plan_supplements_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_logs" ADD CONSTRAINT "diet_daily_logs_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_logs" ADD CONSTRAINT "diet_daily_logs_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_meal_entries" ADD CONSTRAINT "diet_daily_meal_entries_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_meal_entries" ADD CONSTRAINT "diet_daily_meal_entries_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_supplement_entries" ADD CONSTRAINT "diet_daily_supplement_entries_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_daily_supplement_entries" ADD CONSTRAINT "diet_daily_supplement_entries_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_water_logs" ADD CONSTRAINT "diet_water_logs_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_water_logs" ADD CONSTRAINT "diet_water_logs_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_subjective_logs" ADD CONSTRAINT "diet_subjective_logs_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_subjective_logs" ADD CONSTRAINT "diet_subjective_logs_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_purchase_items" ADD CONSTRAINT "diet_purchase_items_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_purchase_items" ADD CONSTRAINT "diet_purchase_items_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

