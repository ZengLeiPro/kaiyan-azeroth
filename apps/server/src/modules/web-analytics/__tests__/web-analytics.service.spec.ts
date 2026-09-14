import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { buildWebAnalyticsWhere, WebAnalyticsService } from '../web-analytics.service';

describe('WebAnalyticsService', () => {
  let prisma: MockPrismaService;
  let service: WebAnalyticsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new WebAnalyticsService(asPrismaService(prisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('getSummary 将 SQL 返回的 string/number 统一归一成 number 并计算比率', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        pv: '120',
        uv: 34,
        sessions: '50',
        consult_clicks: '8',
        consult_channel_clicks: 3,
        consult_sessions: '5',
        lead_submits: '6',
        lead_sessions: '4',
        resource_downloads: '2',
        last_event_at: new Date('2026-06-12T10:00:00.000Z'),
        title_coverage: '99.5',
        ref_host_coverage: '48.52',
        utm_source_coverage: '0.1',
        utm_campaign_coverage: '0',
        bounce_sessions: '20',
      },
    ]);

    const result = await service.getSummary({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: true,
    });

    expect(result).toMatchObject({
      pv: 120,
      uv: 34,
      sessions: 50,
      consultClicks: 8,
      consultChannelClicks: 3,
      consultSessions: 5,
      leadSubmits: 6,
      leadSessions: 4,
      resourceDownloads: 2,
      lastEventAt: '2026-06-12T10:00:00.000Z',
      dataQuality: {
        titleCoverage: 99.5,
        refHostCoverage: 48.52,
        utmSourceCoverage: 0.1,
        utmCampaignCoverage: 0,
      },
      comparison: {
        previousRange: { startDate: '2026-06-11', endDate: '2026-06-11' },
        pvChangeRate: 0,
        uvChangeRate: 0,
        sessionsChangeRate: 0,
        leadSubmitsChangeRate: 0,
      },
      sessionConversionRate: 8,
      bounceRate: 40,
    });
  });

  it('getSummary 在 sessions=0 时比率返回 0', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        pv: 0,
        uv: 0,
        sessions: 0,
        consult_clicks: 0,
        consult_channel_clicks: 0,
        consult_sessions: 0,
        lead_submits: 0,
        lead_sessions: 0,
        resource_downloads: 0,
        last_event_at: null,
        title_coverage: 0,
        ref_host_coverage: 0,
        utm_source_coverage: 0,
        utm_campaign_coverage: 0,
        bounce_sessions: 0,
      },
    ]);

    const result = await service.getSummary({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: false,
    });

    expect(result.sessionConversionRate).toBe(0);
    expect(result.bounceRate).toBe(0);
  });

  it('getFunnel 单独展示最终留资阶段', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        sessions: '100',
        consult_cta_click: '10',
        consult_modal_open: '8',
        consult_channel_click: '4',
        lead_submit: '3',
      },
    ]);

    const result = await service.getFunnel({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: false,
    });

    expect(result.stages.at(-1)).toEqual({
      key: 'lead_submit',
      label: '最终留资',
      count: 3,
      rate: 3,
      stepRate: 75,
    });
  });

  it('buildWebAnalyticsWhere 默认排除 bot', () => {
    const where = buildWebAnalyticsWhere({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: false,
    });

    expect(sqlText(where)).toContain('e.is_bot = false');
    expect(sqlText(where)).toContain('COUNT(DISTINCT travel.country) >= 3');
    expect(sqlText(where)).toContain("read100.event = 'article_read_100'");
    expect(sqlText(where)).toContain('COUNT(DISTINCT read100.path) >= 3');
  });

  it('buildWebAnalyticsWhere 显式包含 bot 时保留全部原始流量', () => {
    const where = buildWebAnalyticsWhere({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: true,
    });

    expect(sqlText(where)).not.toContain('e.is_bot = false');
    expect(sqlText(where)).not.toContain('article_read_100');
  });

  it('getSearchKeywords 解码并合并等价搜索词', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { keyword: '%E7%A4%BA%E4%BE%8B+CRM', count: '2' },
      { keyword: '示例%20CRM', count: 3 },
      { keyword: '%E0%A4%A', count: 1 },
      { keyword: '   ', count: 9 },
    ]);

    const result = await service.getSearchKeywords({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: false,
      limit: 30,
    });

    expect(result.items).toEqual([
      { keyword: '示例 CRM', count: 5 },
      { keyword: '%E0%A4%A', count: 1 },
    ]);
  });

  it('findEvents 返回分页 totalPages 且序列化 bigint/date 风险字段', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: '9223372036854775807',
          received_at: new Date('2026-06-12T01:00:00.000Z'),
          client_ts: '2026-06-12T00:59:59.000Z',
          site: 'example.com',
          event: 'pageview',
          vid: 'v1',
          sid: 's1',
          path: '/blog/test',
          page_type: 'blog_post',
          title: '测试文章',
          referrer: null,
          ref_host: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          placement: null,
          channel: null,
          label: null,
          is_bot: false,
          screen: '1440x900',
          lang: 'zh-CN',
        },
      ])
      .mockResolvedValueOnce([{ total: '61' }]);

    const result = await service.findEvents({
      startDate: '2026-06-12',
      endDate: '2026-06-12',
      includeBots: false,
      page: 2,
      pageSize: 30,
      sortOrder: 'desc',
    });

    expect(result.total).toBe(61);
    expect(result.totalPages).toBe(3);
    expect(result.items[0]).toMatchObject({
      id: '9223372036854775807',
      receivedAt: '2026-06-12T01:00:00.000Z',
      clientTs: '2026-06-12T00:59:59.000Z',
      pageType: 'blog_post',
    });
  });
});

function sqlText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.sql === 'string') return record.sql;
  if (Array.isArray(record.strings)) return record.strings.join('?');
  return JSON.stringify(record);
}
