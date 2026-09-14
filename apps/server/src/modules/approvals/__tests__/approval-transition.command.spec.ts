import { describe, expect, it } from 'vitest';

import {
  type ApprovalCurrentTask,
  resolveApprovalNodeState,
  resolveAuthorizedApprovalTasks,
} from '../approval-transition.command';

function task(
  id: string,
  status: 'pending' | 'skipped' | 'approved',
  approverId = id,
  sequence = 1
): ApprovalCurrentTask {
  return { id, status, approverId, sequence };
}

function applyApproved(tasks: ApprovalCurrentTask[], taskIds: string[]): ApprovalCurrentTask[] {
  return tasks.map((current) =>
    taskIds.includes(current.id) ? { ...current, status: 'approved' } : current
  );
}

describe('approval transition command policies', () => {
  it.each(['and', 'or', 'sequence'])(
    '管理员代为通过 %s 节点时，授权策略显式认领全部 pending tasks',
    (multiType) => {
      const tasks = [
        task('approved-1', 'approved', 'user-1', 1),
        task('pending-2', 'pending', 'user-2', 2),
        task('pending-3', 'pending', 'user-3', 3),
      ];

      expect(
        resolveAuthorizedApprovalTasks({
          operatorPolicy: 'admin',
          actorId: 'admin-1',
          action: 'approve',
          currentTasks: tasks,
          snapshotCurrentTasks: tasks,
          multiType,
        })
      ).toEqual(['pending-2', 'pending-3']);
    }
  );

  it('普通审批授权只认领本人 task，sequence 还要求队首', () => {
    const tasks = [
      task('pending-1', 'pending', 'user-1', 1),
      task('pending-2', 'pending', 'user-2', 2),
    ];

    expect(
      resolveAuthorizedApprovalTasks({
        operatorPolicy: 'assigned',
        actorId: 'user-1',
        action: 'approve',
        currentTasks: tasks,
        snapshotCurrentTasks: tasks,
        multiType: 'sequence',
      })
    ).toEqual(['pending-1']);
    expect(() =>
      resolveAuthorizedApprovalTasks({
        operatorPolicy: 'assigned',
        actorId: 'user-2',
        action: 'approve',
        currentTasks: tasks,
        snapshotCurrentTasks: tasks,
        multiType: 'sequence',
      })
    ).toThrow('当前还未轮到您审批');
  });

  it.each([
    {
      label: 'AND: approved + pending，普通末票/管理员代节点/自审批后均完成',
      multiType: 'and',
      before: [task('approved-1', 'approved'), task('pending-2', 'pending')],
      claimIds: ['pending-2'],
      complete: true,
      skipIds: [],
    },
    {
      label: 'AND: skipped + pending，即使认领剩余 task 也不得绕过全员通过',
      multiType: 'and',
      before: [task('skipped-1', 'skipped'), task('pending-2', 'pending')],
      claimIds: ['pending-2'],
      complete: false,
      skipIds: [],
    },
    {
      label: 'OR: skipped + pending，任一认领通过后完成',
      multiType: 'or',
      before: [task('skipped-1', 'skipped'), task('pending-2', 'pending')],
      claimIds: ['pending-2'],
      complete: true,
      skipIds: [],
    },
    {
      label: 'OR: approved + pending，统一判定完成并清理剩余 pending',
      multiType: 'or',
      before: [task('approved-1', 'approved'), task('pending-2', 'pending')],
      claimIds: [],
      complete: true,
      skipIds: ['pending-2'],
    },
    {
      label: 'sequence: approved + skipped + pending，队尾认领后完成',
      multiType: 'sequence',
      before: [
        task('approved-1', 'approved', 'user-1', 1),
        task('skipped-2', 'skipped', 'user-2', 2),
        task('pending-3', 'pending', 'user-3', 3),
      ],
      claimIds: ['pending-3'],
      complete: true,
      skipIds: [],
    },
    {
      label: 'sequence: approved + pending + pending，只认领队首后仍未完成',
      multiType: 'sequence',
      before: [
        task('approved-1', 'approved', 'user-1', 1),
        task('pending-2', 'pending', 'user-2', 2),
        task('pending-3', 'pending', 'user-3', 3),
      ],
      claimIds: ['pending-2'],
      complete: false,
      skipIds: [],
    },
  ])('$label', ({ multiType, before, claimIds, complete, skipIds }) => {
    // 普通、管理员和自审批都只把获授权/可代办 tasks 转成同一种“已认领”输入，
    // 随后的节点判定完全不接收 operatorPolicy。
    const state = resolveApprovalNodeState(applyApproved(before, claimIds), multiType);

    expect(state).toEqual({ nodeComplete: complete, pendingTaskIdsToSkip: skipIds });
  });
});
