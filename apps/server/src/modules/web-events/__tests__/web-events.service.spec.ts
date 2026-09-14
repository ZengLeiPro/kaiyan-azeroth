import { NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/prisma-mock.factory';
import { WebEventsService } from '../web-events.service';

describe('WebEventsService', () => {
  let prisma: MockPrismaService;
  let service: WebEventsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new WebEventsService(asPrismaService(prisma));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('findEvents 默认排除 bot，并序列化 BigInt/Date 字段', async () => {
    prisma.webEvent.count.mockResolvedValue(1);
    prisma.webEvent.findMany.mockResolvedValue([
      webEventRow({
        id: 9223372036854775807n,
        receivedAt: new Date('2026-07-02T06:42:00.000Z'),
        clientTs: new Date('2026-07-02T06:41:59.000Z'),
        raw: { pct: 75 },
      }),
    ]);

    const result = await service.findEvents({
      page: 2,
      pageSize: 25,
      event: ['consult_form_submit'],
      path: '/custom-dev',
      sortOrder: 'asc',
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: '9223372036854775807',
          receivedAt: '2026-07-02T06:42:00.000Z',
          clientTs: '2026-07-02T06:41:59.000Z',
          path: '/custom-dev',
          raw: { pct: 75 },
        }),
      ],
      total: 1,
      page: 2,
      pageSize: 25,
      totalPages: 1,
    });
    expect(prisma.webEvent.findMany).toHaveBeenCalledWith({
      where: {
        isBot: false,
        event: 'consult_form_submit',
        path: '/custom-dev',
      },
      skip: 25,
      take: 25,
      orderBy: { receivedAt: 'asc' },
    });
  });

  it('findEvents 支持多值筛选、路径前缀、北京时间日期与关键词', async () => {
    prisma.webEvent.count.mockResolvedValue(0);
    prisma.webEvent.findMany.mockResolvedValue([]);

    await service.findEvents({
      page: 1,
      pageSize: 100,
      sortOrder: 'desc',
      site: 'example.com',
      event: ['pageview', 'consult_modal_open'],
      pathPrefix: '/blog/',
      vid: 'vid-1',
      sid: 'sid-1',
      utmSource: ['baidu', 'google'],
      utmMedium: ['organic'],
      utmCampaign: ['seo'],
      refHost: ['www.baidu.com'],
      placement: ['blog_inline'],
      channel: ['wechat_mp'],
      dateFrom: '2026-07-02',
      dateTo: '2026-07-03T00:00:00.000Z',
      keyword: '厦门',
      isBot: true,
    });

    expect(prisma.webEvent.count).toHaveBeenCalledWith({
      where: {
        isBot: true,
        site: 'example.com',
        event: { in: ['pageview', 'consult_modal_open'] },
        path: { startsWith: '/blog/' },
        vid: 'vid-1',
        sid: 'sid-1',
        utmSource: { in: ['baidu', 'google'] },
        utmMedium: { in: ['organic'] },
        utmCampaign: { in: ['seo'] },
        refHost: { in: ['www.baidu.com'] },
        placement: { in: ['blog_inline'] },
        channel: { in: ['wechat_mp'] },
        receivedAt: {
          gte: new Date('2026-07-02T00:00:00+08:00'),
          lt: new Date('2026-07-03T00:00:00.000Z'),
        },
        OR: [{ title: { contains: '厦门' } }, { path: { contains: '厦门' } }],
      },
    });
  });

  it('getEvent 用 BigInt id 查询并在缺失时抛 NotFoundException', async () => {
    prisma.webEvent.findFirst
      .mockResolvedValueOnce(webEventRow({ id: 42n }))
      .mockResolvedValueOnce(null);

    await expect(service.getEvent('42')).resolves.toMatchObject({ id: '42' });
    expect(prisma.webEvent.findFirst).toHaveBeenCalledWith({ where: { id: 42n } });

    await expect(service.getEvent('43')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getEvent 拒绝非数字 id 且不查询数据库', async () => {
    await expect(service.getEvent('abc')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.webEvent.findFirst).not.toHaveBeenCalled();
  });

  it('archiveEvents 默认 dryRun，仅返回匹配数不删除', async () => {
    prisma.webEvent.count.mockResolvedValue(12);

    const result = await service.archiveEvents({
      before: '2026-07-01',
      path: '/__test__/',
      dryRun: true,
      yes: false,
    });

    expect(result).toEqual({ matched: 12, deleted: 0, dryRun: true });
    expect(prisma.webEvent.count).toHaveBeenCalledWith({
      where: {
        receivedAt: { lt: new Date('2026-07-01T00:00:00+08:00') },
        path: '/__test__/',
      },
    });
    expect(prisma.webEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('archiveEvents 只有 dryRun=false 且 yes=true 才真删', async () => {
    prisma.webEvent.count.mockResolvedValue(3);
    prisma.webEvent.deleteMany.mockResolvedValue({ count: 3 });

    const result = await service.archiveEvents({
      before: '2026-07-01T00:00:00.000Z',
      dryRun: false,
      yes: true,
    });

    expect(result).toEqual({ matched: 3, deleted: 3, dryRun: false });
    expect(prisma.webEvent.deleteMany).toHaveBeenCalledWith({
      where: { receivedAt: { lt: new Date('2026-07-01T00:00:00.000Z') } },
    });
  });

  it('archiveEvents 拒绝非法 before', async () => {
    await expect(
      service.archiveEvents({
        before: 'not-a-date',
        dryRun: false,
        yes: true,
      })
    ).rejects.toThrow('archive.before 无法解析为合法日期');
    expect(prisma.webEvent.count).not.toHaveBeenCalled();
  });
});

function webEventRow(overrides: Partial<ReturnType<typeof baseWebEventRow>> = {}) {
  return {
    ...baseWebEventRow(),
    ...overrides,
  };
}

function baseWebEventRow() {
  return {
    id: 1n,
    receivedAt: new Date('2026-07-02T06:42:00.000Z'),
    clientTs: null as Date | null,
    site: 'example.com',
    event: 'pageview',
    vid: 'vid-1',
    sid: 'sid-1',
    path: '/custom-dev',
    pageType: 'service',
    title: '定制开发',
    referrer: null,
    refHost: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    placement: null,
    channel: null,
    label: null,
    ua: 'Mozilla/5.0',
    isBot: false,
    ipHash: 'ip-hash',
    country: '中国',
    region: '福建省',
    city: '厦门市',
    isp: '电信',
    screen: '1440x900',
    lang: 'zh-CN',
    raw: null as Record<string, unknown> | null,
  };
}
