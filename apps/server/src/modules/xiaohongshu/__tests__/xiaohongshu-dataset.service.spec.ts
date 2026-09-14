import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { XiaohongshuDatasetService } from '../xiaohongshu-dataset.service';

const activeAdvertiser = (scopes: string[]) => ({
  advertiserId: 'adv-1',
  connection: { id: 'connection-1', scopes },
});

function createService({
  scopes = ['report_service', 'ad_query', 'ad_manage', 'account_manage'],
  advertiser = activeAdvertiser(scopes),
  connection,
  readData,
  localReports,
}: {
  scopes?: string[];
  advertiser?: ReturnType<typeof activeAdvertiser> | null;
  connection?: { scopes: string[]; status: string } | null;
  readData?: unknown;
  localReports?: unknown;
} = {}) {
  const prisma = {
    xiaohongshuConnection: {
      findFirst: vi
        .fn()
        .mockResolvedValue(connection === undefined ? { scopes, status: 'active' } : connection),
    },
    xiaohongshuAdvertiser: {
      findFirst: vi.fn().mockResolvedValue(advertiser),
    },
  };
  const api = {
    fetchReadData: vi.fn().mockResolvedValue(
      readData ?? {
        data: { campaigns: [{ campaign_id: 'campaign-1', campaign_name: '品牌投放' }], total: 1 },
        requestId: 'request-1',
      }
    ),
  };
  const tokens = { getAccessToken: vi.fn().mockResolvedValue('access-token') };
  const legacy = {
    getReports: vi.fn().mockResolvedValue(
      localReports ?? {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      }
    ),
  };
  return {
    service: new XiaohongshuDatasetService(
      prisma as never,
      api as never,
      tokens as never,
      legacy as never
    ),
    prisma,
    api,
    tokens,
    legacy,
  };
}

const baseInput = {
  advertiserId: 'adv-1',
  dataCaliber: 0 as const,
  page: 2,
  pageSize: 20,
  params: {},
};

const input = {
  ...baseInput,
  startDate: '2026-08-01',
  endDate: '2026-08-28',
};

describe('XiaohongshuDatasetService', () => {
  it('目录按真实 scope 标注可查询状态与条件边界', async () => {
    const { service } = createService({ scopes: ['report_service'] });

    const result = await service.getCatalog();

    expect(result.connected).toBe(true);
    expect(result.datasets).toHaveLength(66);
    expect(result.datasets.find((item) => item.id === 'report.account.offline')).toMatchObject({
      availability: 'available',
      queryable: true,
    });
    expect(result.datasets.find((item) => item.id === 'delivery.campaign')).toMatchObject({
      availability: 'scope_missing',
      queryable: false,
      availabilityReason: '当前开放授权（OAuth）缺少广告查询权限（ad_query scope）',
    });
    expect(
      result.datasets.find((item) => item.id === 'conversion.private-message-session')
    ).toMatchObject({ availability: 'requires_extra_scope', queryable: false });
  });

  it('没有有效连接时目录统一标记不可查询，不复用过期连接 scope', async () => {
    const { service, prisma } = createService({ connection: null });

    const result = await service.getCatalog();

    expect(prisma.xiaohongshuConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, status: 'active' } })
    );
    expect(result.connected).toBe(false);
    expect(result.scopes).toEqual([]);
    expect(result.datasets.every((dataset) => dataset.queryable === false)).toBe(true);
    expect(result.datasets[0]).toMatchObject({
      availability: 'connection_missing',
      availabilityReason: '当前没有有效的小红书聚光连接',
    });
  });

  it('目录提供 Agent 可直接构造请求的完整参数契约，并支持单项读取', async () => {
    const { service } = createService();

    const report = await service.getDefinition('report.keyword.offline', {
      advertiserId: 'adv-1',
    });
    expect(report).toMatchObject({
      id: 'report.keyword.offline',
      endpoint: '/api/open/jg/data/report/offline/keyword',
      method: 'POST',
      pagination: 'page_num',
      supportsDateRange: true,
      supportsDataCaliber: true,
      allowsAdditionalParams: true,
      defaults: { dataCaliber: 0, page: 1, pageSize: 50 },
    });
    expect(report.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'advertiserId',
          source: 'request',
          required: true,
          valueType: 'string',
        }),
        expect.objectContaining({ name: 'startDate', source: 'request', required: false }),
        expect.objectContaining({ name: 'dataCaliber', enumValues: [0, 1] }),
        expect.objectContaining({ name: 'page', source: 'request', required: false }),
        expect.objectContaining({
          name: 'params',
          source: 'request',
          required: false,
          valueType: 'object',
        }),
      ])
    );

    const contextual = await service.getDefinition('delivery.easy-target-id');
    expect(contextual.parameters).toContainEqual(
      expect.objectContaining({
        name: 'campaign_group_ids',
        source: 'params',
        required: true,
        valueType: 'string[]',
      })
    );
    await expect(service.getDefinition('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('目录按选中广告主所属连接解析 scope，不借用另一条连接权限', async () => {
    const { service, prisma } = createService({ scopes: ['report_service'] });
    prisma.xiaohongshuAdvertiser.findFirst.mockResolvedValueOnce({
      advertiserId: 'adv-1',
      connection: { id: 'connection-1', scopes: ['ad_query'], status: 'active' },
    });

    const result = await service.getCatalog({ advertiserId: 'adv-1' });

    expect(result.scopes).toEqual(['ad_query']);
    expect(result.datasets.find((item) => item.id === 'delivery.campaign')).toMatchObject({
      availability: 'available',
      queryable: true,
    });
    expect(result.datasets.find((item) => item.id === 'report.account.offline')).toMatchObject({
      availability: 'scope_missing',
      queryable: false,
    });
  });

  it('官方查询强制覆盖广告主与分页参数，并结构化返回字段', async () => {
    const { service, api, tokens } = createService();

    const result = await service.query('delivery.campaign', {
      ...baseInput,
      params: { advertiser_id: 'forged', page: 999, status: 1 },
    });

    expect(tokens.getAccessToken).toHaveBeenCalledWith('connection-1');
    expect(api.fetchReadData).toHaveBeenCalledWith(
      'access-token',
      '/api/open/jg/campaign/list',
      'POST',
      expect.objectContaining({
        advertiser_id: 'adv-1',
        page: { page_index: 2, page_size: 20 },
        status: 1,
      })
    );
    expect(result).toMatchObject({
      total: 1,
      totalMode: 'exact',
      hasMore: false,
      page: 2,
      pageSize: 20,
      requestId: 'request-1',
      items: [{ campaign_id: 'campaign-1', campaign_name: '品牌投放' }],
      metadata: { total: 1 },
    });
    expect(result.fields.find((field) => field.key === 'campaign_id')).toMatchObject({
      label: '计划标识（ID）',
      group: '对象与关联',
      isCore: true,
    });
  });

  it('本地日报沿用真实服务端分页并把规范字段与完整 raw payload 合并', async () => {
    const { service, legacy } = createService({
      localReports: {
        items: [
          {
            id: 'report-1',
            statDate: '2026-08-28',
            advertiserName: '品牌一',
            fee: 12.5,
            impression: 100,
            click: 5,
            interaction: 2,
            rawPayload: { future_metric: 42 },
          },
        ],
        total: 41,
        page: 2,
        pageSize: 20,
        totalPages: 3,
      },
    });

    const result = await service.query('report.account.offline', input);

    expect(legacy.getReports).toHaveBeenCalledWith({
      advertiserId: 'adv-1',
      startDate: '2026-08-01',
      endDate: '2026-08-28',
      dataCaliber: 0,
      level: 'account',
      page: 2,
      pageSize: 20,
      sortOrder: 'desc',
    });
    expect(result).toMatchObject({
      total: 41,
      totalMode: 'exact',
      hasMore: true,
      totalPages: 3,
      items: [{ future_metric: 42, _ky_id: 'report-1', _ky_fee: 12.5 }],
    });
    expect(result.fields.find((field) => field.key === 'future_metric')?.label).toBe(
      '其他字段（future_metric）'
    );
  });

  it('参数类型、数据集能力、未知数据集与无效广告主均明确拒绝', async () => {
    const { service } = createService();
    await expect(
      service.query('asset.material-preference', { ...baseInput, page: 1 })
    ).rejects.toThrow('当前数据集还需要参数：笔记标识列表（note_ids）');
    await expect(
      service.query('asset.material-preference', {
        ...baseInput,
        page: 1,
        params: { note_ids: [] },
      })
    ).rejects.toThrow('当前数据集还需要参数：笔记标识列表（note_ids）');
    await expect(
      service.query('asset.material-preference', {
        ...baseInput,
        page: 1,
        params: { note_ids: 1 },
      })
    ).rejects.toThrow('参数 笔记标识列表（note_ids）类型不正确，期望 string[]');
    await expect(
      service.query('asset.material-preference', {
        ...baseInput,
        page: 1,
        params: { note_ids: [''] },
      })
    ).rejects.toThrow('参数 笔记标识列表（note_ids）类型不正确，期望 string[]');
    await expect(
      service.query('report.account.offline', { ...input, params: { status: 1 } })
    ).rejects.toThrow('本地日报数据集不接受 params 扩展参数');
    await expect(
      service.query('delivery.campaign', {
        ...baseInput,
        startDate: '2026-08-01',
        endDate: '2026-08-28',
      })
    ).rejects.toThrow('当前数据集不支持日期范围参数');
    await expect(service.query('account.budget', { ...baseInput, page: 2 })).rejects.toThrow(
      '当前数据集不分页，page 必须为 1'
    );
    await expect(
      service.query('content.comment', { ...baseInput, params: { note_id: 'note-1' } })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.query('missing', input)).rejects.toBeInstanceOf(NotFoundException);

    const missingAdvertiser = createService({ advertiser: null }).service;
    await expect(missingAdvertiser.query('delivery.campaign', input)).rejects.toThrow(
      '未找到可用的小红书广告主授权'
    );
  });

  it('根级数组与无 total 响应使用保守分页推断', async () => {
    const { service } = createService({
      readData: { data: [{ keyword: '企业AI' }, { keyword: '钉钉' }] },
    });

    const result = await service.query('search.negative-keyword', {
      ...baseInput,
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toEqual([{ keyword: '企业AI' }, { keyword: '钉钉' }]);
    expect(result.total).toBe(2);
    expect(result.totalMode).toBe('estimated');
    expect(result.hasMore).toBe(false);
    expect(result.totalPages).toBe(1);
  });

  it('无精确总数且满页时只标记仍有下一页，不把估算值冒充真实总量', async () => {
    const { service } = createService({
      readData: {
        data: Array.from({ length: 20 }, (_, index) => ({ keyword: `关键词${index + 1}` })),
      },
    });

    const result = await service.query('search.negative-keyword', {
      ...baseInput,
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(21);
    expect(result.totalMode).toBe('estimated');
    expect(result.hasMore).toBe(true);
  });

  it('无分页数据集即使一次返回满页，也明确判定完整结束', async () => {
    const { service } = createService({
      readData: {
        data: Array.from({ length: 20 }, (_, index) => ({ campaign_group_id: `group-${index}` })),
      },
    });

    const result = await service.query('delivery.easy-target-id', {
      ...baseInput,
      page: 1,
      params: { campaign_group_ids: ['group-1'] },
    });

    expect(result.total).toBe(20);
    expect(result.totalMode).toBe('exact');
    expect(result.hasMore).toBe(false);
    expect(result.totalPages).toBe(1);
  });

  it('分页包装只有 total=0 时返回空行，不把包装对象伪装成业务数据', async () => {
    const { service } = createService({ readData: { data: { total: 0 } } });

    const result = await service.query('delivery.campaign', { ...baseInput, page: 1 });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.totalPages).toBe(0);
  });

  it('无分页单对象中的 total 是业务字段，不被误判为分页总数', async () => {
    const { service } = createService({
      readData: { data: { daily_budget: 100, total: 5 } },
    });

    const result = await service.query('account.budget', { ...baseInput, page: 1 });

    expect(result.items).toEqual([{ daily_budget: 100, total: 5 }]);
    expect(result.total).toBe(1);
    expect(result.totalMode).toBe('exact');
    expect(result.hasMore).toBe(false);
    expect(result.totalPages).toBe(1);
  });

  it('完整保留官方汇总与行数据之外的响应元数据', async () => {
    const { service } = createService({
      readData: {
        data: {
          campaigns: [{ campaign_id: 'campaign-1' }],
          aggregation_data: { fee: 128.5, impression: 3200 },
          unsupported_columns: ['deep_conversion_cost'],
          total: 1,
        },
      },
    });

    const result = await service.query('delivery.campaign', { ...baseInput, page: 1 });

    expect(result.aggregation).toEqual({ fee: 128.5, impression: 3200 });
    expect(result.metadata).toEqual({
      unsupported_columns: ['deep_conversion_cost'],
      total: 1,
    });
  });
});
