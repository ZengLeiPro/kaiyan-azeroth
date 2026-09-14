-- 为 Azeroth 审批任务记录对应的钉钉待办信息。
-- 字段均为可空，避免影响历史审批任务；新审批任务在钉钉待办创建成功后回填。
ALTER TABLE "approval_tasks"
  ADD COLUMN "dingtalkTodoTaskId" VARCHAR(100),
  ADD COLUMN "dingtalkTodoSourceId" VARCHAR(120),
  ADD COLUMN "dingtalkTodoCreatorUnionId" VARCHAR(50),
  ADD COLUMN "dingtalkTodoCreatedAt" TIMESTAMP(3),
  ADD COLUMN "dingtalkTodoDoneAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "approval_tasks_dingtalkTodoSourceId_key"
  ON "approval_tasks"("dingtalkTodoSourceId");

CREATE INDEX "approval_tasks_dingtalkTodoTaskId_idx"
  ON "approval_tasks"("dingtalkTodoTaskId");
