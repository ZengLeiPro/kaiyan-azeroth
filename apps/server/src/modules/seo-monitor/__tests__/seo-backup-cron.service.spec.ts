import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SeoBackupCronService } from '../seo-backup-cron.service';
import { type SeoManualSyncResult, SeoMonitorService } from '../seo-monitor.service';

/**
 * SEO 兜底 cron 单元测试。
 *
 * 目标：覆盖 handleDailyBackup 的完整成功、部分失败与异常吞回分支，
 * 满足新文件覆盖率门禁（statements/functions/lines ≥ 80%、branches ≥ 60%）。
 *
 * 实现思路：基础分支 mock triggerAutomaticBackup；fetch 契约使用真实
 * SeoMonitorService（仅 mock config/fetch），不启 Nest 容器。
 */

function buildService(triggerImpl: () => Promise<SeoManualSyncResult> | Promise<never>): {
  service: SeoBackupCronService;
  triggerSpy: ReturnType<typeof vi.fn>;
} {
  const triggerSpy = vi.fn(triggerImpl);
  const seoMonitorStub = {
    triggerAutomaticBackup: triggerSpy,
  } as unknown as SeoMonitorService;
  const service = new SeoBackupCronService(seoMonitorStub);
  return { service, triggerSpy };
}

const FC_URL = 'https://seo-sync.example.test/invoke';
const TRIGGER_SECRET = 'cron-trigger-secret';

function buildFetchBackedService(status: 200 | 207 | 500): {
  service: SeoBackupCronService;
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'SEO_SYNC_FC_URL') return FC_URL;
      if (key === 'SEO_TRIGGER_SECRET') return TRIGGER_SECRET;
      return undefined;
    }),
  } as unknown as ConfigService;
  const seoMonitor = new SeoMonitorService({} as PrismaService, config);
  const payload =
    status === 500
      ? { success: false, error: 'runtime failed' }
      : {
          success: status === 200,
          report: {
            bing: { written: 3 },
            google: { written: 5 },
            clarity: { written: 7 },
            errors:
              status === 207
                ? [
                    {
                      source: 'clarity',
                      stage: 'fetch',
                      message: `partial failure: ${TRIGGER_SECRET}`,
                    },
                  ]
                : [],
            elapsedMs: 999,
          },
        };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal('fetch', fetchMock);

  return { service: new SeoBackupCronService(seoMonitor), fetchMock };
}

describe('SeoBackupCronService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('成功路径：调用 triggerAutomaticBackup 并 log 完成消息（含 Bing/Clarity 分项）', async () => {
    const { service, triggerSpy } = buildService(() =>
      Promise.resolve({
        count: 10,
        durationMs: 999,
        bingWritten: 3,
        googleWritten: 5,
        clarityWritten: 7,
        errorCount: 0,
      })
    );
    const logSpy = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined as unknown as never);
    const warnSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.handleDailyBackup()).resolves.toBeUndefined();

    expect(triggerSpy).toHaveBeenCalledOnce();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SEO daily-sync 兜底 cron 触发'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /SEO 兜底同步完成.*合计写入 10 条.*Bing 3.*Clarity 7.*耗时 999ms.*错误 0/
      )
    );
  });

  it('抛 Error 时 catch 不冒出，且 logger.error 不回显下层敏感文本', async () => {
    const sensitiveDetail = `AbortError at ${FC_URL}?access_token=url-sensitive-token: ${TRIGGER_SECRET}`;
    const { service } = buildService(() => Promise.reject(new Error(sensitiveDetail)));
    vi.spyOn(service['logger'], 'log').mockImplementation(() => undefined as unknown as never);
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    // 关键行为：不 reject（scheduler 不受影响，下次 tick 正常调度）
    await expect(service.handleDailyBackup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('SEO 兜底同步失败（不影响下次 tick）');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(sensitiveDetail);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(TRIGGER_SECRET);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('AbortError');
  });

  it('抛非 Error 类型时同样吞回并输出固定失败日志', async () => {
    const { service } = buildService(() => Promise.reject('string-error-not-instance'));
    vi.spyOn(service['logger'], 'log').mockImplementation(() => undefined as unknown as never);
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.handleDailyBackup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith('SEO 兜底同步失败（不影响下次 tick）');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('string-error-not-instance');
  });

  it('兜底 cron 使用 POST 与 header secret，且仅 HTTP 200 记录完成', async () => {
    const { service, fetchMock } = buildFetchBackedService(200);
    const logSpy = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined as unknown as never);
    const warnSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.handleDailyBackup()).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('SEO 兜底同步完成'));
    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      FC_URL,
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trigger-secret': TRIGGER_SECRET,
        },
        body: JSON.stringify({}),
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('兜底 cron 对 HTTP 207 记录脱敏的部分失败 warn，绝不记录同步完成', async () => {
    const { service, fetchMock } = buildFetchBackedService(207);
    const logSpy = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined as unknown as never);
    const warnSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.handleDailyBackup()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^SEO 兜底同步部分失败: .*错误 1$/));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('同步完成'));
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TRIGGER_SECRET);
  });

  it('兜底 cron 对非 200/207 响应记录失败但不抛出', async () => {
    const { service, fetchMock } = buildFetchBackedService(500);
    vi.spyOn(service['logger'], 'log').mockImplementation(() => undefined as unknown as never);
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.handleDailyBackup()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith('SEO 兜底同步失败（不影响下次 tick）');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('runtime failed');
  });
});
