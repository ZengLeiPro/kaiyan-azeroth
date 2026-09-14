import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { XiaohongshuApiClient } from '../../xiaohongshu-core';
import type { XiaohongshuManualSyncDto } from '../dto';
import { XiaohongshuService } from '../xiaohongshu.service';
import type { XiaohongshuTokenService } from '../xiaohongshu-token.service';

const { parseReportRow } = vi.hoisted(() => ({
  parseReportRow: vi.fn(
    (row: Record<string, unknown>, level: string, advertiserId: string, dataCaliber: 0 | 1) => {
      if (typeof row.time !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.time)) return null;
      return {
        statDate: new Date(`${row.time}T00:00:00.000Z`),
        level,
        entityId: advertiserId,
        entityName: typeof row.advertiser_name === 'string' ? row.advertiser_name : null,
        fee: Number(row.fee ?? 0),
        dataCaliber,
      };
    }
  ),
}));

vi.mock('../xiaohongshu-report.mapper', () => ({
  parseXiaohongshuReportRow: parseReportRow,
}));

function createService(prisma: object, api: object = {}, tokens: object = {}) {
  const advertiserDelegate = (prisma as { xiaohongshuAdvertiser?: Record<string, unknown> })
    .xiaohongshuAdvertiser;
  Object.assign(prisma, {
    xiaohongshuAdvertiser: {
      findMany: vi.fn().mockResolvedValue([activeAdvertiser()]),
      ...advertiserDelegate,
    },
  });
  return new XiaohongshuService(
    prisma as PrismaService,
    api as XiaohongshuApiClient,
    tokens as XiaohongshuTokenService
  );
}

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const instant = (value: string) => new Date(value);
const nullableMetrics = [
  'landingPageVisit',
  'formImpression',
  'formSubmit',
  'validFormSubmit',
  'combinedLead',
  'messageUser',
  'messageConsult',
  'messageOpen',
  'messageLead',
] as const;

function analyticsRow(
  entityId: string,
  statDate: string,
  overrides: Partial<{
    entityName: string | null;
    fee: number;
    impression: number;
    click: number;
    interaction: number;
    like: number;
    comment: number;
    collect: number;
    follow: number;
    share: number;
    landingPageVisit: number | null;
    formImpression: number | null;
    formSubmit: number | null;
    validFormSubmit: number | null;
    combinedLead: number | null;
    messageUser: number | null;
    messageConsult: number | null;
    messageOpen: number | null;
    messageLead: number | null;
    level: string;
    dataCaliber: number;
    rawPayload: Record<string, unknown>;
    advertiserAccount: { advertiserId: string; updatedAt: Date };
  }> = {}
) {
  return {
    statDate: date(statDate),
    level: overrides.level ?? 'account',
    dataCaliber: overrides.dataCaliber ?? 0,
    advertiserAccount: overrides.advertiserAccount ?? {
      advertiserId: 'adv-1',
      updatedAt: instant('2026-08-20T00:00:00.000Z'),
    },
    entityId,
    entityName: overrides.entityName ?? null,
    fee: overrides.fee ?? 0,
    impression: overrides.impression ?? 0,
    click: overrides.click ?? 0,
    interaction: overrides.interaction ?? 0,
    like: overrides.like ?? 0,
    comment: overrides.comment ?? 0,
    collect: overrides.collect ?? 0,
    follow: overrides.follow ?? 0,
    share: overrides.share ?? 0,
    landingPageVisit: overrides.landingPageVisit === undefined ? 0 : overrides.landingPageVisit,
    formImpression: overrides.formImpression === undefined ? 0 : overrides.formImpression,
    formSubmit: overrides.formSubmit === undefined ? 0 : overrides.formSubmit,
    validFormSubmit: overrides.validFormSubmit === undefined ? 0 : overrides.validFormSubmit,
    combinedLead: overrides.combinedLead === undefined ? 0 : overrides.combinedLead,
    messageUser: overrides.messageUser === undefined ? 0 : overrides.messageUser,
    messageConsult: overrides.messageConsult === undefined ? 0 : overrides.messageConsult,
    messageOpen: overrides.messageOpen === undefined ? 0 : overrides.messageOpen,
    messageLead: overrides.messageLead === undefined ? 0 : overrides.messageLead,
    rawPayload: overrides.rawPayload ?? {},
  };
}

function pagedReportPrisma(
  pages: Array<
    Array<
      Record<string, unknown> & {
        advertiserAccount: { advertiserId: string; updatedAt: Date };
      }
    >
  >,
  total: number
) {
  const queryRaw = vi.fn();
  const allRows = pages.flat();
  const fieldKeys = [
    ...new Set(
      pages.flatMap((page) =>
        page.flatMap((row) => {
          const payload = row.rawPayload;
          return payload && typeof payload === 'object' && !Array.isArray(payload)
            ? Object.keys(payload)
            : [];
        })
      )
    ),
  ].sort();
  for (const page of pages) {
    queryRaw
      .mockResolvedValueOnce(
        page.length > 0
          ? page.map((row) => ({ id: row.id as string, total }))
          : [{ id: null, total }]
      )
      .mockResolvedValueOnce(fieldKeys.map((key) => ({ key })));
  }
  const findMany = vi.fn().mockImplementation(({ where }) => {
    const ids = new Set(where.id.in as string[]);
    return Promise.resolve(allRows.filter((row) => ids.has(row.id as string)));
  });
  return {
    $queryRaw: queryRaw,
    xiaohongshuDailyReport: { findMany },
  };
}

function activeAdvertiser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'db-adv',
    advertiserId: 'adv-1',
    advertiserName: '品牌一',
    connectionId: 'connection-1',
    status: 'active',
    createdAt: instant('2026-08-01T00:00:00.000Z'),
    updatedAt: instant('2026-08-20T00:00:00.000Z'),
    ...overrides,
  };
}

function syncRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    status: 'success',
    startDate: date('2026-08-01'),
    endDate: date('2026-08-02'),
    levels: ['account', 1, 'campaign'],
    advertiserIds: ['adv-1'],
    syncedRows: 3,
    errors: [],
    counts: { 'adv-1:account:0': 3, bad: 'ignored', infinity: Number.POSITIVE_INFINITY },
    report: { shardCount: 2, succeeded: 2, failed: 0 },
    startedAt: instant('2026-08-21T01:00:00.000Z'),
    finishedAt: instant('2026-08-21T01:01:00.000Z'),
    createdAt: instant('2026-08-21T01:00:00.000Z'),
    updatedAt: instant('2026-08-21T01:01:00.000Z'),
    ...overrides,
  };
}

describe('XiaohongshuService', () => {
  beforeEach(() => {
    parseReportRow.mockClear();
  });

  it('映射最新连接且不存在连接时返回 null', async () => {
    const row = {
      id: 'connection-1',
      status: 'active',
      scopes: ['report', 1, 'advertiser'],
      accessTokenExpiresAt: instant('2026-09-01T00:00:00.000Z'),
      lastSyncedAt: instant('2026-08-20T12:00:00.000Z'),
      lastError: null,
      createdAt: instant('2026-08-01T00:00:00.000Z'),
      updatedAt: instant('2026-08-20T12:00:00.000Z'),
    };
    const findFirst = vi.fn().mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    const service = createService({ xiaohongshuConnection: { findFirst } });

    await expect(service.getConnection()).resolves.toEqual({
      id: 'connection-1',
      status: 'active',
      scopes: ['report', 'advertiser'],
      expiresAt: '2026-09-01T00:00:00.000Z',
      lastSyncedAt: '2026-08-20T12:00:00.000Z',
      errorMessage: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-20T12:00:00.000Z',
    });
    await expect(service.getConnection()).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  });

  it('getAdvertisers 仅查询活跃连接并按 advertiserId 取最新后排序', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        activeAdvertiser(),
        activeAdvertiser({ connectionId: 'old', updatedAt: instant('2026-08-01T00:00:00.000Z') }),
        activeAdvertiser({ advertiserId: 'adv-2', advertiserName: '品牌二' }),
      ]);
    const service = createService({ xiaohongshuAdvertiser: { findMany } });

    const result = await service.getAdvertisers();

    expect(result).toHaveLength(2);
    expect(result.find((item) => item.advertiserId === 'adv-1')?.connectionId).toBe('connection-1');
    expect(findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        status: 'active',
        connection: { deletedAt: null, status: 'active' },
      },
      orderBy: { updatedAt: 'desc' },
    });
  });

  it('日报在数据库中跨连接去重后分页，并保持索引顺序', async () => {
    const reportRow = (overrides: Record<string, unknown>) => ({
      id: 'report-1',
      statDate: date('2026-08-20'),
      advertiserAccount: {
        advertiserId: 'adv-1',
        advertiserName: '品牌一',
        updatedAt: instant('2026-08-20T00:00:00.000Z'),
      },
      level: 'campaign',
      entityId: 'campaign-1',
      dataCaliber: 1,
      campaignId: 'campaign-1',
      campaignName: '计划一',
      unitId: null,
      unitName: null,
      creativeId: null,
      creativeName: null,
      fee: 20,
      impression: 100,
      click: 5,
      interaction: 10,
      like: 8,
      comment: 4,
      collect: 6,
      follow: 2,
      share: 1,
      landingPageVisit: 4,
      formImpression: 4,
      formSubmit: 3,
      validFormSubmit: 2,
      combinedLead: null,
      messageUser: null,
      messageConsult: 4,
      messageOpen: 2,
      messageLead: 1,
      rawPayload: {},
      createdAt: instant('2026-08-20T01:00:00.000Z'),
      updatedAt: instant('2026-08-20T02:00:00.000Z'),
      ...overrides,
    });
    const oldAccount = {
      advertiserId: 'adv-1',
      advertiserName: '品牌一',
      updatedAt: instant('2026-07-01T00:00:00.000Z'),
    };
    const oldEarly = reportRow({
      id: 'report-old-early',
      statDate: date('2026-07-15'),
      fee: 10,
      rawPayload: { old_only: true },
      advertiserAccount: oldAccount,
    });
    const newOverlap = reportRow({ id: 'report-new-overlap', rawPayload: { new_only: true } });
    const reportPrisma = pagedReportPrisma([[newOverlap], [oldEarly]], 2);
    const service = createService(reportPrisma);

    const query = {
      level: 'campaign' as const,
      startDate: '2026-07-01',
      endDate: '2026-08-20',
      advertiserId: 'adv-1',
      dataCaliber: 1 as const,
      page: 1,
      pageSize: 1,
      sortOrder: 'desc' as const,
    };
    const result = await service.getReports(query);
    const secondPage = await service.getReports({ ...query, page: 2 });

    expect(result).toEqual(
      expect.objectContaining({
        dataCaliber: 1,
        total: 2,
        totalPages: 2,
        items: [
          expect.objectContaining({
            id: 'report-new-overlap',
            fee: 20,
            cpm: 200,
            cpi: 2,
            messageConsultRate: 0.8,
            formSubmitCost: 20 / 3,
          }),
        ],
      })
    );
    expect(secondPage.items).toEqual([
      expect.objectContaining({ id: 'report-old-early', statDate: '2026-07-15', fee: 10 }),
    ]);
    expect(result.rawFieldKeys).toEqual(['new_only', 'old_only']);
    expect(secondPage.rawFieldKeys).toEqual(['new_only', 'old_only']);
    expect(reportPrisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(reportPrisma.xiaohongshuDailyReport.findMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ['report-new-overlap'] } },
      include: { advertiserAccount: true },
    });
  });

  it('日报空指标返回 null 且省略可选筛选条件', async () => {
    const row = {
      id: 'report-null',
      statDate: date('2026-08-20'),
      advertiserAccount: {
        advertiserId: 'adv-1',
        advertiserName: '品牌一',
        updatedAt: instant('2026-08-20T00:00:00.000Z'),
      },
      level: 'account',
      entityId: 'adv-1',
      dataCaliber: 0,
      campaignId: null,
      campaignName: null,
      unitId: null,
      unitName: null,
      creativeId: null,
      creativeName: null,
      fee: 0,
      impression: 0,
      click: 0,
      interaction: 0,
      like: 0,
      comment: 0,
      collect: 0,
      follow: 0,
      share: 0,
      landingPageVisit: null,
      formImpression: null,
      formSubmit: null,
      validFormSubmit: null,
      combinedLead: null,
      messageUser: null,
      messageConsult: null,
      messageOpen: null,
      messageLead: null,
      createdAt: instant('2026-08-20T01:00:00.000Z'),
      updatedAt: instant('2026-08-20T01:00:00.000Z'),
    };
    const reportPrisma = pagedReportPrisma([[row]], 1);
    const service = createService(reportPrisma);

    const result = await service.getReports({
      dataCaliber: 0,
      page: 1,
      pageSize: 20,
      sortOrder: 'asc',
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        ctr: null,
        cpc: null,
        cpm: null,
        cpi: null,
        interactionRate: null,
        formSubmit: null,
        messageLead: null,
      })
    );
    expect(reportPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(reportPrisma.xiaohongshuDailyReport.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['report-null'] } },
      include: { advertiserAccount: true },
    });
  });

  it('笔记日报输出内容维度与完整官方原始行', async () => {
    const rawPayload = {
      time: '2026-08-20',
      note_id: 'note-1',
      note_title: '新品测评',
      note_image: 'https://example.com/note-1.jpg',
      note_jump_url: 'https://www.xiaohongshu.com/explore/note-1',
      official_extra_metric: 42,
      note_meta__author: '作者甲',
      nested: { source: 'official' },
    };
    const row = {
      id: 'report-note',
      statDate: date('2026-08-20'),
      advertiserAccount: {
        advertiserId: 'adv-1',
        advertiserName: '品牌一',
        updatedAt: instant('2026-08-20T00:00:00.000Z'),
      },
      level: 'note',
      entityId: 'note-1',
      entityName: '新品测评',
      dataCaliber: 0,
      campaignId: null,
      campaignName: null,
      unitId: null,
      unitName: null,
      creativeId: null,
      creativeName: null,
      fee: 12,
      impression: 100,
      click: 10,
      interaction: 5,
      like: 2,
      comment: 1,
      collect: 1,
      follow: 0,
      share: 1,
      ...Object.fromEntries(nullableMetrics.map((metric) => [metric, null])),
      rawPayload,
      createdAt: instant('2026-08-20T01:00:00.000Z'),
      updatedAt: instant('2026-08-20T01:00:00.000Z'),
    };
    const service = createService(pagedReportPrisma([[row]], 1));

    const result = await service.getReports({
      level: 'note',
      dataCaliber: 0,
      page: 1,
      pageSize: 20,
      sortOrder: 'desc',
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        noteId: 'note-1',
        noteTitle: '新品测评',
        noteImage: 'https://example.com/note-1.jpg',
        noteJumpUrl: 'https://www.xiaohongshu.com/explore/note-1',
        rawPayload,
      })
    );
    expect(result.rawFieldKeys).toEqual([
      'nested',
      'note_id',
      'note_image',
      'note_jump_url',
      'note_meta__author',
      'note_title',
      'official_extra_metric',
      'time',
    ]);
  });

  describe('分析接口', () => {
    it('summary 跟踪可空指标 full/partial/unavailable，partial 派生率与 CPL 为 null', async () => {
      const first = analyticsRow('a', '2026-08-20', {
        fee: 20,
        impression: 100,
        click: 10,
        interaction: 4,
        like: 8,
        collect: 6,
        comment: 4,
        follow: 2,
        share: 1,
        formSubmit: 2,
        messageConsult: null,
        messageLead: null,
      });
      const second = analyticsRow('b', '2026-08-20', {
        fee: 10,
        impression: 50,
        click: 5,
        interaction: 2,
        like: 2,
        formSubmit: null,
        messageConsult: 3,
        messageLead: null,
      });
      const findMany = vi.fn().mockResolvedValue([first, second]);
      const service = createService({ xiaohongshuDailyReport: { findMany } });

      const result = await service.getSummary({
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        level: 'account',
        advertiserId: 'adv-1',
        dataCaliber: 1,
      });

      expect(result.range.dataCaliber).toBe(1);
      expect(result.totals).toEqual(
        expect.objectContaining({
          fee: 30,
          impression: 150,
          click: 15,
          interaction: 6,
          like: 10,
          formSubmit: 2,
          messageConsult: 3,
          messageLead: null,
          ctr: 0.1,
          cpc: 2,
          cpm: 200,
          cpi: 5,
          likeRate: 10 / 150,
          messageConsultRate: null,
          messageOpenRate: null,
          messageLeadRate: null,
          messageConsultCost: null,
          messageLeadCost: null,
          landingPageVisitRate: 0,
          formImpressionRate: null,
          formSubmitRate: null,
          validFormSubmitRate: null,
          formSubmitCost: null,
          validFormSubmitCost: null,
          metricCoverage: expect.objectContaining({
            landingPageVisit: 'full',
            formSubmit: 'partial',
            messageConsult: 'partial',
            messageLead: 'unavailable',
          }),
        })
      );
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dataCaliber: 1,
            advertiserAccount: { is: { deletedAt: null, advertiserId: 'adv-1' } },
          }),
        })
      );
    });

    it('analytics 保留旧连接独有早期历史，重叠逻辑键只取新账户数据', async () => {
      const oldAccount = {
        advertiserId: 'adv-1',
        updatedAt: instant('2026-07-01T00:00:00.000Z'),
      };
      const newAccount = {
        advertiserId: 'adv-1',
        updatedAt: instant('2026-08-20T00:00:00.000Z'),
      };
      const findMany = vi
        .fn()
        .mockResolvedValue([
          analyticsRow('adv-1', '2026-07-15', { fee: 5, advertiserAccount: oldAccount }),
          analyticsRow('adv-1', '2026-08-20', { fee: 100, advertiserAccount: oldAccount }),
          analyticsRow('adv-1', '2026-08-20', { fee: 10, advertiserAccount: newAccount }),
        ]);
      const service = createService({ xiaohongshuDailyReport: { findMany } });

      const result = await service.getSummary({
        startDate: '2026-07-01',
        endDate: '2026-08-20',
        level: 'account',
        advertiserId: 'adv-1',
        dataCaliber: 0,
      });

      expect(result.totals.fee).toBe(15);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            advertiserAccount: { is: { deletedAt: null, advertiserId: 'adv-1' } },
          }),
        })
      );
    });

    it('summary 在全部转化字段未知时保留 null', async () => {
      const unknown = Object.fromEntries(nullableMetrics.map((metric) => [metric, null]));
      const service = createService({
        xiaohongshuDailyReport: {
          findMany: vi
            .fn()
            .mockResolvedValue([analyticsRow('a', '2026-08-20', { fee: 10, ...unknown })]),
        },
      });

      const result = await service.getSummary({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        level: 'account',
        dataCaliber: 0,
      });

      expect(result.totals).toEqual(
        expect.objectContaining({
          ...unknown,
          fee: 10,
          metricCoverage: Object.fromEntries(
            nullableMetrics.map((metric) => [metric, 'unavailable'])
          ),
        })
      );
    });

    it('summary 无行时全部可空指标 unavailable', async () => {
      const service = createService({
        xiaohongshuDailyReport: { findMany: vi.fn().mockResolvedValue([]) },
      });
      const result = await service.getSummary({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        level: 'account',
        dataCaliber: 0,
      });
      expect(Object.values(result.totals.metricCoverage)).toEqual(
        nullableMetrics.map(() => 'unavailable')
      );
    });

    it('summary 返回对比区间 totals 与核心指标 deltas，previous=0 时 changeRate=null', async () => {
      const findMany = vi
        .fn()
        .mockResolvedValueOnce([
          analyticsRow('a', '2026-08-20', {
            fee: 30,
            impression: 150,
            click: 15,
            interaction: 6,
            messageConsult: 4,
            messageLead: 2,
            formSubmit: 3,
            validFormSubmit: 2,
          }),
        ])
        .mockResolvedValueOnce([
          analyticsRow('a', '2026-07-20', {
            fee: 10,
            impression: 100,
            click: 0,
            interaction: 3,
            messageConsult: 2,
            messageLead: 1,
            formSubmit: 0,
            validFormSubmit: 1,
          }),
        ]);
      const service = createService({ xiaohongshuDailyReport: { findMany } });

      const result = await service.getSummary({
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        compareStartDate: '2026-07-01',
        compareEndDate: '2026-07-20',
        level: 'account',
        dataCaliber: 0,
      });

      expect(result.comparison?.range).toEqual({
        startDate: '2026-07-01',
        endDate: '2026-07-20',
        dataCaliber: 0,
      });
      expect(result.deltas).toEqual(
        expect.objectContaining({
          fee: { current: 30, previous: 10, changeRate: 2 },
          impression: { current: 150, previous: 100, changeRate: 0.5 },
          click: { current: 15, previous: 0, changeRate: null },
          messageConsult: { current: 4, previous: 2, changeRate: 1 },
          formSubmit: { current: 3, previous: 0, changeRate: null },
        })
      );
    });

    it('可空指标仅在当前和上一周期 coverage 都为 full 时计算 changeRate', async () => {
      const findMany = vi
        .fn()
        .mockResolvedValueOnce([
          analyticsRow('a', '2026-08-20', { messageConsult: 4 }),
          analyticsRow('b', '2026-08-20', { messageConsult: null }),
        ])
        .mockResolvedValueOnce([analyticsRow('a', '2026-07-20', { messageConsult: 2 })]);
      const service = createService({ xiaohongshuDailyReport: { findMany } });

      const result = await service.getSummary({
        startDate: '2026-08-01',
        endDate: '2026-08-20',
        compareStartDate: '2026-07-01',
        compareEndDate: '2026-07-20',
        level: 'account',
        dataCaliber: 0,
      });

      expect(result.deltas?.messageConsult).toEqual({
        current: 4,
        previous: 2,
        changeRate: null,
      });
    });

    it('trend 按日期聚合、排序并处理零分母', async () => {
      const rows = [
        analyticsRow('a', '2026-08-21'),
        analyticsRow('a', '2026-08-20', {
          fee: 10,
          impression: 100,
          click: 5,
          interaction: 2,
        }),
        analyticsRow('b', '2026-08-20', {
          fee: 5,
          impression: 50,
          click: 5,
          interaction: 3,
        }),
      ];
      const service = createService({
        xiaohongshuDailyReport: { findMany: vi.fn().mockResolvedValue(rows) },
      });

      const result = await service.getTrend({
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        level: 'campaign',
        dataCaliber: 0,
      });

      expect(result.points).toHaveLength(2);
      expect(result.points[0]).toEqual(
        expect.objectContaining({
          date: '2026-08-20',
          fee: 15,
          impression: 150,
          click: 10,
          interaction: 5,
          ctr: 10 / 150,
          cpc: 1.5,
          interactionRate: 5 / 150,
        })
      );
      expect(result.points[1]).toEqual(
        expect.objectContaining({
          date: '2026-08-21',
          fee: 0,
          impression: 0,
          click: 0,
          interaction: 0,
          ctr: null,
          cpc: null,
          interactionRate: null,
        })
      );
    });

    it('ranking 按实体聚合、使用 ID 兜底名称并按指标截断', async () => {
      const rows = [
        analyticsRow('campaign-b', '2026-08-20', { click: 2 }),
        analyticsRow('campaign-a', '2026-08-20', {
          entityName: '计划 A',
          click: 10,
        }),
        analyticsRow('campaign-a', '2026-08-21', {
          entityName: '忽略的新名称',
          click: 5,
        }),
      ];
      const service = createService({
        xiaohongshuDailyReport: { findMany: vi.fn().mockResolvedValue(rows) },
      });

      const result = await service.getRanking({
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        level: 'campaign',
        metric: 'click',
        dataCaliber: 0,
        limit: 1,
      });

      expect(result.items).toEqual([
        expect.objectContaining({
          id: 'campaign-a',
          name: '计划 A',
          level: 'campaign',
          click: 15,
          value: 15,
        }),
      ]);
    });

    it('note ranking 携带笔记封面与跳转地址', async () => {
      const rows = [
        analyticsRow('note-1', '2026-08-20', {
          level: 'note',
          entityName: '新品测评',
          click: 10,
          rawPayload: {
            note_image: 'https://example.com/note-1.jpg',
            note_jump_url: 'https://www.xiaohongshu.com/explore/note-1',
          },
        }),
      ];
      const service = createService({
        xiaohongshuDailyReport: { findMany: vi.fn().mockResolvedValue(rows) },
      });

      const result = await service.getRanking({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        level: 'note',
        metric: 'click',
        dataCaliber: 0,
        limit: 20,
      });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: 'note-1',
          name: '新品测评',
          level: 'note',
          noteImage: 'https://example.com/note-1.jpg',
          noteJumpUrl: 'https://www.xiaohongshu.com/explore/note-1',
        })
      );
    });

    it('ranking 对可空扩展指标以 null 当 0 排序并保留 coverage', async () => {
      const rows = [
        analyticsRow('campaign-a', '2026-08-20', {
          entityName: '计划 A',
          messageLead: null,
        }),
        analyticsRow('campaign-b', '2026-08-20', {
          entityName: '计划 B',
          messageLead: 3,
        }),
        analyticsRow('campaign-b', '2026-08-21', { messageLead: null }),
      ];
      const service = createService({
        xiaohongshuDailyReport: { findMany: vi.fn().mockResolvedValue(rows) },
      });

      const result = await service.getRanking({
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        level: 'campaign',
        metric: 'messageLead',
        dataCaliber: 0,
        limit: 20,
      });

      expect(
        result.items.map(({ id, value, valueCoverage }) => ({ id, value, valueCoverage }))
      ).toEqual([
        { id: 'campaign-b', value: 3, valueCoverage: 'partial' },
        { id: 'campaign-a', value: 0, valueCoverage: 'unavailable' },
      ]);
    });
  });

  describe('同步任务查询', () => {
    it('分页筛选任务并安全映射 JSON 字段与可空时间', async () => {
      const row = syncRun({
        startDate: null,
        endDate: null,
        levels: null,
        advertiserIds: null,
        errors: { malformed: true },
        finishedAt: null,
      });
      const findMany = vi.fn();
      const count = vi.fn();
      const service = createService({
        $transaction: vi.fn().mockResolvedValue([[row], 1]),
        xiaohongshuSyncRun: { findMany, count },
      });

      const result = await service.getSyncRuns({
        status: 'failed',
        advertiserId: 'adv-1',
        page: 1,
        pageSize: 10,
        sortOrder: 'desc',
      });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          startDate: null,
          endDate: null,
          levels: [],
          advertiserIds: [],
          errors: [],
          finishedAt: null,
        })
      );
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            deletedAt: null,
            status: 'failed',
            advertiserIds: { array_contains: ['adv-1'] },
          },
        })
      );
    });

    it('查询最新任务，兼顾存在与不存在', async () => {
      const findFirst = vi.fn().mockResolvedValueOnce(syncRun()).mockResolvedValueOnce(null);
      const service = createService({ xiaohongshuSyncRun: { findFirst } });

      await expect(service.getLatestSyncRun('adv-1')).resolves.toEqual(
        expect.objectContaining({
          id: 'run-1',
          startDate: '2026-08-01',
          endDate: '2026-08-02',
          levels: ['account', 'campaign'],
          finishedAt: '2026-08-21T01:01:00.000Z',
        })
      );
      await expect(service.getLatestSyncRun()).resolves.toBeNull();
      expect(findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            deletedAt: null,
            advertiserIds: { array_contains: ['adv-1'] },
          },
        })
      );
    });

    it('查询任务详情时过滤 counts 并校验 report', async () => {
      const findFirst = vi
        .fn()
        .mockResolvedValueOnce(syncRun())
        .mockResolvedValueOnce(syncRun({ counts: [], report: { shardCount: '2' } }))
        .mockResolvedValueOnce(null);
      const service = createService({ xiaohongshuSyncRun: { findFirst } });

      await expect(service.getSyncRun('run-1')).resolves.toEqual(
        expect.objectContaining({
          counts: { 'adv-1:account:0': 3 },
          report: { shardCount: 2, succeeded: 2, failed: 0 },
        })
      );
      await expect(service.getSyncRun('run-1')).resolves.toEqual(
        expect.objectContaining({ counts: {}, report: null })
      );
      await expect(service.getSyncRun('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('双口径原子同步', () => {
    function syncPrisma() {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const reportUpdate = vi.fn().mockResolvedValue({});
      const reportFindMany = vi.fn().mockResolvedValue([]);
      const leaseUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const advertiserUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const transaction = vi.fn(async (callback: (client: object) => Promise<void>) =>
        callback({
          xiaohongshuSyncRun: { updateMany: leaseUpdateMany },
          xiaohongshuDailyReport: { deleteMany, createMany, update: reportUpdate },
          xiaohongshuAdvertiser: { updateMany: advertiserUpdateMany },
        })
      );
      const connectionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const runUpdate = vi.fn().mockResolvedValue({ count: 1 });
      const runFindFirst = vi.fn().mockResolvedValue({ id: 'run-1' });
      return {
        prisma: {
          $transaction: transaction,
          xiaohongshuAdvertiser: {
            findMany: vi.fn().mockResolvedValue([activeAdvertiser()]),
            updateMany: advertiserUpdateMany,
          },
          xiaohongshuSyncRun: {
            create: vi.fn().mockResolvedValue({ id: 'run-1' }),
            updateMany: runUpdate,
            findFirst: runFindFirst,
          },
          xiaohongshuDailyReport: { findMany: reportFindMany },
          xiaohongshuConnection: { updateMany: connectionUpdateMany },
        },
        transaction,
        deleteMany,
        createMany,
        reportFindMany,
        reportUpdate,
        leaseUpdateMany,
        runFindFirst,
        advertiserUpdateMany,
        connectionUpdateMany,
        runUpdate,
      };
    }

    it('每个层级同步 0/1 两种口径，事务内硬删并按最多 500 行 createMany', async () => {
      const state = syncPrisma();
      const firstPage = Array.from({ length: 500 }, () => ({ time: '2026-08-20' }));
      const api = {
        fetchOfflineReport: vi
          .fn()
          .mockResolvedValueOnce({ data_list: firstPage, total_count: 501 })
          .mockResolvedValueOnce({ data_list: [{ time: '2026-08-21' }], total_count: 501 })
          .mockResolvedValueOnce({ data_list: firstPage, total_count: 501 })
          .mockResolvedValueOnce({ data_list: [{ time: '2026-08-21' }], total_count: 501 }),
      };
      const service = createService(state.prisma, api, {
        getAccessToken: vi.fn().mockResolvedValue('access-secret'),
      });

      const result = await service.triggerSync({
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        levels: ['account'],
      });

      expect(result).toEqual({
        runId: 'run-1',
        status: 'success',
        startDate: '2026-08-20',
        endDate: '2026-08-21',
        levels: ['account'],
        advertiserIds: ['adv-1'],
      });
      expect(api.fetchOfflineReport.mock.calls.map((call) => call[2].data_caliber)).toEqual([
        0, 0, 1, 1,
      ]);
      expect(parseReportRow).toHaveBeenCalledTimes(1002);
      expect(state.transaction).toHaveBeenCalledTimes(2);
      expect(state.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ dataCaliber: 0 }),
      });
      expect(state.createMany).toHaveBeenCalledTimes(4);
      expect(state.createMany.mock.calls.map(([input]) => input.data.length)).toEqual([
        500, 1, 500, 1,
      ]);
      expect(state.runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'success',
            syncedRows: 1002,
            counts: { 'adv-1:account:0': 501, 'adv-1:account:1': 501 },
            report: { shardCount: 2, succeeded: 2, failed: 0 },
          }),
        })
      );
      expect(state.advertiserUpdateMany).toHaveBeenCalledTimes(2);
      expect(state.connectionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['connection-1'] } } })
      );
    });

    it('note 双口径完成后只查询一轮元数据，并以统一前缀逐记录合并全部字段', async () => {
      const state = syncPrisma();
      state.reportFindMany.mockResolvedValue([
        {
          id: 'report-0',
          entityId: 'note-1',
          rawPayload: { fee: '10', note_meta__legacy: '保留' },
        },
        { id: 'report-1', entityId: 'note-1', rawPayload: { fee: '20' } },
      ]);
      const api = {
        fetchOfflineReport: vi
          .fn()
          .mockResolvedValue({ data_list: [{ time: '2026-08-20' }], total_count: 1 }),
        fetchNoteList: vi.fn().mockImplementation((_token, request) => {
          if (request.note_type === 1) {
            return Promise.resolve({
              total: 2,
              notes: [
                {
                  note_id: 'note-1',
                  title: '首次标题',
                  desc: '完整正文',
                  cover: { url: 'https://example.com/cover.jpg' },
                },
                { note_id: 'other-note', title: '不得落库' },
              ],
            });
          }
          if (request.note_type === 2) {
            return Promise.resolve({
              total: 1,
              notes: [
                {
                  note_id: 'note-1',
                  title: '后续标题',
                  author: '作者',
                  cover: { width: 1080 },
                },
              ],
            });
          }
          return Promise.resolve({ total: 0, notes: [] });
        }),
      };
      const getAccessToken = vi.fn().mockResolvedValue('access-secret');
      const service = createService(state.prisma, api, { getAccessToken });

      const result = await service.triggerSync({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        levels: ['note'],
      });

      expect(result.status).toBe('success');
      expect(api.fetchOfflineReport).toHaveBeenCalledTimes(2);
      expect(api.fetchNoteList).toHaveBeenCalledTimes(7);
      expect(api.fetchNoteList.mock.calls.map((call) => call[1].note_type)).toEqual([
        1, 2, 4, 6, 11, 12, 14,
      ]);
      expect(api.fetchNoteList).toHaveBeenCalledWith(
        'access-secret',
        expect.objectContaining({
          advertiser_id: 'adv-1',
          keyword: 'note-1',
          page: 1,
          page_size: 100,
          base_only: false,
        })
      );
      expect(getAccessToken).toHaveBeenCalledTimes(3);
      expect(state.reportUpdate).toHaveBeenCalledTimes(4);
      const mergedPayload = state.reportUpdate.mock.calls[2]?.[0].data.rawPayload;
      expect(mergedPayload).toEqual({
        fee: '10',
        note_meta__legacy: '保留',
        note_meta__note_id: 'note-1',
        note_meta__title: '首次标题',
        note_meta__desc: '完整正文',
        note_meta__cover: { url: 'https://example.com/cover.jpg', width: 1080 },
        note_meta__author: '作者',
      });
      expect(mergedPayload).not.toHaveProperty('title');
      expect(JSON.stringify(state.reportUpdate.mock.calls)).not.toContain('不得落库');
      expect(state.runUpdate.mock.calls[0]?.[0].data).toEqual(
        expect.objectContaining({
          status: 'success',
          syncedRows: 2,
          report: { shardCount: 9, succeeded: 9, failed: 0 },
        })
      );
    });

    it('某个 note_type 失败时保留报表与成功元数据并将任务标记 partial', async () => {
      const state = syncPrisma();
      state.reportFindMany.mockResolvedValue([
        { id: 'report-0', entityId: 'note-1', rawPayload: { fee: '10' } },
      ]);
      const api = {
        fetchOfflineReport: vi
          .fn()
          .mockResolvedValue({ data_list: [{ time: '2026-08-20' }], total_count: 1 }),
        fetchNoteList: vi.fn().mockImplementation((_token, request) => {
          if (request.note_type === 1) {
            return Promise.resolve({
              total: 1,
              notes: [{ note_id: 'note-1', title: '已落库标题' }],
            });
          }
          if (request.note_type === 2) {
            return Promise.reject(new Error('access_token=secret note list failed'));
          }
          return Promise.resolve({ total: 0, notes: [] });
        }),
      };
      const service = createService(state.prisma, api, {
        getAccessToken: vi.fn().mockResolvedValue('secret'),
      });

      const result = await service.triggerSync({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        levels: ['note'],
      });

      expect(result.status).toBe('partial');
      expect(state.deleteMany).toHaveBeenCalledTimes(2);
      expect(state.createMany).toHaveBeenCalledTimes(2);
      expect(state.reportUpdate).toHaveBeenCalledWith({
        where: { id: 'report-0' },
        data: {
          rawPayload: {
            fee: '10',
            note_meta__note_id: 'note-1',
            note_meta__title: '已落库标题',
          },
        },
      });
      const payload = state.runUpdate.mock.calls[0]?.[0].data;
      expect(payload).toEqual(
        expect.objectContaining({
          status: 'partial',
          syncedRows: 2,
          report: { shardCount: 9, succeeded: 8, failed: 1 },
        })
      );
      expect(payload.errors).toEqual([
        expect.objectContaining({
          level: 'note',
          message: expect.stringContaining('note_type=2'),
        }),
      ]);
      expect(JSON.stringify(payload.errors)).not.toContain('secret');
    });

    it('分页失败不进入该口径事务，继续下一口径并记录 dataCaliber', async () => {
      const state = syncPrisma();
      const api = {
        fetchOfflineReport: vi
          .fn()
          .mockResolvedValueOnce({ data_list: [{ time: '2026-08-20' }], total_count: 501 })
          .mockRejectedValueOnce(new Error('access_token=secret page failed'))
          .mockResolvedValueOnce({ data_list: [{ time: '2026-08-20' }], total_count: 1 }),
      };
      const service = createService(state.prisma, api, {
        getAccessToken: vi.fn().mockResolvedValue('secret'),
      });

      const result = await service.triggerSync({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        levels: ['account'],
      });

      expect(result.status).toBe('partial');
      expect(state.transaction).toHaveBeenCalledTimes(1);
      const updateCall = state.runUpdate.mock.calls[0];
      if (!updateCall) throw new Error('同步任务未更新');
      const payload = updateCall[0].data;
      expect(payload).toEqual(
        expect.objectContaining({
          counts: { 'adv-1:account:0': 0, 'adv-1:account:1': 1 },
          report: { shardCount: 2, succeeded: 1, failed: 1 },
        })
      );
      expect(payload.errors).toEqual([
        expect.objectContaining({
          dataCaliber: 0,
          message: expect.stringContaining('[credential redacted]'),
        }),
      ]);
      expect(JSON.stringify(payload.errors)).not.toContain('secret');
    });

    it('看门狗关闭任务后停止后续分页，且不再写报表或覆盖 failed 终态', async () => {
      const state = syncPrisma();
      state.runFindFirst.mockResolvedValueOnce({ id: 'run-1' }).mockResolvedValueOnce(null);
      const api = {
        fetchOfflineReport: vi.fn().mockResolvedValue({
          data_list: [{ time: '2026-08-20' }],
          total_count: 501,
        }),
      };
      const service = createService(state.prisma, api, {
        getAccessToken: vi.fn().mockResolvedValue('secret'),
      });

      await expect(
        service.triggerSync({
          startDate: '2026-08-20',
          endDate: '2026-08-20',
          levels: ['account'],
        })
      ).rejects.toThrow('同步任务已被关闭');

      expect(api.fetchOfflineReport).toHaveBeenCalledOnce();
      expect(state.transaction).not.toHaveBeenCalled();
      expect(state.runUpdate).not.toHaveBeenCalled();
      expect(state.deleteMany).not.toHaveBeenCalled();
    });

    it('任一行解析失败或 total_count 非零却零解析时不替换旧分片；权威零行可仅删除', async () => {
      const state = syncPrisma();
      const rawSecret = 'raw-sensitive-payload';
      const api = {
        fetchOfflineReport: vi
          .fn()
          .mockResolvedValueOnce({
            data_list: [{ time: '2026-08-20' }, { time: 'invalid', raw: rawSecret }],
            total_count: 2,
          })
          .mockResolvedValueOnce({ data_list: [], total_count: 0 }),
      };
      const service = createService(state.prisma, api, {
        getAccessToken: vi.fn().mockResolvedValue('secret'),
      });

      const result = await service.triggerSync({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        levels: ['account'],
      });

      expect(result.status).toBe('partial');
      expect(state.deleteMany).toHaveBeenCalledTimes(1);
      expect(state.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ dataCaliber: 1 }),
      });
      expect(state.createMany).not.toHaveBeenCalled();
      const payload = state.runUpdate.mock.calls[0]?.[0].data;
      expect(payload.errors[0]).toEqual(
        expect.objectContaining({
          level: 'account',
          dataCaliber: 0,
          message: expect.stringContaining('1 行'),
        })
      );
      expect(JSON.stringify(payload.errors)).not.toContain(rawSecret);
    });

    it('total_count>0 但 API 返回零行时不进入替换事务', async () => {
      const state = syncPrisma();
      const api = {
        fetchOfflineReport: vi
          .fn()
          .mockResolvedValueOnce({ data_list: [], total_count: 1 })
          .mockResolvedValueOnce({ data_list: [{ time: 'invalid' }], total_count: 1 }),
      };
      const service = createService(state.prisma, api, {
        getAccessToken: vi.fn().mockResolvedValue('secret'),
      });

      const result = await service.triggerSync({
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        levels: ['account'],
      });

      expect(result.status).toBe('failed');
      expect(state.transaction).not.toHaveBeenCalled();
      expect(state.deleteMany).not.toHaveBeenCalled();
      expect(state.createMany).not.toHaveBeenCalled();
    });

    it('无广告主时创建 failed 任务，不更新连接，并使用默认层级与昨天日期', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(instant('2026-08-21T10:00:00.000Z'));
      const runUpdate = vi.fn().mockResolvedValue({ count: 1 });
      const connectionUpdateMany = vi.fn();
      const service = createService({
        xiaohongshuAdvertiser: { findMany: vi.fn().mockResolvedValue([]) },
        xiaohongshuSyncRun: {
          create: vi.fn().mockResolvedValue({ id: 'run-empty' }),
          updateMany: runUpdate,
        },
        xiaohongshuConnection: { updateMany: connectionUpdateMany },
      });

      await expect(service.triggerSync({} as XiaohongshuManualSyncDto)).resolves.toEqual({
        runId: 'run-empty',
        status: 'failed',
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        levels: ['account', 'campaign', 'unit', 'creative', 'note'],
        advertiserIds: [],
      });
      expect(runUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            syncedRows: 0,
            report: { shardCount: 0, succeeded: 0, failed: 0 },
            errors: [{ message: '没有可同步的已授权广告主' }],
          }),
        })
      );
      expect(connectionUpdateMany).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('拒绝只传一侧日期或超过 30 天的同步范围', async () => {
      const service = createService({});

      await expect(
        service.triggerSync({ startDate: '2026-08-01' } as XiaohongshuManualSyncDto)
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.triggerSync({
          startDate: '2026-07-22',
          endDate: '2026-08-21',
        } as XiaohongshuManualSyncDto)
      ).rejects.toThrow('同步日期范围最多 30 天');
    });
  });
});
