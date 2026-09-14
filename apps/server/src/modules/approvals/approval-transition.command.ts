import { APPROVAL_TASK_STATUS } from '@ky-azeroth/shared/constants';
import { ConflictException, ForbiddenException } from '@nestjs/common';

import { ApprovalActionDto } from './dto/approval-action.dto';

export type ApprovalCurrentUser = { id: string; employeeId?: string | null };
export type ApprovalOperatorPolicy = 'assigned' | 'admin';

export interface ApprovalTransitionCommand {
  instanceId: string;
  dto: ApprovalActionDto;
  currentUser: ApprovalCurrentUser;
  operatorPolicy: ApprovalOperatorPolicy;
}

export interface ApprovalWithdrawCommand {
  instanceId: string;
  currentUser: ApprovalCurrentUser;
  comment?: string;
}

export interface ApprovalWithdrawResult {
  success: true;
}

export interface ApprovalTransitionResult {
  success: true;
  status: string;
  nextApproverIds: string[];
  completedTodoTaskIds: string[];
  completeAllInstanceTodos: boolean;
  operatorName: string;
  instance: {
    id: string;
    title: string;
    initiatorId: string;
    initiatorName: string;
    eventType: string;
    formId: string;
  };
}

export type ApprovalCurrentTask = {
  id: string;
  status: string;
  approverId: string;
  sequence: number;
};

/**
 * 授权策略只决定本次可认领哪些 pending task。
 * 管理员“代为通过”的产品语义是代替整个节点，因此 approve 授权当前节点全部
 * pending task；认领后的完成判定和待办清理仍走统一节点状态机。
 */
export function resolveAuthorizedApprovalTasks(params: {
  operatorPolicy: ApprovalOperatorPolicy;
  actorId: string;
  action: 'approve' | 'reject';
  currentTasks: ApprovalCurrentTask[];
  snapshotCurrentTasks: { id: string; status: string; approverId: string }[];
  multiType: string;
}): string[] {
  const pendingTasks = params.currentTasks
    .filter((task) => task.status === APPROVAL_TASK_STATUS.PENDING)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));

  if (params.operatorPolicy === 'admin') {
    const pendingTask = pendingTasks[0];
    if (!pendingTask) {
      throw new ConflictException('当前节点任务已被处理，请刷新后重试');
    }
    return params.action === 'approve' ? pendingTasks.map((task) => task.id) : [pendingTask.id];
  }

  const myTask = pendingTasks.find((task) => task.approverId === params.actorId);
  if (!myTask) {
    const wasMine = params.snapshotCurrentTasks.some(
      (task) => task.approverId === params.actorId && task.status === APPROVAL_TASK_STATUS.PENDING
    );
    if (wasMine) {
      throw new ConflictException('该审批任务已被处理，请刷新后重试');
    }
    throw new ForbiddenException('您不是当前节点的审批人或已审批');
  }
  if (params.multiType === 'sequence' && pendingTasks[0]?.id !== myTask.id) {
    throw new ForbiddenException('当前还未轮到您审批');
  }
  return [myTask.id];
}

export interface ApprovalNodeState {
  nodeComplete: boolean;
  pendingTaskIdsToSkip: string[];
}

/** 认领（含自审批）后的统一节点完成判定，不感知 operatorPolicy。 */
export function resolveApprovalNodeState(
  tasks: Pick<ApprovalCurrentTask, 'id' | 'status'>[],
  multiType: string
): ApprovalNodeState {
  if (multiType === 'or') {
    const nodeComplete = tasks.some((task) => task.status === APPROVAL_TASK_STATUS.APPROVED);
    return {
      nodeComplete,
      pendingTaskIdsToSkip: nodeComplete
        ? tasks
            .filter((task) => task.status === APPROVAL_TASK_STATUS.PENDING)
            .map((task) => task.id)
        : [],
    };
  }
  if (multiType === 'and') {
    return {
      nodeComplete:
        tasks.length > 0 && tasks.every((task) => task.status === APPROVAL_TASK_STATUS.APPROVED),
      pendingTaskIdsToSkip: [],
    };
  }
  if (multiType === 'sequence') {
    return {
      nodeComplete:
        tasks.length > 0 && tasks.every((task) => task.status !== APPROVAL_TASK_STATUS.PENDING),
      pendingTaskIdsToSkip: [],
    };
  }
  return { nodeComplete: false, pendingTaskIdsToSkip: [] };
}
