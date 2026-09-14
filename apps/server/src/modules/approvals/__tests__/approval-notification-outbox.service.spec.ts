import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { DingtalkMessengerService } from '../../dingtalk-messenger/dingtalk-messenger.service';
import type { DingtalkTodoService } from '../../dingtalk-todo/dingtalk-todo.service';
import type { ApprovalDingtalkCardBuilder } from '../approval-dingtalk-card.builder';
import { ApprovalNotificationOutboxService } from '../approval-notification-outbox.service';

function buildPrisma() {
  const prisma = {
    approvalNotificationOutbox: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    approvalTask: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    notification: { create: vi.fn().mockResolvedValue({}) },
    employee: { findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
    callback(prisma)
  );
  return prisma;
}

function buildItem() {
  return {
    id: 'outbox-1',
    eventType: 'lead_assignment',
    recipientEmployeeId: 'emp-sales',
    attemptCount: 1,
    payload: {
      instanceId: 'instance-1',
      customerId: 'customer-1',
      customerName: '测试客户',
      leadStage: 'MQL',
    },
  };
}

function createService(prisma: ReturnType<typeof buildPrisma>, sendResult = true) {
  const messenger = {
    sendActionCardToUsers: vi.fn().mockResolvedValue(sendResult),
  };
  const cardBuilder = {
    buildCustomerWebUrl: vi.fn().mockReturnValue('http://localhost:5173/customers/customer-1'),
    buildPendingWebUrl: vi.fn().mockReturnValue('http://localhost:5173/approval/list'),
    buildPendingCard: vi.fn().mockResolvedValue({
      title: '待审批',
      markdown: '请审批',
      singleTitle: '查看',
      singleUrl: 'http://localhost:5173/approval/list',
    }),
  };
  const todo = { createTask: vi.fn(), completeTask: vi.fn().mockResolvedValue(true) };
  return {
    service: new ApprovalNotificationOutboxService(
      prisma as unknown as PrismaService,
      messenger as unknown as DingtalkMessengerService,
      cardBuilder as unknown as ApprovalDingtalkCardBuilder,
      todo as unknown as DingtalkTodoService
    ),
    messenger,
    todo,
  };
}

describe('ApprovalNotificationOutboxService', () => {
  it('按审批实例领取固定收件人快照并发送后记 sent', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-1' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue(buildItem());
    prisma.employee.findFirst.mockResolvedValue({
      dingtalkUserId: 'ding-sales',
      dingtalkActive: true,
    });
    const { service, messenger } = createService(prisma);

    await service.deliverForInstance('instance-1');

    expect(messenger.sendActionCardToUsers).toHaveBeenCalledWith(
      expect.objectContaining({ dingtalkUserIds: ['ding-sales'] })
    );
    expect(prisma.approvalNotificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: { status: 'sent', sentAt: expect.any(Date), lastError: null },
    });
  });

  it('发送失败保留失败台账并安排指数退避重试', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-1' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue(buildItem());
    prisma.employee.findFirst.mockResolvedValue({
      dingtalkUserId: 'ding-sales',
      dingtalkActive: true,
    });
    const { service } = createService(prisma, false);

    await service.deliverForInstance('instance-1');

    expect(prisma.approvalNotificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-1' },
      data: expect.objectContaining({
        status: 'failed',
        lastError: '钉钉工作通知未发送成功',
        nextAttemptAt: expect.any(Date),
      }),
    });
  });

  it('轮询前把中断超过十分钟的 processing 任务重新排队', async () => {
    const prisma = buildPrisma();
    const { service } = createService(prisma);

    await expect(service.deliverPending()).resolves.toBe(0);

    expect(prisma.approvalNotificationOutbox.updateMany).toHaveBeenNthCalledWith(1, {
      where: { status: 'processing', updatedAt: { lt: expect.any(Date) } },
      data: {
        status: 'failed',
        lastError: '发送进程中断，已重新排队',
        nextAttemptAt: expect.any(Date),
      },
    });
  });

  it('普通审批站内信也走同一 outbox 并记 sent', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-2' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-2',
      eventType: 'approval_notification',
      recipientEmployeeId: 'emp-approver',
      attemptCount: 1,
      payload: {
        instanceId: 'instance-1',
        title: '待我审批',
        content: '张三提交了：测试审批',
        link: '/approval/list?tab=pending&instanceId=instance-1',
      },
    });
    const { service } = createService(prisma);

    await service.deliverForInstance('instance-1');

    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: 'emp-approver',
        type: 'approval',
        title: '待我审批',
        content: '张三提交了：测试审批',
        link: '/approval/list?tab=pending&instanceId=instance-1',
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.approvalNotificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'outbox-2' },
      data: { status: 'sent', sentAt: expect.any(Date), lastError: null },
    });
  });

  it('pending 站内信重试时任务已过期则只消费 outbox，不补发旧通知', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-stale' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-stale',
      eventType: 'approval_notification',
      recipientEmployeeId: 'emp-approver',
      attemptCount: 2,
      payload: {
        instanceId: 'instance-1',
        taskId: 'task-1',
        title: '待我审批',
        content: '张三提交了：测试审批',
        link: '/approval/list?tab=pending&instanceId=instance-1',
      },
    });
    prisma.approvalTask.findFirst.mockResolvedValue(null);
    const { service } = createService(prisma);

    await service.deliverForInstance('instance-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(prisma.approvalNotificationOutbox.update).toHaveBeenLastCalledWith({
      where: { id: 'outbox-stale' },
      data: { status: 'sent', sentAt: expect.any(Date), lastError: null },
    });
  });

  it('审批钉钉卡片发送失败时保留 outbox 重试状态', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-card' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-card',
      eventType: 'approval_dingtalk_card',
      recipientEmployeeId: 'emp-approver',
      attemptCount: 1,
      payload: { instanceId: 'instance-1', taskId: 'task-1' },
    });
    prisma.approvalTask.findFirst.mockResolvedValue({
      id: 'task-1',
      approverId: 'emp-approver',
      status: 'pending',
      dingtalkTodoTaskId: null,
      dingtalkTodoSourceId: null,
      dingtalkTodoDoneAt: null,
      instance: {
        id: 'instance-1',
        title: '测试审批',
        initiatorId: 'emp-initiator',
        initiatorName: '张三',
        status: 'pending',
      },
    });
    prisma.employee.findFirst.mockResolvedValue({
      dingtalkUserId: 'ding-approver',
      dingtalkActive: true,
    });
    const { service } = createService(prisma, false);

    await service.deliverForInstance('instance-1');

    expect(prisma.approvalNotificationOutbox.update).toHaveBeenLastCalledWith({
      where: { id: 'outbox-card' },
      data: expect.objectContaining({
        status: 'failed',
        lastError: '钉钉审批卡片未发送成功',
      }),
    });
  });

  it('审批钉钉待办创建成功后回填任务并记 sent', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-todo' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-todo',
      eventType: 'approval_dingtalk_todo',
      recipientEmployeeId: 'emp-approver',
      attemptCount: 1,
      payload: { instanceId: 'instance-1', taskId: 'task-1' },
    });
    prisma.approvalTask.findFirst.mockResolvedValue({
      id: 'task-1',
      approverId: 'emp-approver',
      status: 'pending',
      dingtalkTodoTaskId: null,
      dingtalkTodoSourceId: null,
      dingtalkTodoDoneAt: null,
      instance: {
        id: 'instance-1',
        title: '测试审批',
        initiatorId: 'emp-initiator',
        initiatorName: '张三',
        status: 'pending',
      },
    });
    prisma.approvalTask.findUnique.mockResolvedValue({
      status: 'pending',
      dingtalkTodoTaskId: null,
      dingtalkTodoSourceId: null,
      dingtalkTodoDoneAt: null,
      instance: { status: 'pending' },
    });
    prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-initiator', dingtalkUnionId: 'union-init', dingtalkActive: true },
      { id: 'emp-approver', dingtalkUnionId: 'union-approver', dingtalkActive: true },
    ]);
    const { service, todo } = createService(prisma);
    todo.createTask.mockResolvedValue({ id: 'ding-todo-1' });

    await service.deliverForInstance('instance-1');

    expect(prisma.approvalTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({
        dingtalkTodoTaskId: 'ding-todo-1',
        dingtalkTodoSourceId: 'azeroth:approval-task:task-1',
      }),
    });
    expect(prisma.approvalNotificationOutbox.update).toHaveBeenLastCalledWith({
      where: { id: 'outbox-todo' },
      data: { status: 'sent', sentAt: expect.any(Date), lastError: null },
    });
  });

  it('钉钉待办外部创建期间审批已完成，仍回填并立即完成外部待办', async () => {
    const prisma = buildPrisma();
    prisma.approvalNotificationOutbox.findMany.mockResolvedValue([{ id: 'outbox-race' }]);
    prisma.approvalNotificationOutbox.findUnique.mockResolvedValue({
      id: 'outbox-race',
      eventType: 'approval_dingtalk_todo',
      recipientEmployeeId: 'emp-approver',
      attemptCount: 1,
      payload: { instanceId: 'instance-1', taskId: 'task-1' },
    });
    prisma.approvalTask.findFirst.mockResolvedValue({
      id: 'task-1',
      approverId: 'emp-approver',
      status: 'pending',
      dingtalkTodoTaskId: null,
      dingtalkTodoSourceId: null,
      dingtalkTodoDoneAt: null,
      instance: {
        id: 'instance-1',
        title: '测试审批',
        initiatorId: 'emp-initiator',
        initiatorName: '张三',
        status: 'pending',
      },
    });
    prisma.approvalTask.findUnique.mockResolvedValue({
      status: 'approved',
      dingtalkTodoTaskId: null,
      dingtalkTodoSourceId: null,
      dingtalkTodoDoneAt: null,
      instance: { status: 'approved' },
    });
    prisma.employee.findMany.mockResolvedValue([
      { id: 'emp-initiator', dingtalkUnionId: 'union-init', dingtalkActive: true },
      { id: 'emp-approver', dingtalkUnionId: 'union-approver', dingtalkActive: true },
    ]);
    const { service, todo } = createService(prisma);
    todo.createTask.mockResolvedValue({ id: 'ding-todo-race' });

    await service.deliverForInstance('instance-1');

    expect(prisma.approvalTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({ dingtalkTodoTaskId: 'ding-todo-race' }),
    });
    expect(todo.completeTask).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'ding-todo-race' })
    );
    expect(prisma.approvalTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        dingtalkTodoTaskId: 'ding-todo-race',
        dingtalkTodoDoneAt: null,
      },
      data: { dingtalkTodoDoneAt: expect.any(Date) },
    });
  });
});
