-- AlterTable: Remove VarChar(36) constraint from Notification.userId
ALTER TABLE "notifications" ALTER COLUMN "userId" TYPE TEXT;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE INDEX "approval_instances_initiatorId_idx" ON "approval_instances"("initiatorId");

-- CreateIndex
CREATE INDEX "approval_tasks_approverId_idx" ON "approval_tasks"("approverId");
