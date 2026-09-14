import { describe, expect, it, vi } from 'vitest';

import { ApprovalNotificationOutboxCron } from '../approval-notification-outbox.cron';
import type { ApprovalNotificationOutboxService } from '../approval-notification-outbox.service';

describe('ApprovalNotificationOutboxCron', () => {
  it('每轮委托 outbox 投递待发通知', async () => {
    const outbox = { deliverPending: vi.fn().mockResolvedValue(2) };
    const cron = new ApprovalNotificationOutboxCron(
      outbox as unknown as ApprovalNotificationOutboxService
    );

    await expect(cron.deliverPending()).resolves.toBeUndefined();
    expect(outbox.deliverPending).toHaveBeenCalledOnce();
  });

  it.each([new Error('database unavailable'), 'unknown failure'])(
    '投递异常 %s 时记录错误且不让 cron 冒泡',
    async (failure) => {
      const outbox = { deliverPending: vi.fn().mockRejectedValue(failure) };
      const cron = new ApprovalNotificationOutboxCron(
        outbox as unknown as ApprovalNotificationOutboxService
      );
      const loggerError = vi.spyOn(cron['logger'], 'error').mockImplementation(() => undefined);

      await expect(cron.deliverPending()).resolves.toBeUndefined();
      expect(loggerError).toHaveBeenCalledWith(
        `审批通知发件箱轮询失败: ${failure instanceof Error ? failure.message : String(failure)}`
      );
    }
  );
});
