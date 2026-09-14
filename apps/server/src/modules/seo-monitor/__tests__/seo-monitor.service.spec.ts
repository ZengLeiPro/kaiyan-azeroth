import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import { SeoMonitorService } from '../seo-monitor.service';

const FC_URL = 'https://seo-sync.example.test/invoke';
const TRIGGER_SECRET = 'server-side-trigger-secret';

function buildFcService(): SeoMonitorService {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'SEO_SYNC_FC_URL') return FC_URL;
      if (key === 'SEO_TRIGGER_SECRET') return TRIGGER_SECRET;
      return undefined;
    }),
  } as unknown as ConfigService;
  return new SeoMonitorService({} as PrismaService, config);
}

function buildReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bing: { written: 2 },
    google: { written: 3 },
    clarity: { written: 5 },
    errors: [],
    elapsedMs: 321,
    ...overrides,
  };
}

function fcResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

function validFcResponse(status: 200 | 207): Response {
  return fcResponse(status, {
    success: status === 200,
    report: buildReport({
      errors:
        status === 207
          ? [{ source: 'bing', stage: 'fetch', message: `partial failure: ${TRIGGER_SECRET}` }]
          : [],
    }),
  });
}

describe('SeoMonitorService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('getSummary 汇总搜索平台并保留各来源明细', async () => {
    const seoSearchQuery = {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { impressions: 7, clicks: 1 },
      }),
      findMany: vi.fn().mockResolvedValue([
        { source: 'google', query: '示例科技' },
        { source: 'google', query: '钉钉服务商' },
        { source: 'bing', query: '示例科技' },
      ]),
      groupBy: vi
        .fn()
        .mockResolvedValueOnce([{ source: 'bing', _sum: { impressions: 7, clicks: 1 } }])
        .mockResolvedValueOnce([
          {
            source: 'bing',
            query: '示例科技',
            _sum: { impressions: 7 },
            _avg: { avgPosition: 9 },
          },
        ]),
    };
    const seoSearchPerformance = {
      findMany: vi.fn().mockResolvedValue([
        { source: 'google', impressions: 60, clicks: 4, avgPosition: 5 },
        { source: 'google', impressions: 40, clicks: 2, avgPosition: 7 },
      ]),
    };
    const seoPageInsight = {
      aggregate: vi.fn().mockResolvedValue({
        _sum: { sessions: 120, pageViews: 150, jsErrors: 2, rageClicks: 3 },
      }),
      count: vi.fn().mockResolvedValue(7),
    };
    const prisma = {
      seoSearchQuery,
      seoSearchPerformance,
      seoPageInsight,
    } as unknown as PrismaService;
    const config = { get: vi.fn() } as unknown as ConfigService;
    const service = new SeoMonitorService(prisma, config);

    const result = await service.getSummary({
      startDate: '2026-07-01',
      endDate: '2026-07-12',
    });

    expect(result.search).toMatchObject({
      totalImpressions: 107,
      totalClicks: 7,
      keywordCount: 2,
    });
    expect(result.search.avgCtr).toBeCloseTo(7 / 107, 5);
    expect(result.search.avgPosition).toBeCloseTo(6.01, 2);
    expect(result.searchSources).toEqual([
      {
        source: 'bing',
        totalImpressions: 7,
        totalClicks: 1,
        keywordCount: 1,
      },
      {
        source: 'google',
        totalImpressions: 100,
        totalClicks: 6,
        keywordCount: 2,
      },
    ]);
    expect(result.clarity).toEqual({
      totalSessions: 120,
      totalPageViews: 150,
      totalJsErrors: 2,
      totalRageClicks: 3,
      siteDays: 7,
    });
  });

  it('getSearchTrend 用 Google site 行补齐按日总量', async () => {
    const prisma = {
      seoSearchQuery: {
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([
            { statDate: new Date('2026-07-01T00:00:00.000Z'), _sum: { impressions: 5, clicks: 1 } },
          ])
          .mockResolvedValueOnce([
            {
              statDate: new Date('2026-07-01T00:00:00.000Z'),
              query: 'bing query',
              _sum: { impressions: 5 },
              _avg: { avgPosition: 10 },
            },
          ]),
      },
      seoSearchPerformance: {
        findMany: vi.fn().mockResolvedValue([
          {
            statDate: new Date('2026-07-01T00:00:00.000Z'),
            impressions: 95,
            clicks: 4,
            avgPosition: 6,
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new SeoMonitorService(prisma, { get: vi.fn() } as unknown as ConfigService);

    const result = await service.getSearchTrend({
      startDate: '2026-07-01',
      endDate: '2026-07-01',
    });

    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ impressions: 100, clicks: 5, ctr: 0.05 });
    expect(result.points[0]?.avgPosition).toBeCloseTo(6.2, 2);
  });

  it('getSearchRanking 的 page 维度读取 GSC 页面表现而非 Clarity 会话', async () => {
    const prisma = {
      seoSearchPerformance: {
        groupBy: vi.fn().mockResolvedValue([
          {
            dimensionValue: 'https://www.example.com/blog/test/',
            _sum: { impressions: 120, clicks: 6 },
            _avg: { avgPosition: 7.5 },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new SeoMonitorService(prisma, { get: vi.fn() } as unknown as ConfigService);

    const result = await service.getSearchRanking({
      startDate: '2026-07-01',
      endDate: '2026-07-30',
      dim: 'page',
      limit: 15,
    });

    expect(result.items).toEqual([
      {
        id: 'https://www.example.com/blog/test/',
        name: 'https://www.example.com/blog/test/',
        value: 120,
        hint: '点击 6 · 平均排名 7.50',
      },
    ]);
  });

  it('triggerManualSync 使用 POST 与 header secret，并解析 HTTP 200 报告', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(validFcResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const service = buildFcService();
    const logSpy = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined as unknown as never);
    const warnSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.triggerManualSync()).resolves.toEqual({
      count: 10,
      durationMs: 321,
      bingWritten: 2,
      googleWritten: 3,
      clarityWritten: 5,
      errorCount: 0,
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[manual] 同步完成'));
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

  it('triggerManualSync 对 HTTP 207 记录脱敏的部分失败 warn，绝不记录同步完成', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(validFcResponse(207));
    vi.stubGlobal('fetch', fetchMock);
    const service = buildFcService();
    const logSpy = vi
      .spyOn(service['logger'], 'log')
      .mockImplementation(() => undefined as unknown as never);
    const warnSpy = vi
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined as unknown as never);

    await expect(service.triggerManualSync()).resolves.toEqual({
      count: 10,
      durationMs: 321,
      bingWritten: 2,
      googleWritten: 3,
      clarityWritten: 5,
      errorCount: 1,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[manual\] 同步部分失败: .*错误 1$/)
    );
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('同步完成'));
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TRIGGER_SECRET);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fetch 被 4 分钟计时器中止时返回固定脱敏的 504', async () => {
    vi.useFakeTimers();
    const abortDetail = `AbortError from ${FC_URL}?access_token=url-sensitive-token: ${TRIGGER_SECRET}`;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error(abortDetail);
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = buildFcService();
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    const syncRequest = service.triggerManualSync().catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    const error = await syncRequest;

    expect(error).toBeInstanceOf(GatewayTimeoutException);
    expect((error as GatewayTimeoutException).getStatus()).toBe(504);
    expect((error as Error).message).toBe('调用 SEO 同步 FC 超时，请稍后重试');
    const emittedText = JSON.stringify([(error as Error).message, errorSpy.mock.calls]);
    expect(emittedText).not.toContain(TRIGGER_SECRET);
    expect(emittedText).not.toContain('url-sensitive-token');
    expect(emittedText).not.toContain('AbortError');
  });

  it('普通网络错误维持固定脱敏的 502', async () => {
    const networkDetail = `fetch failed at ${FC_URL}?signature=url-sensitive-signature: ${TRIGGER_SECRET}`;
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error(networkDetail));
    vi.stubGlobal('fetch', fetchMock);
    const service = buildFcService();
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    const error = await service.triggerManualSync().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as BadGatewayException).getStatus()).toBe(502);
    expect((error as Error).message).toBe('调用 SEO 同步 FC 失败');
    const emittedText = JSON.stringify([(error as Error).message, errorSpy.mock.calls]);
    expect(emittedText).not.toContain(TRIGGER_SECRET);
    expect(emittedText).not.toContain('url-sensitive-signature');
    expect(emittedText).not.toContain(networkDetail);
  });

  it('HTTP 200 允许来源报告为显式 null，并按 0 条处理', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(200, {
        success: true,
        report: buildReport({ bing: null }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).resolves.toMatchObject({
      count: 8,
      bingWritten: 0,
      errorCount: 0,
    });
  });

  it('HTTP 200 即使 body success=false 也拒绝，不能静默返回 0 条成功', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fcResponse(200, { success: false, error: 'runtime failed' }));
    vi.stubGlobal('fetch', fetchMock);

    const syncRequest = buildFcService().triggerManualSync();
    await expect(syncRequest).rejects.toBeInstanceOf(BadGatewayException);
    await expect(syncRequest).rejects.toThrow('success 必须为 true');
  });

  it('HTTP 200 缺少 report 时拒绝', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(fcResponse(200, { success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('HTTP 200 的 report.errors 非空时拒绝', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(200, {
        success: true,
        report: buildReport({
          errors: [{ source: 'bing', stage: 'fetch', message: 'unexpected error' }],
        }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toThrow(
      '完整成功不得包含 report.errors'
    );
  });

  it.each([
    ['负数', -1],
    ['NaN', Number.NaN],
    ['字符串', '2'],
  ])('HTTP 200 的 written 为%s时拒绝', async (_label, written) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(200, {
        success: true,
        report: buildReport({ bing: { written } }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('HTTP 200 的 elapsedMs 不是合法计数时拒绝', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(200, {
        success: true,
        report: buildReport({ elapsedMs: '321' }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('HTTP 207 的 report.errors 为空时拒绝', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(207, {
        success: false,
        report: buildReport(),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toThrow(
      '部分失败必须包含非空 report.errors'
    );
  });

  it('HTTP 207 的 success=true 与部分失败状态矛盾时拒绝', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(207, {
        success: true,
        report: buildReport({
          errors: [{ source: 'bing', stage: 'fetch', message: 'partial failure' }],
        }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toThrow('success 必须为 false');
  });

  it('HTTP 207 的 errors 不是合法数组时拒绝', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(207, {
        success: false,
        report: buildReport({ errors: [{ stage: 'fetch', message: 'missing source' }] }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFcService().triggerManualSync()).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('triggerManualSync 对非 200/207 响应维持 BadGatewayException', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(fcResponse(500, { success: false, error: 'upstream failed' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = buildFcService();

    const syncRequest = service.triggerManualSync();
    await expect(syncRequest).rejects.toBeInstanceOf(BadGatewayException);
    await expect(syncRequest).rejects.toThrow('SEO 同步 FC 返回异常状态（HTTP 500）');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('非 JSON 响应维持网关错误且不回显响应正文中的 secret', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(`not-json:${TRIGGER_SECRET}`, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await buildFcService()
      .triggerManualSync()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toContain('FC 返回非 JSON（HTTP 200）');
    expect((error as Error).message).not.toContain(TRIGGER_SECRET);
  });

  it('非 200/207 在读取正文前返回固定状态文案', async () => {
    const sensitiveBody =
      `not-json from ${FC_URL}?access_token=url-sensitive-token; ` +
      `header x-trigger-secret: ${TRIGGER_SECRET}`;
    const response = new Response(sensitiveBody, { status: 500 });
    const textSpy = vi.spyOn(response, 'text');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response));
    const service = buildFcService();
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    const error = await service.triggerManualSync().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toBe('SEO 同步 FC 返回异常状态（HTTP 500）');
    expect(textSpy).not.toHaveBeenCalled();
    const emittedText = JSON.stringify([(error as Error).message, errorSpy.mock.calls]);
    expect(emittedText).not.toContain(FC_URL);
    expect(emittedText).not.toContain('x-trigger-secret');
    expect(emittedText).not.toContain(TRIGGER_SECRET);
    expect(emittedText).not.toContain('url-sensitive-token');
  });

  it('非 200/207 的上游 error 不进入异常或日志', async () => {
    const upstreamDetail =
      `request to ${FC_URL}?access_token=url-sensitive-token&signature=url-sensitive-signature ` +
      `failed; header x-trigger-secret: ${TRIGGER_SECRET}`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      fcResponse(500, {
        success: false,
        error: upstreamDetail,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = buildFcService();
    const errorSpy = vi
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined as unknown as never);

    const error = await service.triggerManualSync().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BadGatewayException);
    expect((error as Error).message).toBe('SEO 同步 FC 返回异常状态（HTTP 500）');
    const emittedText = JSON.stringify([(error as Error).message, errorSpy.mock.calls]);
    expect(emittedText).not.toContain(FC_URL);
    expect(emittedText).not.toContain('x-trigger-secret');
    expect(emittedText).not.toContain(TRIGGER_SECRET);
    expect(emittedText).not.toContain('url-sensitive-token');
    expect(emittedText).not.toContain('url-sensitive-signature');
  });
});
