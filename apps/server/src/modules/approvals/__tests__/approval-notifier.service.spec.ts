import { describe, expect, it, vi } from 'vitest';

import { ApprovalNotifier } from '../approval-notifier.service';

function makeNotifier() {
  const prisma = {
    approvalInstance: { findUnique: vi.fn() },
    approvalChangeRequest: { findFirst: vi.fn() },
    customer: { findUnique: vi.fn() },
  };
  const notificationOutbox = { deliverForInstance: vi.fn().mockResolvedValue(undefined) };
  const notifier = new ApprovalNotifier(prisma as never, {} as never, notificationOutbox as never);

  return { notifier, notificationOutbox };
}

describe('ApprovalNotifier — MQL/SQL 承接销售钉钉通知', () => {
  it('审批通过后按实例投递事务发件箱', async () => {
    const { notifier, notificationOutbox } = makeNotifier();
    await notifier.notifySalesAssignmentOnApprovedLeadStage('instance-1', {
      eventType: 'customer_tag_change',
      formId: 'change-1',
    });
    expect(notificationOutbox.deliverForInstance).toHaveBeenCalledWith('instance-1');
  });

  it('非线索标签审批不触发发件箱', async () => {
    const { notifier, notificationOutbox } = makeNotifier();
    await notifier.notifySalesAssignmentOnApprovedLeadStage('instance-1', {
      eventType: 'sale_order_change',
      formId: 'change-1',
    });
    expect(notificationOutbox.deliverForInstance).not.toHaveBeenCalled();
  });
});
