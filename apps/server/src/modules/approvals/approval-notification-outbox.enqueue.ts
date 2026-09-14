import { NOTIFICATION_TYPE } from '@ky-azeroth/shared/constants';
import type { Prisma } from '@prisma/client';

export async function enqueueApprovalNotification(
  tx: Prisma.TransactionClient,
  input: {
    instanceId: string;
    eventKey: string;
    recipientEmployeeId: string;
    title: string;
    content: string;
    link: string;
  }
): Promise<void> {
  await tx.approvalNotificationOutbox.createMany({
    data: [
      {
        dedupKey: `approval:${input.instanceId}:${input.eventKey}:${input.recipientEmployeeId}`,
        eventType: 'approval_notification',
        recipientEmployeeId: input.recipientEmployeeId,
        payload: {
          instanceId: input.instanceId,
          notificationType: NOTIFICATION_TYPE.APPROVAL,
          title: input.title,
          content: input.content,
          link: input.link,
        },
      },
    ],
    skipDuplicates: true,
  });
}

export async function enqueueApprovalPendingNotifications(
  tx: Prisma.TransactionClient,
  input: {
    instanceId: string;
    approverEmployeeIds: string[];
    title: string;
    content: string;
    link: string;
  }
): Promise<void> {
  const recipientIds = Array.from(new Set(input.approverEmployeeIds.filter(Boolean)));
  if (recipientIds.length === 0) return;

  const tasks = await tx.approvalTask.findMany({
    where: {
      instanceId: input.instanceId,
      approverId: { in: recipientIds },
      status: 'pending',
      deletedAt: null,
    },
    select: { id: true, approverId: true },
  });
  if (tasks.length === 0) return;

  await tx.approvalNotificationOutbox.createMany({
    data: tasks.flatMap((task) => [
      {
        dedupKey: `approval-pending:${input.instanceId}:${task.id}`,
        eventType: 'approval_notification',
        recipientEmployeeId: task.approverId,
        payload: {
          instanceId: input.instanceId,
          taskId: task.id,
          notificationType: NOTIFICATION_TYPE.APPROVAL,
          title: input.title,
          content: input.content,
          link: input.link,
        },
      },
      {
        dedupKey: `approval-dingtalk-card:${input.instanceId}:${task.id}`,
        eventType: 'approval_dingtalk_card',
        recipientEmployeeId: task.approverId,
        payload: { instanceId: input.instanceId, taskId: task.id },
      },
      {
        dedupKey: `approval-dingtalk-todo:${input.instanceId}:${task.id}`,
        eventType: 'approval_dingtalk_todo',
        recipientEmployeeId: task.approverId,
        payload: { instanceId: input.instanceId, taskId: task.id },
      },
    ]),
    skipDuplicates: true,
  });
}
