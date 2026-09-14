-- CreateIndex
CREATE INDEX "operation_logs_module_target_createdAt_idx" ON "operation_logs"("module", "target", "createdAt");
