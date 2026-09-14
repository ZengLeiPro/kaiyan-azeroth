import { Prisma } from '@prisma/client';

/**
 * 审批详情的实例级可见性：ALL 范围可查看全部有效实例；否则仅发起人、
 * 任一有效任务的审批人或抄送人可见。
 */
export function buildApprovalInstanceVisibilityWhere(
  viewerId: string,
  hasAllScope: boolean
): Prisma.ApprovalInstanceWhereInput {
  return {
    deletedAt: null,
    ...(hasAllScope
      ? {}
      : {
          OR: [
            { initiatorId: viewerId },
            {
              tasks: {
                some: { approverId: viewerId, deletedAt: null },
              },
            },
            { copyToIds: { has: viewerId } },
          ],
        }),
  };
}
