import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkSyncController } from './dingtalk-sync.controller';

describe('DingtalkSyncController', () => {
  const service = {
    runLogsSync: vi.fn(),
    runCalendarSync: vi.fn(),
  };
  const controller = new DingtalkSyncController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('转发日志和日历增量同步', async () => {
    const logsResult = { success: true, message: '日志同步完成' };
    const calendarResult = { success: true, message: '日历同步完成' };
    service.runLogsSync.mockResolvedValue(logsResult);
    service.runCalendarSync.mockResolvedValue(calendarResult);

    await expect(controller.syncLogs()).resolves.toBe(logsResult);
    await expect(controller.syncCalendar()).resolves.toBe(calendarResult);
    expect(service.runLogsSync).toHaveBeenCalledOnce();
    expect(service.runCalendarSync).toHaveBeenCalledOnce();
  });
});
