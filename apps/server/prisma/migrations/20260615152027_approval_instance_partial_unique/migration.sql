-- DropIndex
-- 历史 @@unique([eventType, formId]) 是全状态硬唯一，导致驳回/撤回后再次提单
-- 撞 P2002（同一表单的旧 rejected/withdrawn 实例仍占着 unique）。
DROP INDEX "approval_instances_eventType_formId_key";

-- CreateIndex
-- 普通 b-tree 索引保留，给 createApprovalInstance 的 findFirst 守卫加速。
CREATE INDEX "approval_instances_eventType_formId_idx" ON "approval_instances"("eventType", "formId");

-- CreateIndex
-- Partial unique：只对 status='pending' 行强制唯一，等价于"同一表单同时只能有一个进行中审批"。
-- 驳回/撤回的老实例（status in ('rejected','withdrawn')）不参与索引，允许业务方按 assertCanSubmit
-- 规则重新提单。Prisma schema 不支持 WHERE 子句的 partial unique，故 raw SQL 手写。
CREATE UNIQUE INDEX "approval_instances_eventType_formId_pending_unique"
  ON "approval_instances"("eventType", "formId")
  WHERE "status" = 'pending';
