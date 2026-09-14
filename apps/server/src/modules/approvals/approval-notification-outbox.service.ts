import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate } from '../../common/utils/audit-helper';
import { fromJsonValue } from '../../common/utils/json-type-helpers';
import { DingtalkMessengerService } from '../dingtalk-messenger/dingtalk-messenger.service';
import { DingtalkTodoService } from '../dingtalk-todo/dingtalk-todo.service';
import { ApprovalDingtalkCardBuilder } from './approval-dingtalk-card.builder';

interface LeadAssignmentPayload {
  instanceId: string;
  customerId: string;
  customerName: string;
  leadStage: 'MQL' | 'SQL';
}

interface ApprovalNotificationPayload {
  instanceId: string;
  taskId?: string;
  title: string;
  content: string;
  link: string;
}

interface ApprovalDingtalkPendingPayload {
  instanceId: string;
  taskId: string;
}

@Injectable()
export class ApprovalNotificationOutboxService {
  private readonly logger = new Logger(ApprovalNotificationOutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dingtalkMessenger: DingtalkMessengerService,
    private readonly cardBuilder: ApprovalDingtalkCardBuilder,
    private readonly dingtalkTodo: DingtalkTodoService
  ) {}

  async deliverForInstance(instanceId: string): Promise<void> {
    const items = await this.prisma.approvalNotificationOutbox.findMany({
      where: {
        OR: [
          { dedupKey: `lead-assignment:${instanceId}` },
          { dedupKey: { startsWith: `approval:${instanceId}:` } },
          { dedupKey: { startsWith: `approval-pending:${instanceId}:` } },
          { dedupKey: { startsWith: `approval-dingtalk-card:${instanceId}:` } },
          { dedupKey: { startsWith: `approval-dingtalk-todo:${instanceId}:` } },
        ],
        status: { in: ['pending', 'failed'] },
        nextAttemptAt: { lte: new Date() },
      },
      select: { id: true },
    });
    for (const item of items) await this.deliver(item.id);
  }

  async deliverPending(limit = 20): Promise<number> {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
    await this.prisma.approvalNotificationOutbox.updateMany({
      where: { status: 'processing', updatedAt: { lt: staleBefore } },
      data: {
        status: 'failed',
        lastError: '发送进程中断，已重新排队',
        nextAttemptAt: new Date(),
      },
    });
    const items = await this.prisma.approvalNotificationOutbox.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        attemptCount: { lt: 10 },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true },
    });
    for (const item of items) await this.deliver(item.id);
    return items.length;
  }

  private async deliver(id: string): Promise<void> {
    const claimed = await this.prisma.approvalNotificationOutbox.updateMany({
      where: { id, status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: new Date() } },
      data: { status: 'processing', attemptCount: { increment: 1 } },
    });
    if (claimed.count !== 1) return;

    const item = await this.prisma.approvalNotificationOutbox.findUnique({ where: { id } });
    if (!item) return;
    try {
      if (item.eventType === 'approval_notification') {
        const payload = fromJsonValue<ApprovalNotificationPayload>(item.payload);
        if (!isApprovalNotificationPayload(payload)) throw new Error('审批通知载荷不完整');
        await this.deliverApprovalNotification(id, item.recipientEmployeeId, payload);
        return;
      } else if (
        item.eventType === 'approval_dingtalk_card' ||
        item.eventType === 'approval_dingtalk_todo'
      ) {
        const payload = fromJsonValue<ApprovalDingtalkPendingPayload>(item.payload);
        if (!isApprovalDingtalkPendingPayload(payload)) throw new Error('钉钉审批通知载荷不完整');
        await this.deliverApprovalDingtalkPending(
          item.eventType,
          item.recipientEmployeeId,
          payload
        );
      } else if (item.eventType === 'lead_assignment') {
        const payload = fromJsonValue<LeadAssignmentPayload>(item.payload);
        if (!isLeadAssignmentPayload(payload)) throw new Error('通知载荷不完整');
        const employee = await this.prisma.employee.findFirst({
          where: { id: item.recipientEmployeeId, deletedAt: null },
          select: { dingtalkUserId: true, dingtalkActive: true },
        });
        if (!employee?.dingtalkUserId || employee.dingtalkActive === false) {
          throw new Error('承接销售未绑定钉钉或已停用');
        }
        const sent = await this.dingtalkMessenger.sendActionCardToUsers({
          dingtalkUserIds: [employee.dingtalkUserId],
          title: `【线索分配】${payload.leadStage} 已通过`,
          markdown:
            `### **线索已分配给您**  \n` +
            `**客户**:${escapeDingtalkMarkdown(payload.customerName)}  \n` +
            `**线索阶段**:${payload.leadStage}  \n` +
            '**审批结果**:已通过  \n' +
            '请及时跟进。',
          singleTitle: '查看客户详情',
          singleUrl: this.cardBuilder.buildCustomerWebUrl(payload.customerId),
        });
        if (!sent) throw new Error('钉钉工作通知未发送成功');
      } else {
        throw new Error('不支持的通知类型');
      }
      await this.prisma.approvalNotificationOutbox.update({
        where: { id },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      });
    } catch (error) {
      const delayMinutes = Math.min(360, 2 ** Math.min(item.attemptCount, 8));
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.approvalNotificationOutbox.update({
        where: { id },
        data: {
          status: 'failed',
          lastError: message.slice(0, 2000),
          nextAttemptAt: new Date(Date.now() + delayMinutes * 60 * 1000),
        },
      });
      this.logger.warn(`审批通知发送失败 outboxId=${id}: ${message}`);
    }
  }

  private async deliverApprovalNotification(
    outboxId: string,
    recipientEmployeeId: string,
    payload: ApprovalNotificationPayload
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (payload.taskId) {
        // 与审批流一致，先锁实例再锁任务，保证 pending 校验与通知落库之间不可流转。
        // @prisma-raw-sql: Prisma 不支持 SELECT FOR UPDATE；需与审批流保持实例→任务锁顺序。
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "public"."approval_instances"
          WHERE "id" = ${payload.instanceId} AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        // @prisma-raw-sql: Prisma 不支持 SELECT FOR UPDATE；需锁定具体任务后原子校验并写通知。
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "public"."approval_tasks"
          WHERE "id" = ${payload.taskId} AND "deletedAt" IS NULL
          FOR UPDATE
        `;
        const task = await tx.approvalTask.findFirst({
          where: {
            id: payload.taskId,
            instanceId: payload.instanceId,
            approverId: recipientEmployeeId,
            status: 'pending',
            deletedAt: null,
            instance: { status: 'pending', deletedAt: null },
          },
          select: { id: true },
        });
        if (!task) {
          await tx.approvalNotificationOutbox.update({
            where: { id: outboxId },
            data: { status: 'sent', sentAt: new Date(), lastError: null },
          });
          return;
        }
      }

      await tx.notification.create({
        data: {
          employeeId: recipientEmployeeId,
          type: 'approval',
          title: payload.title,
          content: payload.content,
          link: payload.link,
          ...auditCreate(null),
        },
      });
      await tx.approvalNotificationOutbox.update({
        where: { id: outboxId },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      });
    });
  }

  private async deliverApprovalDingtalkPending(
    eventType: 'approval_dingtalk_card' | 'approval_dingtalk_todo',
    recipientEmployeeId: string,
    payload: ApprovalDingtalkPendingPayload
  ): Promise<void> {
    const task = await this.prisma.approvalTask.findFirst({
      where: {
        id: payload.taskId,
        instanceId: payload.instanceId,
        approverId: recipientEmployeeId,
        deletedAt: null,
        instance: { deletedAt: null },
      },
      select: {
        id: true,
        approverId: true,
        status: true,
        dingtalkTodoTaskId: true,
        dingtalkTodoSourceId: true,
        dingtalkTodoDoneAt: true,
        instance: {
          select: {
            id: true,
            title: true,
            initiatorId: true,
            initiatorName: true,
            status: true,
          },
        },
      },
    });
    if (!task) return;

    if (eventType === 'approval_dingtalk_card') {
      // 重试时审批已流转，旧节点卡片不再有意义，直接消费。
      if (task.status !== 'pending' || task.instance.status !== 'pending') return;
      const employee = await this.prisma.employee.findFirst({
        where: { id: recipientEmployeeId, deletedAt: null },
        select: { dingtalkUserId: true, dingtalkActive: true },
      });
      if (!employee?.dingtalkUserId || employee.dingtalkActive === false) {
        throw new Error('审批人未绑定 dingtalkUserId 或已停用');
      }
      const card = await this.cardBuilder.buildPendingCard({ instanceId: payload.instanceId });
      if (!card) throw new Error('无法构建审批钉钉卡片');
      const sent = await this.dingtalkMessenger.sendActionCardToUsers({
        dingtalkUserIds: [employee.dingtalkUserId],
        ...card,
      });
      if (!sent) throw new Error('钉钉审批卡片未发送成功');
      return;
    }

    const employeeIds = [task.instance.initiatorId, recipientEmployeeId];
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: employeeIds }, deletedAt: null },
      select: { id: true, dingtalkUnionId: true, dingtalkActive: true },
    });
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const initiator = employeeById.get(task.instance.initiatorId);
    const approver = employeeById.get(recipientEmployeeId);
    if (!initiator?.dingtalkUnionId || initiator.dingtalkActive === false) {
      throw new Error('审批发起人未绑定 dingtalkUnionId 或已停用');
    }
    if (!approver?.dingtalkUnionId || approver.dingtalkActive === false) {
      throw new Error('审批人未绑定 dingtalkUnionId 或已停用');
    }
    if (task.dingtalkTodoTaskId) {
      if (
        !task.dingtalkTodoDoneAt &&
        (task.status !== 'pending' || task.instance.status !== 'pending')
      ) {
        await this.completeApprovalTodo({
          taskId: task.id,
          todoTaskId: task.dingtalkTodoTaskId,
          creatorUnionId: initiator.dingtalkUnionId,
          executorUnionId: approver.dingtalkUnionId,
          subject: `待审批：${task.instance.title}`,
          description: '审批任务已处理。',
        });
      }
      return;
    }
    if (task.status !== 'pending' || task.instance.status !== 'pending') return;

    const sourceId = `azeroth:approval-task:${task.id}`;
    if (task.dingtalkTodoSourceId && task.dingtalkTodoSourceId !== sourceId) {
      throw new Error('审批任务已有不一致的钉钉待办 sourceId');
    }
    const detailUrl = this.cardBuilder.buildPendingWebUrl(task.instance.id);
    const todo = await this.dingtalkTodo.createTask({
      creatorUnionId: initiator.dingtalkUnionId,
      sourceId,
      subject: `待审批：${task.instance.title}`,
      description: `${task.instance.initiatorName} 提交了审批，请处理。`,
      executorUnionIds: [approver.dingtalkUnionId],
      detailUrl: { pcUrl: detailUrl, appUrl: detailUrl },
    });
    if (!todo?.id) throw new Error('钉钉审批待办未创建成功');
    const stored = await this.prisma.$transaction(async (tx) => {
      // @prisma-raw-sql: Prisma 不支持 SELECT FOR UPDATE；外部待办创建后需锁任务完成状态回读与回填。
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "public"."approval_tasks"
        WHERE "id" = ${task.id} AND "deletedAt" IS NULL
        FOR UPDATE
      `;
      const current = await tx.approvalTask.findUnique({
        where: { id: task.id },
        select: {
          status: true,
          dingtalkTodoTaskId: true,
          dingtalkTodoSourceId: true,
          dingtalkTodoDoneAt: true,
          instance: { select: { status: true } },
        },
      });
      if (!current) throw new Error('钉钉审批待办已创建但审批任务不存在');
      if (current.dingtalkTodoSourceId && current.dingtalkTodoSourceId !== sourceId) {
        throw new Error('审批任务已有不一致的钉钉待办 sourceId');
      }
      if (current.dingtalkTodoTaskId && current.dingtalkTodoTaskId !== todo.id) {
        throw new Error('审批任务已有不一致的钉钉待办 taskId');
      }
      if (!current.dingtalkTodoTaskId) {
        await tx.approvalTask.update({
          where: { id: task.id },
          data: {
            dingtalkTodoTaskId: todo.id,
            dingtalkTodoSourceId: sourceId,
            dingtalkTodoCreatorUnionId: initiator.dingtalkUnionId,
            dingtalkTodoCreatedAt: new Date(),
          },
        });
      }
      return {
        terminal: current.status !== 'pending' || current.instance.status !== 'pending',
        done: current.dingtalkTodoDoneAt !== null,
      };
    });
    if (stored.terminal && !stored.done) {
      await this.completeApprovalTodo({
        taskId: task.id,
        todoTaskId: todo.id,
        creatorUnionId: initiator.dingtalkUnionId,
        executorUnionId: approver.dingtalkUnionId,
        subject: `待审批：${task.instance.title}`,
        description: '审批任务已处理。',
      });
    }
  }

  private async completeApprovalTodo(input: {
    taskId: string;
    todoTaskId: string;
    creatorUnionId: string;
    executorUnionId: string;
    subject: string;
    description: string;
  }): Promise<void> {
    const completed = await this.dingtalkTodo.completeTask({
      creatorUnionId: input.creatorUnionId,
      taskId: input.todoTaskId,
      subject: input.subject,
      description: input.description,
      executorUnionIds: [input.executorUnionId],
    });
    if (!completed) throw new Error('钉钉审批待办未完成成功');
    await this.prisma.approvalTask.updateMany({
      where: {
        id: input.taskId,
        dingtalkTodoTaskId: input.todoTaskId,
        dingtalkTodoDoneAt: null,
      },
      data: { dingtalkTodoDoneAt: new Date() },
    });
  }
}

function isApprovalNotificationPayload(value: unknown): value is ApprovalNotificationPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.instanceId === 'string' &&
    (payload.taskId === undefined || typeof payload.taskId === 'string') &&
    typeof payload.title === 'string' &&
    typeof payload.content === 'string' &&
    typeof payload.link === 'string'
  );
}

function isApprovalDingtalkPendingPayload(value: unknown): value is ApprovalDingtalkPendingPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.instanceId === 'string' && typeof payload.taskId === 'string';
}

function isLeadAssignmentPayload(value: unknown): value is LeadAssignmentPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.instanceId === 'string' &&
    typeof payload.customerId === 'string' &&
    typeof payload.customerName === 'string' &&
    (payload.leadStage === 'MQL' || payload.leadStage === 'SQL')
  );
}

function escapeDingtalkMarkdown(value: string): string {
  return value.replace(/[\\[\]()*_`]/g, (match) => `\\${match}`);
}
