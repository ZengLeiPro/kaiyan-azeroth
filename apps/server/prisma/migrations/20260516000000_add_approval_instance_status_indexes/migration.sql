-- CreateIndex
CREATE INDEX "approval_instances_status_idx" ON "approval_instances"("status");

-- CreateIndex
CREATE INDEX "approval_instances_status_createdAt_idx" ON "approval_instances"("status", "createdAt");

-- CreateIndex
CREATE INDEX "approval_instances_initiatorId_status_idx" ON "approval_instances"("initiatorId", "status");
