-- DropForeignKey
ALTER TABLE "approval_flow_nodes" DROP CONSTRAINT "approval_flow_nodes_flowId_fkey";

-- DropForeignKey
ALTER TABLE "approval_records" DROP CONSTRAINT "approval_records_instanceId_fkey";

-- DropForeignKey
ALTER TABLE "approval_tasks" DROP CONSTRAINT "approval_tasks_instanceId_fkey";

-- AddForeignKey
ALTER TABLE "approval_flow_nodes" ADD CONSTRAINT "approval_flow_nodes_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "approval_flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_records" ADD CONSTRAINT "approval_records_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "approval_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
