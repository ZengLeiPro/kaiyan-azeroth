import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { XiaohongshuService } from '../xiaohongshu.service';
import { XiaohongshuCronService } from '../xiaohongshu-cron.service';

function createCron(options: {
  enabled?: boolean | string;
  lookback?: number | string;
  triggerSync?: ReturnType<typeof vi.fn>;
}): {
  cron: XiaohongshuCronService;
  configGet: ReturnType<typeof vi.fn>;
  triggerSync: ReturnType<typeof vi.fn>;
} {
  const configGet = vi.fn((key: string) => {
    if (key === 'XIAOHONGSHU_SYNC_ENABLED') return options.enabled;
    if (key === 'XIAOHONGSHU_SYNC_LOOKBACK_DAYS') return options.lookback;
    return undefined;
  });
  const triggerSync =
    options.triggerSync ?? vi.fn().mockResolvedValue({ status: 'success', runId: 'run-success' });
  const cron = new XiaohongshuCronService(
    { get: configGet } as unknown as ConfigService,
    { triggerSync } as unknown as XiaohongshuService
  );

  return { cron, configGet, triggerSync };
}

describe('XiaohongshuCronService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([false, 'false', undefined])('同步开关为 %s 时不执行', async (enabled) => {
    const { cron, triggerSync } = createCron({ enabled });

    await expect(cron.handleDailySync()).resolves.toBeUndefined();

    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('布尔开关开启时按默认 30 天窗口同步全部层级', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T13:12:16.000Z'));
    const { cron, configGet, triggerSync } = createCron({ enabled: true });
    const errorSpy = vi.spyOn(cron['logger'], 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(cron['logger'], 'warn').mockImplementation(() => undefined);

    await cron.handleDailySync();

    expect(configGet).toHaveBeenCalledWith('XIAOHONGSHU_SYNC_LOOKBACK_DAYS');
    expect(triggerSync).toHaveBeenCalledOnce();
    expect(triggerSync).toHaveBeenCalledWith(
      {
        startDate: '2026-07-22',
        endDate: '2026-08-20',
        levels: ['account', 'campaign', 'unit', 'creative', 'note'],
      },
      'cron'
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('字符串开关开启且回溯天数超过上限时限制为 30 天，并记录 failed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T13:12:16.000Z'));
    const triggerSync = vi.fn().mockResolvedValue({ status: 'failed', runId: 'run-failed' });
    const { cron } = createCron({ enabled: 'true', lookback: '99', triggerSync });
    const errorSpy = vi.spyOn(cron['logger'], 'error').mockImplementation(() => undefined);

    await expect(cron.handleDailySync()).resolves.toBeUndefined();

    expect(triggerSync).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-07-22', endDate: '2026-08-20' }),
      'cron'
    );
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('小红书定时同步失败，任务 run-failed 已记录错误');
  });

  it('回溯天数低于下限时限制为 1 天，并记录 partial', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T13:12:16.000Z'));
    const triggerSync = vi.fn().mockResolvedValue({ status: 'partial', runId: 'run-partial' });
    const { cron } = createCron({ enabled: true, lookback: 0, triggerSync });
    const warnSpy = vi.spyOn(cron['logger'], 'warn').mockImplementation(() => undefined);

    await cron.handleDailySync();

    expect(triggerSync).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-08-20', endDate: '2026-08-20' }),
      'cron'
    );
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith('小红书定时同步部分成功，任务 run-partial 已记录分片错误');
  });

  it('triggerSync 抛出异常时吞并异常并记录启动失败', async () => {
    const triggerSync = vi.fn().mockRejectedValue(new Error('upstream unavailable'));
    const { cron } = createCron({ enabled: true, lookback: 3, triggerSync });
    const errorSpy = vi.spyOn(cron['logger'], 'error').mockImplementation(() => undefined);

    await expect(cron.handleDailySync()).resolves.toBeUndefined();

    expect(triggerSync).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('小红书定时同步启动失败');
  });
});
