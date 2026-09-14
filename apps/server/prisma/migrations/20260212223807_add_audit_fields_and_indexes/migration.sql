-- AlterTable
ALTER TABLE "opportunity_products" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedBy" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "order_products" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedBy" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "approval_flow_nodes_flowId_idx" ON "approval_flow_nodes"("flowId");

-- CreateIndex
CREATE INDEX "approval_tasks_instanceId_idx" ON "approval_tasks"("instanceId");
