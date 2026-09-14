import { describe, expect, it, vi } from 'vitest';

import { enqueueApprovalPendingNotifications } from '../approval-notification-outbox.enqueue';

describe('enqueueApprovalPendingNotifications', () => {
  it('按 taskId 一次生成站内信、卡片和待办，重复流转由 createMany 去重', async () => {
    const tx = {
      approvalTask: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'task-1', approverId: 'emp-1' },
          { id: 'task-2', approverId: 'emp-2' },
          { id: 'task-3', approverId: 'emp-3' },
        ]),
      },
      approvalNotificationOutbox: {
        createMany: vi.fn().mockResolvedValue({ count: 9 }),
      },
    };

    await enqueueApprovalPendingNotifications(tx as never, {
      instanceId: 'instance-1',
      approverEmployeeIds: ['emp-1', 'emp-2', 'emp-3'],
      title: '待我审批',
      content: '张三提交了：测试审批',
      link: '/approval/list?tab=pending&instanceId=instance-1',
    });

    expect(tx.approvalTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ instanceId: 'instance-1', status: 'pending' }),
      })
    );
    expect(tx.approvalNotificationOutbox.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          dedupKey: 'approval-pending:instance-1:task-1',
          eventType: 'approval_notification',
          payload: expect.objectContaining({ taskId: 'task-1' }),
        }),
        expect.objectContaining({
          dedupKey: 'approval-dingtalk-card:instance-1:task-1',
          eventType: 'approval_dingtalk_card',
        }),
        expect.objectContaining({
          dedupKey: 'approval-dingtalk-todo:instance-1:task-1',
          eventType: 'approval_dingtalk_todo',
        }),
        expect.objectContaining({ dedupKey: 'approval-pending:instance-1:task-3' }),
      ]),
      skipDuplicates: true,
    });
  });
});
