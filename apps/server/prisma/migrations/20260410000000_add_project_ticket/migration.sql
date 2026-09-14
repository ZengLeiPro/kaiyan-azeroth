-- CreateTable
CREATE TABLE "project_tickets" (
    "id" TEXT NOT NULL,
    "ticketNo" VARCHAR(30) NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "ticketType" VARCHAR(30) NOT NULL,
    "priority" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "source" VARCHAR(200),
    "dispatcherId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "completionNote" TEXT,
    "closeNote" TEXT,
    "cancelReason" TEXT,
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_tickets_ticketNo_key" ON "project_tickets"("ticketNo");

-- CreateIndex
CREATE INDEX "project_tickets_projectId_idx" ON "project_tickets"("projectId");

-- CreateIndex
CREATE INDEX "project_tickets_dispatcherId_idx" ON "project_tickets"("dispatcherId");

-- CreateIndex
CREATE INDEX "project_tickets_assigneeId_idx" ON "project_tickets"("assigneeId");

-- CreateIndex
CREATE INDEX "project_tickets_status_idx" ON "project_tickets"("status");

-- CreateIndex
CREATE INDEX "project_tickets_createdAt_idx" ON "project_tickets"("createdAt");

-- CreateIndex
CREATE INDEX "project_tickets_dueDate_idx" ON "project_tickets"("dueDate");

-- AddForeignKey
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_dispatcherId_fkey" FOREIGN KEY ("dispatcherId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tickets" ADD CONSTRAINT "project_tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
