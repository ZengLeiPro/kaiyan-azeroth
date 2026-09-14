-- CreateIndex
CREATE INDEX "approval_instances_flowId_idx" ON "approval_instances"("flowId");

-- CreateIndex
CREATE INDEX "approval_records_instanceId_idx" ON "approval_records"("instanceId");
