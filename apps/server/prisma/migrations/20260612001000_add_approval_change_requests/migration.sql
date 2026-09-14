-- CreateTable
CREATE TABLE "approval_change_requests" (
    "id" TEXT NOT NULL,
    "eventType" VARCHAR(50) NOT NULL,
    "targetType" VARCHAR(50) NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetCode" VARCHAR(100),
    "title" VARCHAR(200) NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "patch" JSONB NOT NULL,
    "beforeSnapshot" JSONB NOT NULL,
    "afterSnapshot" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approvalInstanceId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "creatorEmployeeId" TEXT,
    "updaterEmployeeId" TEXT,

    CONSTRAINT "approval_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_change_requests_approvalInstanceId_key" ON "approval_change_requests"("approvalInstanceId");

-- CreateIndex
CREATE INDEX "approval_change_requests_targetType_targetId_status_idx" ON "approval_change_requests"("targetType", "targetId", "status");

-- CreateIndex
CREATE INDEX "approval_change_requests_eventType_status_idx" ON "approval_change_requests"("eventType", "status");

-- CreateIndex
CREATE INDEX "approval_change_requests_approvalInstanceId_idx" ON "approval_change_requests"("approvalInstanceId");

-- CreateIndex
CREATE INDEX "approval_change_requests_creatorEmployeeId_idx" ON "approval_change_requests"("creatorEmployeeId");

-- CreateIndex
CREATE INDEX "approval_change_requests_updaterEmployeeId_idx" ON "approval_change_requests"("updaterEmployeeId");

-- AddForeignKey
ALTER TABLE "approval_change_requests" ADD CONSTRAINT "approval_change_requests_approvalInstanceId_fkey" FOREIGN KEY ("approvalInstanceId") REFERENCES "approval_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_change_requests" ADD CONSTRAINT "approval_change_requests_creatorEmployeeId_fkey" FOREIGN KEY ("creatorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_change_requests" ADD CONSTRAINT "approval_change_requests_updaterEmployeeId_fkey" FOREIGN KEY ("updaterEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
