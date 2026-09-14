import { APPROVAL_INSTANCE_STATUS, APPROVAL_TASK_STATUS } from '@ky-azeroth/shared/constants';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { DingtalkTodoService } from '../dingtalk-todo/dingtalk-todo.service';
import { ApprovalNotificationOutboxService } from './approval-notification-outbox.service';

@Injectable()
export class ApprovalNotifier {
  private readonly logger = new Logger(ApprovalNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dingtalkTodo: DingtalkTodoService,
    private readonly notificationOutbox: ApprovalNotificationOutboxService
  ) {}

  async completeDingtalkApprovalTodosByTaskIds(taskIds: string[]): Promise<void> {
    try {
      const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
      if (uniqueTaskIds.length === 0) return;

      const tasks =
        (await this.prisma.approvalTask.findMany({
          where: {
            id: { in: uniqueTaskIds },
            dingtalkTodoTaskId: { not: null },
            dingtalkTodoDoneAt: null,
          },
          select: {
            id: true,
            dingtalkTodoTaskId: true,
            dingtalkTodoCreatorUnionId: true,
            approverId: true,
            approverName: true,
            instance: { select: { title: true } },
          },
        })) ?? [];
      if (tasks.length === 0) return;

      const approverIds = tasks.map((task) => task.approverId);
      const employees =
        (await this.prisma.employee.findMany({
          where: { id: { in: approverIds }, deletedAt: null },
          select: { id: true, dingtalkUnionId: true },
        })) ?? [];
      const unionIdByEmployeeId = new Map(employees.map((emp) => [emp.id, emp.dingtalkUnionId]));

      for (const task of tasks) {
        const creatorUnionId = task.dingtalkTodoCreatorUnionId;
        const executorUnionId = unionIdByEmployeeId.get(task.approverId);
        if (!creatorUnionId || !task.dingtalkTodoTaskId || !executorUnionId) continue;

        const ok = await this.dingtalkTodo.completeTask({
          creatorUnionId,
          taskId: task.dingtalkTodoTaskId,
          subject: `待审批：${task.instance.title}`,
          description: `${task.approverName} 的审批任务已处理。`,
          executorUnionIds: [executorUnionId],
        });
        if (!ok) continue;

        await this.prisma.approvalTask.update({
          where: { id: task.id },
          data: { dingtalkTodoDoneAt: new Date() },
        });
      }
    } catch (err) {
      this.logger.warn(
        `completeDingtalkApprovalTodosByTaskIds 异常: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async completeDingtalkApprovalTodosByInstance(instanceId: string): Promise<void> {
    try {
      const tasks =
        (await this.prisma.approvalTask.findMany({
          where: {
            instanceId,
            dingtalkTodoTaskId: { not: null },
            dingtalkTodoDoneAt: null,
          },
          select: { id: true },
        })) ?? [];
      await this.completeDingtalkApprovalTodosByTaskIds(tasks.map((task) => task.id));
    } catch (err) {
      this.logger.warn(
        `completeDingtalkApprovalTodosByInstance 异常 instanceId=${instanceId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
  async notifySalesAssignmentOnApprovedLeadStage(
    instanceId: string,
    context?: { eventType: string; formId: string }
  ): Promise<void> {
    if (context && context.eventType !== 'customer_tag_change') return;
    await this.notificationOutbox.deliverForInstance(instanceId);
  }

  async notifyOnSubmit(instanceId: string): Promise<void> {
    try {
      const instance = await this.prisma.approvalInstance.findUnique({
        where: { id: instanceId },
        select: {
          id: true,
          eventType: true,
          formId: true,
          title: true,
          initiatorId: true,
          initiatorName: true,
          copyToIds: true,
          currentNode: true,
          status: true,
          flow: {
            select: {
              nodes: { select: { nodeOrder: true, multiType: true } },
            },
          },
          tasks: {
            where: { status: APPROVAL_TASK_STATUS.PENDING },
            select: { approverId: true, nodeOrder: true, sequence: true },
          },
        },
      });
      if (!instance) return;

      // 站内信、钉钉卡片和待办都已在审批事务内入 outbox；这里只做即时投递。
      await this.notificationOutbox.deliverForInstance(instance.id);

      // 链式自动通过到终态：给发起人发"已通过"通知，不发钉钉卡片/待办；
      // 仍按原逻辑抄送 copyToIds。
      if (instance.status === APPROVAL_INSTANCE_STATUS.APPROVED) {
        await this.notifySalesAssignmentOnApprovedLeadStage(instance.id, {
          eventType: instance.eventType,
          formId: instance.formId,
        });
        return;
      }
    } catch (err) {
      this.logger.error(
        `notifyOnSubmit 失败 instanceId=${instanceId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * 审批操作后通知：
   * - reject: 通知发起人
   * - 流转下一节点: 通知下一节点应当被推送的审批人
   *   （按 pickCurrentNodeApproverIds 规则，sequence 模式只通知 sequence 最小的一组）
   * - 终态 approved: 通知发起人
   *
   * 注意：参数 `nextApproverIds` 仍保留以兼容调用方签名，但当前实现以
   * 事务后 DB 状态（currentNode + tasks）为准重新计算应推送人，避免上层
   * 误把所有 pending 审批人塞进来。
   */
  async notifyOnApprovalAction(params: {
    instance: {
      id: string;
      title: string;
      initiatorId: string;
      initiatorName: string;
      eventType: string;
      formId: string;
    };
    action: 'approve' | 'reject';
    finalStatus: string;
    nextApproverIds: string[];
    operatorName: string;
  }): Promise<void> {
    const { instance, action, finalStatus } = params;

    // 站内普通审批通知已在业务事务内写入 outbox；这里仅尝试即时投递，失败由 cron 重试。
    await this.notificationOutbox.deliverForInstance(instance.id);

    if (action === 'reject') {
      return;
    }

    // 通过分支
    if (finalStatus === APPROVAL_INSTANCE_STATUS.APPROVED) {
      return;
    }
  }
}
