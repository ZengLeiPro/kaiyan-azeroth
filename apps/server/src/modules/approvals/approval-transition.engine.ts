import {
  APPROVAL_ACTION,
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_STATUS,
  APPROVAL_RESULT,
  APPROVAL_TASK_STATUS,
} from '@ky-azeroth/shared/constants';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { ApprovalBusinessEffectDispatcher } from './approval-business-effect.dispatcher';
import { ApprovalChangeRequestsService } from './approval-change-requests.service';
import { pickCurrentNodeApproverIds } from './approval-current-approvers.helper';
import {
  enqueueApprovalNotification,
  enqueueApprovalPendingNotifications,
} from './approval-notification-outbox.enqueue';
import { lockAndValidatePendingApprovalTarget } from './approval-target-validator.helper';
import {
  type ApprovalCurrentTask,
  type ApprovalCurrentUser,
  type ApprovalTransitionCommand,
  type ApprovalTransitionResult,
  type ApprovalWithdrawCommand,
  type ApprovalWithdrawResult,
  resolveApprovalNodeState,
  resolveAuthorizedApprovalTasks,
} from './approval-transition.command';
import { ApproverResolverService } from './approver-resolver.service';

export type { ApprovalTransitionResult } from './approval-transition.command';

type TransitionInstance = Prisma.ApprovalInstanceGetPayload<{
  include: { flow: { include: { nodes: true } } };
}>;

@Injectable()
export class ApprovalTransitionEngine {
  private readonly logger = new Logger(ApprovalTransitionEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly approverResolver: ApproverResolverService,
    private readonly approvalChangeRequests: ApprovalChangeRequestsService,
    private readonly businessEffects: ApprovalBusinessEffectDispatcher
  ) {}

  async execute(command: ApprovalTransitionCommand): Promise<ApprovalTransitionResult> {
    const { instanceId, dto, currentUser, operatorPolicy } = command;
    const actorId = currentUser.id;
    const snapshot = await this.prisma.approvalInstance.findUnique({
      where: { id: instanceId },
      include: {
        flow: { include: { nodes: { orderBy: { nodeOrder: 'asc' } } } },
        tasks: true,
      },
    });
    if (!snapshot || snapshot.deletedAt) {
      throw new NotFoundException('审批实例不存在');
    }
    if (snapshot.status !== APPROVAL_INSTANCE_STATUS.PENDING) {
      throw new BadRequestException('该审批已结束');
    }

    const snapshotCurrentTasks = snapshot.tasks.filter(
      (task) => task.nodeOrder === snapshot.currentNode
    );
    if (
      operatorPolicy === 'admin' &&
      !snapshotCurrentTasks.some((task) => task.status === APPROVAL_TASK_STATUS.PENDING)
    ) {
      throw new BadRequestException('当前节点没有待审批的任务');
    }

    const operatorInfo = await this.approverResolver.getUserInfo(actorId);
    const operatorName =
      operatorPolicy === 'admin'
        ? `${operatorInfo?.name || actorId}（管理员代审）`
        : operatorInfo?.name || actorId;

    const txResult = await this.prisma.$transaction(async (tx) => {
      await this.lockApprovalInstance(tx, instanceId);
      let instance = await tx.approvalInstance.findUnique({
        where: { id: instanceId },
        include: { flow: { include: { nodes: { orderBy: { nodeOrder: 'asc' } } } } },
      });
      if (!instance || instance.deletedAt) {
        throw new ConflictException('该审批实例已删除，请刷新后重试');
      }
      if (
        instance.status !== APPROVAL_INSTANCE_STATUS.PENDING ||
        instance.version !== snapshot.version ||
        instance.currentNode !== snapshot.currentNode
      ) {
        throw new ConflictException('该审批状态已变更，请刷新后重试');
      }

      const lockedRows = await this.lockCurrentNodeTasks(tx, instanceId, instance.currentNode);
      instance = await this.refreshStalePendingSaleOrderTargetVersion(tx, instance, currentUser);
      await this.validatePendingInstanceTarget(tx, instance, dto.action);
      const currentTasks: ApprovalCurrentTask[] = lockedRows.map((row) => {
        const metadata = snapshotCurrentTasks.find((task) => task.id === row.id);
        return {
          id: row.id,
          status: row.status,
          approverId: row.approverId ?? metadata?.approverId ?? '',
          sequence: row.sequence ?? metadata?.sequence ?? 0,
        };
      });
      const currentNode = instance.flow.nodes.find(
        (node) => node.nodeOrder === instance.currentNode
      );
      if (!currentNode) {
        throw new BadRequestException('节点配置不存在');
      }

      const claimableTaskIds = resolveAuthorizedApprovalTasks({
        operatorPolicy,
        actorId,
        action: dto.action,
        currentTasks,
        snapshotCurrentTasks,
        multiType: currentNode.multiType,
      });
      const now = new Date();

      if (dto.action === 'reject') {
        const rejectedTaskId = claimableTaskIds[0]!;
        await this.claimTasks(tx, {
          taskIds: [rejectedTaskId],
          status: APPROVAL_TASK_STATUS.REJECTED,
          comment: dto.comment,
          actionTime: now,
          currentUser,
          conflictMessage: '该审批任务已被处理，请刷新后重试',
        });
        await this.completeInstance(tx, {
          instanceId,
          expectedVersion: instance.version,
          currentNode: instance.currentNode,
          status: APPROVAL_INSTANCE_STATUS.REJECTED,
          completedAt: now,
          currentUser,
        });
        await this.writeDecisionRecord(tx, {
          instanceId,
          nodeOrder: instance.currentNode,
          nodeName: currentNode.nodeName,
          operatorId: actorId,
          operatorName,
          action: APPROVAL_ACTION.REJECT,
          result: APPROVAL_RESULT.REJECTED,
          comment: dto.comment,
        });
        await this.businessEffects.dispatchResult(
          tx,
          instance.eventType,
          instance.formId,
          instance.targetVersion,
          instance.creatorEmployeeId,
          'rejected',
          currentUser
        );
        await enqueueApprovalNotification(tx, {
          instanceId,
          eventKey: `rejected-v${instance.version}`,
          recipientEmployeeId: instance.initiatorId,
          title: '审批被驳回',
          content: `${operatorName} 驳回了：${instance.title}`,
          link: `/approval/list?tab=initiated&instanceId=${instanceId}`,
        });
        return {
          success: true as const,
          status: APPROVAL_INSTANCE_STATUS.REJECTED,
          nextApproverIds: [] as string[],
          completedTodoTaskIds: [rejectedTaskId],
          completeAllInstanceTodos: true,
        };
      }

      await this.claimTasks(tx, {
        taskIds: claimableTaskIds,
        status: APPROVAL_TASK_STATUS.APPROVED,
        comment: dto.comment,
        actionTime: now,
        currentUser,
        conflictMessage:
          operatorPolicy === 'admin'
            ? '当前节点任务已被处理，请刷新后重试'
            : '该审批任务已被处理，请刷新后重试',
      });

      const claimedTasks = currentTasks.map((task) =>
        claimableTaskIds.includes(task.id)
          ? { ...task, status: APPROVAL_TASK_STATUS.APPROVED }
          : task
      );
      const nodeState = resolveApprovalNodeState(claimedTasks, currentNode.multiType);
      await this.skipPendingTasks(tx, nodeState.pendingTaskIdsToSkip, currentUser);
      const completedTodoTaskIds =
        nodeState.nodeComplete && currentNode.multiType === 'or'
          ? currentTasks.map((task) => task.id)
          : claimableTaskIds;
      const { nodeComplete } = nodeState;

      let finalStatus: string = APPROVAL_INSTANCE_STATUS.PENDING;
      let nextApproverIds: string[] = [];
      let completeAllInstanceTodos = false;

      if (nodeComplete) {
        if (instance.currentNode >= instance.totalNodes) {
          await this.completeInstance(tx, {
            instanceId,
            expectedVersion: instance.version,
            currentNode: instance.currentNode,
            status: APPROVAL_INSTANCE_STATUS.APPROVED,
            completedAt: now,
            currentUser,
          });
          finalStatus = APPROVAL_INSTANCE_STATUS.APPROVED;
          completeAllInstanceTodos = true;
          await this.businessEffects.dispatchResult(
            tx,
            instance.eventType,
            instance.formId,
            instance.targetVersion,
            instance.creatorEmployeeId,
            'approved',
            currentUser,
            dto.sideEffects
          );
        } else {
          await this.advanceToNextNode(tx, instance, currentUser);
        }
      }

      if (finalStatus === APPROVAL_INSTANCE_STATUS.PENDING) {
        const refreshed = await this.autoPassSelfTasksAndReadState(
          tx,
          instanceId,
          instance.initiatorId,
          currentUser,
          instance.initiatorName
        );
        finalStatus = refreshed.status;
        nextApproverIds = refreshed.nextApproverIds;
        if (refreshed.status === APPROVAL_INSTANCE_STATUS.APPROVED) {
          completeAllInstanceTodos = true;
        }
      }

      await this.writeDecisionRecord(tx, {
        instanceId,
        nodeOrder: instance.currentNode,
        nodeName: currentNode.nodeName,
        operatorId: actorId,
        operatorName,
        action: APPROVAL_ACTION.APPROVE,
        result: APPROVAL_RESULT.PASSED,
        comment: dto.comment,
      });

      if (finalStatus === APPROVAL_INSTANCE_STATUS.APPROVED) {
        await enqueueApprovalNotification(tx, {
          instanceId,
          eventKey: `approved-v${instance.version}`,
          recipientEmployeeId: instance.initiatorId,
          title: '审批通过',
          content: `您发起的「${instance.title}」已审批通过`,
          link: `/approval/list?tab=initiated&instanceId=${instanceId}`,
        });
      } else {
        const approverIds = Array.from(
          new Set(nextApproverIds.filter((id) => id !== instance.initiatorId))
        );
        await enqueueApprovalPendingNotifications(tx, {
          instanceId,
          approverEmployeeIds: approverIds,
          title: '待我审批',
          content: `${instance.initiatorName} 提交了：${instance.title}`,
          link: `/approval/list?tab=pending&instanceId=${instanceId}`,
        });
      }

      return {
        success: true as const,
        status: finalStatus,
        nextApproverIds,
        completedTodoTaskIds,
        completeAllInstanceTodos,
      };
    });

    return {
      ...txResult,
      operatorName,
      instance: {
        id: snapshot.id,
        title: snapshot.title,
        initiatorId: snapshot.initiatorId,
        initiatorName: snapshot.initiatorName,
        eventType: snapshot.eventType,
        formId: snapshot.formId,
      },
    };
  }

  async withdraw(command: ApprovalWithdrawCommand): Promise<ApprovalWithdrawResult> {
    const { instanceId, currentUser, comment } = command;
    const userId = currentUser.id;
    const snapshot = await this.prisma.approvalInstance.findUnique({
      where: { id: instanceId },
      include: { tasks: true },
    });

    if (!snapshot || snapshot.deletedAt) {
      throw new NotFoundException('审批实例不存在');
    }
    if (snapshot.initiatorId !== userId) {
      throw new ForbiddenException('只有发起人可以撤回审批');
    }
    if (snapshot.status !== APPROVAL_INSTANCE_STATUS.PENDING) {
      throw new BadRequestException('该审批已结束，无法撤回');
    }
    const operatorInfo = await this.approverResolver.getUserInfo(userId);

    return this.prisma.$transaction(async (tx) => {
      await this.lockApprovalInstance(tx, instanceId);
      const instance = await tx.approvalInstance.findUnique({ where: { id: instanceId } });
      if (!instance || instance.deletedAt) {
        throw new ConflictException('该审批实例已删除，请刷新后重试');
      }
      if (instance.initiatorId !== userId) {
        throw new ForbiddenException('只有发起人可以撤回审批');
      }
      if (
        instance.status !== APPROVAL_INSTANCE_STATUS.PENDING ||
        instance.version !== snapshot.version ||
        instance.currentNode !== snapshot.currentNode
      ) {
        throw new ConflictException('该审批状态已变更，请刷新后重试');
      }

      const lockedTasks = await this.lockCurrentNodeTasks(tx, instanceId, instance.currentNode);
      await this.validatePendingInstanceTarget(tx, instance, 'withdraw');
      const now = new Date();
      const pendingTaskCount = lockedTasks.filter(
        (task) => task.status === APPROVAL_TASK_STATUS.PENDING
      ).length;
      const skipped = await tx.approvalTask.updateMany({
        where: {
          instanceId,
          nodeOrder: instance.currentNode,
          status: APPROVAL_TASK_STATUS.PENDING,
          deletedAt: null,
        },
        data: {
          status: APPROVAL_TASK_STATUS.SKIPPED,
          actionTime: now,
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      if (skipped.count !== pendingTaskCount) {
        throw new ConflictException('当前节点任务已变化，请刷新后重试');
      }

      await this.completeInstance(tx, {
        instanceId,
        expectedVersion: instance.version,
        currentNode: instance.currentNode,
        status: APPROVAL_INSTANCE_STATUS.WITHDRAWN,
        completedAt: now,
        currentUser,
      });
      await tx.approvalRecord.create({
        data: {
          instanceId,
          nodeOrder: 0,
          nodeName: null,
          operatorId: userId,
          operatorName: operatorInfo?.name || userId,
          action: APPROVAL_ACTION.WITHDRAW,
          result: APPROVAL_RESULT.WITHDRAWN,
          comment,
        },
      });
      await this.businessEffects.dispatchWithdraw(
        tx,
        instance.eventType,
        instance.formId,
        instance.targetVersion,
        instance.creatorEmployeeId,
        currentUser
      );
      return { success: true as const };
    });
  }

  private async claimTasks(
    tx: Prisma.TransactionClient,
    params: {
      taskIds: string[];
      status: string;
      comment?: string;
      actionTime: Date;
      currentUser: ApprovalCurrentUser;
      conflictMessage: string;
    }
  ): Promise<void> {
    const id = params.taskIds.length === 1 ? params.taskIds[0]! : { in: params.taskIds };
    const claimed = await tx.approvalTask.updateMany({
      where: { id, status: APPROVAL_TASK_STATUS.PENDING, deletedAt: null },
      data: {
        status: params.status,
        comment: params.comment,
        actionTime: params.actionTime,
        version: { increment: 1 },
        ...auditUpdate(params.currentUser),
      },
    });
    if (claimed.count !== params.taskIds.length) {
      throw new ConflictException(params.conflictMessage);
    }
  }

  private async completeInstance(
    tx: Prisma.TransactionClient,
    params: {
      instanceId: string;
      expectedVersion: number;
      currentNode: number;
      status: string;
      completedAt: Date;
      currentUser: ApprovalCurrentUser;
    }
  ): Promise<void> {
    const advanced = await tx.approvalInstance.updateMany({
      where: {
        id: params.instanceId,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
        version: params.expectedVersion,
        currentNode: params.currentNode,
      },
      data: {
        status: params.status,
        completedAt: params.completedAt,
        version: { increment: 1 },
        ...auditUpdate(params.currentUser),
      },
    });
    if (advanced.count !== 1) {
      throw new ConflictException('该审批状态已变更，请刷新后重试');
    }
  }

  private async advanceToNextNode(
    tx: Prisma.TransactionClient,
    instance: TransitionInstance,
    currentUser: ApprovalCurrentUser
  ): Promise<void> {
    const nextNodeOrder = instance.currentNode + 1;
    const nextNode = instance.flow.nodes.find((node) => node.nodeOrder === nextNodeOrder);
    if (!nextNode) return;
    const nextApprovers = await this.approverResolver.resolveApprovers(
      nextNode,
      instance.initiatorId
    );
    const advanced = await tx.approvalInstance.updateMany({
      where: {
        id: instance.id,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
        version: instance.version,
        currentNode: instance.currentNode,
      },
      data: {
        currentNode: nextNodeOrder,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (advanced.count !== 1) {
      throw new ConflictException('该审批状态已变更，请刷新后重试');
    }
    await tx.approvalTask.createMany({
      data: nextApprovers.map((approver) => ({
        instanceId: instance.id,
        nodeOrder: nextNodeOrder,
        nodeName: nextNode.nodeName,
        approverId: approver.approverId,
        approverName: approver.approverName,
        approverType: approver.approverType,
        sequence: approver.sequence,
        status: APPROVAL_TASK_STATUS.PENDING,
        ...auditCreate(currentUser),
      })),
    });
  }

  private async writeDecisionRecord(
    tx: Prisma.TransactionClient,
    params: {
      instanceId: string;
      nodeOrder: number;
      nodeName: string | null;
      operatorId: string;
      operatorName: string;
      action: string;
      result: string;
      comment?: string;
    }
  ): Promise<void> {
    await tx.approvalRecord.create({ data: params });
  }

  private async refreshStalePendingSaleOrderTargetVersion(
    tx: Prisma.TransactionClient,
    instance: TransitionInstance,
    currentUser: ApprovalCurrentUser
  ): Promise<TransitionInstance> {
    if (
      instance.eventType !== APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE ||
      instance.targetVersion == null
    ) {
      return instance;
    }

    const saleOrder = await tx.saleOrder.findFirst({
      where: {
        id: instance.formId,
        flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
      },
      select: { version: true },
    });
    if (!saleOrder || saleOrder.version <= instance.targetVersion) {
      return instance;
    }

    const refreshed = await tx.approvalInstance.updateMany({
      where: {
        id: instance.id,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
        version: instance.version,
        targetVersion: instance.targetVersion,
      },
      data: {
        targetVersion: saleOrder.version,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (refreshed.count !== 1) {
      throw new ConflictException('审批目标版本已变更，请刷新后重试');
    }
    return { ...instance, targetVersion: saleOrder.version, version: instance.version + 1 };
  }

  async validatePendingInstanceTarget(
    tx: Prisma.TransactionClient,
    instance: {
      eventType: string;
      formId: string;
      targetVersion: number | null;
      creatorEmployeeId: string | null;
    },
    action: 'approve' | 'reject' | 'withdraw'
  ): Promise<void> {
    if (instance.targetVersion == null) {
      throw new ConflictException('旧审批缺少业务目标版本快照，请撤回后重新发起');
    }
    const handledChangeRequest =
      action === 'approve'
        ? await this.approvalChangeRequests.validatePendingTargetForApproval(
            tx,
            instance.eventType,
            instance.formId,
            instance.targetVersion
          )
        : await this.approvalChangeRequests.validatePendingTargetSnapshot(
            tx,
            instance.eventType,
            instance.formId,
            instance.targetVersion
          );
    if (handledChangeRequest) return;
    await lockAndValidatePendingApprovalTarget(tx, {
      eventType: instance.eventType,
      formId: instance.formId,
      targetVersion: instance.targetVersion,
      initiatorEmployeeId: instance.creatorEmployeeId,
    });
  }

  async lockApprovalInstance(tx: Prisma.TransactionClient, instanceId: string): Promise<void> {
    // @prisma-raw-sql: Prisma ORM cannot express SELECT FOR UPDATE; instance lock precedes tasks.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."approval_instances"
      WHERE "id" = ${instanceId} AND "deletedAt" IS NULL
      FOR UPDATE
    `;
  }

  async lockCurrentNodeTasks(
    tx: Prisma.TransactionClient,
    instanceId: string,
    nodeOrder: number
  ): Promise<Array<{ id: string; status: string; approverId?: string; sequence?: number }>> {
    // @prisma-raw-sql: lock all current-node tasks in deterministic sequence/id order.
    return tx.$queryRaw<
      Array<{ id: string; status: string; approverId: string; sequence: number }>
    >`
      SELECT "id", "status", "approverId", "sequence"
      FROM "public"."approval_tasks"
      WHERE "instanceId" = ${instanceId} AND "nodeOrder" = ${nodeOrder}
        AND "deletedAt" IS NULL
      ORDER BY "sequence" ASC, "id" ASC
      FOR UPDATE
    `;
  }

  private async skipPendingTasks(
    tx: Prisma.TransactionClient,
    taskIds: string[],
    currentUser: ApprovalCurrentUser
  ): Promise<void> {
    if (taskIds.length === 0) return;
    const skipped = await tx.approvalTask.updateMany({
      where: {
        id: { in: taskIds },
        status: APPROVAL_TASK_STATUS.PENDING,
        deletedAt: null,
      },
      data: {
        status: APPROVAL_TASK_STATUS.SKIPPED,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (skipped.count !== taskIds.length) {
      throw new ConflictException('当前节点任务已变化，请刷新后重试');
    }
  }

  async autoPassSelfTasksAndAdvance(
    tx: Prisma.TransactionClient,
    instanceId: string,
    initiatorId: string,
    currentUser: ApprovalCurrentUser,
    initiatorName: string
  ): Promise<void> {
    for (let guard = 0; guard < 100; guard += 1) {
      const instance = await tx.approvalInstance.findUnique({
        where: { id: instanceId },
        include: { flow: { include: { nodes: { orderBy: { nodeOrder: 'asc' } } } } },
      });
      if (!instance || instance.status !== APPROVAL_INSTANCE_STATUS.PENDING) return;

      const currentNode = instance.flow.nodes.find(
        (node) => node.nodeOrder === instance.currentNode
      );
      if (!currentNode) return;
      const allCurrentTasks = await tx.approvalTask.findMany({
        where: { instanceId, nodeOrder: instance.currentNode, deletedAt: null },
        orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
        select: { id: true, approverId: true, status: true, sequence: true },
      });
      const selfPendingTasks = allCurrentTasks.filter(
        (task) => task.approverId === initiatorId && task.status === APPROVAL_TASK_STATUS.PENDING
      );
      if (selfPendingTasks.length === 0) return;
      await this.validatePendingInstanceTarget(tx, instance, 'approve');

      const isTagChangeFinalNode =
        instance.eventType === 'customer_tag_change' && instance.currentNode >= instance.totalNodes;
      if (isTagChangeFinalNode) return;

      let autoPassTaskIds: string[];
      if (currentNode.multiType === 'or' || currentNode.multiType === 'and') {
        autoPassTaskIds = selfPendingTasks.map((task) => task.id);
      } else if (currentNode.multiType === 'sequence') {
        const queueHead = allCurrentTasks.find(
          (task) => task.status === APPROVAL_TASK_STATUS.PENDING
        );
        if (!queueHead || queueHead.approverId !== initiatorId) return;
        autoPassTaskIds = [queueHead.id];
      } else {
        return;
      }

      await this.claimAutoPassTasks(tx, autoPassTaskIds, currentUser);
      for (const _taskId of autoPassTaskIds) {
        await this.writeAutoPassRecord(
          tx,
          instanceId,
          instance.currentNode,
          currentNode.nodeName,
          initiatorId,
          initiatorName
        );
      }
      const claimedTasks = allCurrentTasks.map((task) =>
        autoPassTaskIds.includes(task.id)
          ? { ...task, status: APPROVAL_TASK_STATUS.APPROVED }
          : task
      );
      const tasksForState =
        currentNode.multiType === 'or'
          ? claimedTasks
          : await tx.approvalTask.findMany({
              where: { instanceId, nodeOrder: instance.currentNode, deletedAt: null },
              orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
              select: { id: true, status: true },
            });
      const nodeState = resolveApprovalNodeState(tasksForState, currentNode.multiType);
      await this.skipPendingTasks(tx, nodeState.pendingTaskIdsToSkip, currentUser);
      if (!nodeState.nodeComplete) return;
      if (instance.currentNode >= instance.totalNodes) {
        const advanced = await tx.approvalInstance.updateMany({
          where: {
            id: instanceId,
            version: instance.version,
            status: APPROVAL_INSTANCE_STATUS.PENDING,
            deletedAt: null,
            currentNode: instance.currentNode,
          },
          data: {
            status: APPROVAL_INSTANCE_STATUS.APPROVED,
            completedAt: new Date(),
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        if (advanced.count !== 1) {
          throw new ConflictException('自审批实例状态已变化，请刷新后重试');
        }
        await this.businessEffects.dispatchResult(
          tx,
          instance.eventType,
          instance.formId,
          instance.targetVersion,
          instance.creatorEmployeeId,
          'approved',
          currentUser
        );
        return;
      }

      await this.advanceToNextNode(tx, instance, currentUser);
    }
    this.logger.error(
      `autoPassSelfTasksAndAdvance 触达安全循环上限 instanceId=${instanceId}，可能存在逻辑死循环`
    );
  }

  private async claimAutoPassTasks(
    tx: Prisma.TransactionClient,
    taskIds: string[],
    currentUser: ApprovalCurrentUser
  ): Promise<void> {
    const claimed = await tx.approvalTask.updateMany({
      where: { id: { in: taskIds }, status: APPROVAL_TASK_STATUS.PENDING, deletedAt: null },
      data: {
        status: APPROVAL_TASK_STATUS.APPROVED,
        actionTime: null,
        comment: '申请人=审批人，系统自动通过',
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (claimed.count !== taskIds.length) {
      throw new ConflictException('自审批任务状态已变化，请刷新后重试');
    }
  }

  private async autoPassSelfTasksAndReadState(
    tx: Prisma.TransactionClient,
    instanceId: string,
    initiatorId: string,
    currentUser: ApprovalCurrentUser,
    initiatorName: string
  ): Promise<{ status: string; nextApproverIds: string[] }> {
    await this.autoPassSelfTasksAndAdvance(tx, instanceId, initiatorId, currentUser, initiatorName);
    const refreshed = await tx.approvalInstance.findUnique({
      where: { id: instanceId },
      select: {
        status: true,
        currentNode: true,
        flow: { select: { nodes: { select: { nodeOrder: true, multiType: true } } } },
        tasks: {
          where: { status: APPROVAL_TASK_STATUS.PENDING, deletedAt: null },
          select: { approverId: true, nodeOrder: true, sequence: true, status: true },
        },
      },
    });
    if (!refreshed) {
      throw new ConflictException('审批实例在节点推进后不存在，请刷新后重试');
    }
    const pendingTasks = refreshed.tasks.filter(
      (task) => task.status === APPROVAL_TASK_STATUS.PENDING
    );
    return {
      status: refreshed.status,
      nextApproverIds:
        refreshed.status === APPROVAL_INSTANCE_STATUS.PENDING
          ? Array.from(
              new Set(
                pickCurrentNodeApproverIds({
                  currentNode: refreshed.currentNode,
                  flow: refreshed.flow,
                  tasks: pendingTasks,
                })
              )
            )
          : [],
    };
  }

  private async writeAutoPassRecord(
    tx: Prisma.TransactionClient,
    instanceId: string,
    nodeOrder: number,
    nodeName: string | null,
    initiatorId: string,
    initiatorName: string
  ): Promise<void> {
    await tx.approvalRecord.create({
      data: {
        instanceId,
        nodeOrder,
        nodeName,
        operatorId: initiatorId,
        operatorName: initiatorName,
        action: APPROVAL_ACTION.AUTO_PASS,
        result: APPROVAL_RESULT.PASSED,
        comment: '申请人=审批人，系统自动通过',
      },
    });
  }
}
