import {
  APPROVAL_EVENT_TYPE,
  APPROVER_TYPE,
  MULTI_APPROVAL_TYPE,
} from '@ky-azeroth/shared/constants';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

interface DefaultFlowSpec {
  eventType: string;
  code: string;
  name: string;
  description: string;
}

const DEFAULT_FLOWS: DefaultFlowSpec[] = [
  {
    eventType: APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
    code: 'PAYMENT_APPROVE_V1',
    name: '回款审批',
    description: '默认回款审批流程，审批人为 bootstrap 审批员',
  },
  {
    eventType: APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE,
    code: 'CUSTOMER_TAG_CHANGE_V1',
    name: '客户线索阶段变更审批',
    description: '默认线索阶段变更审批流程，审批人为 bootstrap 审批员',
  },
  {
    eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
    code: 'SALE_ORDER_VOID_V1',
    name: '合同订单纠错作废审批',
    description: '默认作废审批流程，审批人为 bootstrap 审批员',
  },
];

export async function seedApprovalFlowsDefaults(prisma: PrismaClient) {
  console.log('[ApprovalFlowsDefaults] 检查默认审批流程...');

  const approver = await prisma.employee.findFirst({
    where: { username: 'approver', deletedAt: null },
    select: { id: true, name: true },
  });
  const admin = await prisma.employee.findFirst({
    where: { username: 'admin', deletedAt: null },
    select: { id: true },
  });
  if (!approver) {
    throw new Error('缺少 username=approver 的审批员，无法创建默认审批流');
  }
  if (admin && admin.id === approver.id) {
    throw new Error('审批人与管理员不能是同一人');
  }

  for (const spec of DEFAULT_FLOWS) {
    const existing = await prisma.approvalFlow.findFirst({
      where: { eventType: spec.eventType, status: { not: 'deleted' } },
      select: { id: true, status: true },
    });
    if (existing) {
      console.log(
        `  - ${spec.eventType} 流程已存在，跳过（id=${existing.id}, status=${existing.status}）`
      );
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const flow = await tx.approvalFlow.create({
        data: {
          groupId: `${spec.eventType}_${randomUUID().slice(0, 8)}`,
          code: spec.code,
          name: spec.name,
          eventType: spec.eventType,
          description: spec.description,
          copyToIds: [],
          version: 1,
          status: 'active',
        },
      });
      await tx.approvalFlowNode.create({
        data: {
          flowId: flow.id,
          nodeOrder: 1,
          nodeName: '审批节点1',
          approverType: APPROVER_TYPE.MEMBER,
          approverUserIds: [approver.id],
          managerLevel: 1,
          multiType: MULTI_APPROVAL_TYPE.OR,
        },
      });
      console.log(`  - 已创建 ${spec.eventType} 流程（id=${flow.id}，审批人=${approver.name}）`);
    });
  }

  console.log('[ApprovalFlowsDefaults] 完成');
}
