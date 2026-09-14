-- 项目新增单值 CRM 关联。旧 project_sale_orders 表暂留，避免在本次功能迁移中物理删除历史兼容数据。
ALTER TABLE "public"."projects"
  ADD COLUMN "opportunityId" TEXT,
  ADD COLUMN "saleOrderId" TEXT;

CREATE UNIQUE INDEX "projects_opportunityId_key"
  ON "public"."projects"("opportunityId");

CREATE UNIQUE INDEX "projects_saleOrderId_key"
  ON "public"."projects"("saleOrderId");

ALTER TABLE "public"."projects"
  ADD CONSTRAINT "projects_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "public"."opportunities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."projects"
  ADD CONSTRAINT "projects_saleOrderId_fkey"
  FOREIGN KEY ("saleOrderId") REFERENCES "public"."sale_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
