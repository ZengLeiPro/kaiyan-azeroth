import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import XiaohongshuCenterPage from './XiaohongshuCenterPage';
import { getXiaohongshuGlobalSearch, XiaohongshuCenterShell } from './XiaohongshuCenterShell';
import { XiaohongshuCoverageStrip } from './XiaohongshuCoverageStrip';
import { XiaohongshuDatasetPanel } from './XiaohongshuDatasetPanel';
import { XiaohongshuDatasetWorkspacePage } from './XiaohongshuDatasetWorkspacePage';

const center = vi.hoisted(() => ({
  useXiaohongshuCenter: vi.fn(),
}));
const datasets = vi.hoisted(() => ({
  useXiaohongshuDatasetCatalog: vi.fn(),
  useXiaohongshuDatasetQuery: vi.fn(),
}));
const analytics = vi.hoisted(() => ({
  resolveXiaohongshuRange: vi.fn(() => ({
    startDate: '2026-08-01',
    endDate: '2026-08-28',
  })),
  useXiaohongshuSummary: vi.fn(),
}));

vi.mock('./xiaohongshu-center-context', () => ({
  XiaohongshuCenterProvider: ({ children }: { children: React.ReactNode }) => children,
  useXiaohongshuCenter: center.useXiaohongshuCenter,
}));
vi.mock('./use-xiaohongshu-datasets', () => datasets);
vi.mock('@/pages/analytics/hooks/use-xiaohongshu-analytics-data', () => analytics);
vi.mock('@/pages/analytics/components/AnalyticsDateRangePicker', () => ({
  AnalyticsDateRangePicker: () => <button type="button">选择日期</button>,
}));

const catalogData = {
  datasets: [
    {
      id: 'delivery.campaign',
      label: '推广计划',
      group: 'delivery',
      description: '计划配置与状态',
      requiredScope: 'ad_query',
      availability: 'available',
      availabilityReason: null,
      queryable: true,
      source: 'official_api',
      endpoint: '/api/open/jg/campaign/list',
      requiredParams: [],
      pagination: 'page_object',
    },
    {
      id: 'content.comment',
      label: '广告素材评论',
      group: 'content',
      description: '评论与回复明细',
      requiredScope: 'ad_query',
      availability: 'requires_whitelist',
      availabilityReason: '需要评论接口白名单',
      queryable: false,
      source: 'official_api',
      endpoint: '/api/open/ad_material_note/comment/getlist',
      requiredParams: ['note_id'],
      pagination: 'page_object',
    },
  ],
  scopes: ['ad_query'],
  connected: true,
  updatedAt: '2026-08-29T12:00:00.000Z',
};

const queryData = {
  dataset: catalogData.datasets[0],
  items: [{ campaign_id: 'campaign-1', campaign_name: '品牌投放', settings: { status: 1 } }],
  fields: [
    {
      key: 'campaign_id',
      label: '计划 ID',
      group: '对象与关联',
      valueType: 'string',
      isCore: true,
    },
    {
      key: 'campaign_name',
      label: '计划名称',
      group: '对象与关联',
      valueType: 'string',
      isCore: true,
    },
    {
      key: 'settings',
      label: 'settings',
      group: '其他字段',
      valueType: 'object',
      isCore: false,
    },
  ],
  total: 61,
  totalMode: 'exact',
  hasMore: true,
  page: 1,
  pageSize: 50,
  totalPages: 2,
  aggregation: { fee: 128.5 },
  metadata: { unsupported_columns: ['deep_conversion_cost'] },
  requestId: 'request-1',
  fetchedAt: '2026-08-29T12:00:00.000Z',
};

describe('小红书分析中心结构化页面', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    center.useXiaohongshuCenter.mockReturnValue({
      range: { preset: 'last30d' },
      setRange: vi.fn(),
      advertiserId: 'adv-1',
      setAdvertiserId: vi.fn(),
      dataCaliber: 0,
      setDataCaliber: vi.fn(),
      advertisers: {
        data: [{ advertiserId: 'adv-1', advertiserName: '品牌一' }],
        isLoading: false,
      },
    });
    datasets.useXiaohongshuDatasetCatalog.mockReturnValue({
      data: catalogData,
      isLoading: false,
    });
    datasets.useXiaohongshuDatasetQuery.mockReturnValue({
      data: queryData,
      isLoading: false,
      isError: false,
    });
  });

  it('中心壳统一提供七个入口和全局筛选', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xiaohongshu/delivery?advertiser=adv-1']}>
        <XiaohongshuCenterShell>
          <div>页面内容</div>
        </XiaohongshuCenterShell>
      </MemoryRouter>
    );

    expect(screen.getByText('小红书分析中心')).toBeTruthy();
    for (const label of [
      '经营总览',
      '投放结构',
      '内容与笔记',
      '搜索与人群',
      '线索与成交',
      '账户与资金',
      '全量数据',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('选择日期')).toBeTruthy();
    expect(screen.getByText('页面内容')).toBeTruthy();
  });

  it('跨业务页只保留全局筛选，不把数据集私有参数带到其他页面', () => {
    expect(
      getXiaohongshuGlobalSearch(
        '?advertiser=adv-1&range=custom&start=2026-08-01&end=2026-08-28&caliber=1&dataset=content.note&note_id=123'
      )
    ).toBe('?advertiser=adv-1&range=custom&start=2026-08-01&end=2026-08-28&caliber=1');
  });

  it('层级覆盖条把笔记局部样本显式量化', () => {
    const fees: Record<string, number> = {
      account: 541.5,
      campaign: 541.5,
      unit: 541.5,
      creative: 541.48,
      note: 28.72,
    };
    analytics.useXiaohongshuSummary.mockImplementation(
      (_range: unknown, _caliber: unknown, _advertiser: unknown, level = 'account') => ({
        data: { totals: { fee: fees[level] } },
      })
    );

    render(<XiaohongshuCoverageStrip />);

    expect(screen.getByText(/笔记层仅覆盖账户消费 5.3%/)).toBeTruthy();
    expect(screen.getByText(/创意 ¥541.48 · 100.0%/)).toBeTruthy();
  });

  it('数据工作区结构化统计可查询与条件能力，并保留选择入口', () => {
    render(
      <MemoryRouter>
        <XiaohongshuDatasetWorkspacePage
          title="全量数据目录"
          description="完整能力"
          initialDataset="delivery.campaign"
        />
      </MemoryRouter>
    );

    expect(screen.getByText('本页 2 个数据集')).toBeTruthy();
    expect(screen.getByText('已接入 1')).toBeTruthy();
    expect(screen.getByText('条件开放 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '推广计划' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /广告素材评论/ })).toBeTruthy();
    expect(screen.getByText('campaign-1')).toBeTruthy();
  });

  it('数据表和穿透详情以中文展示，技术原始数据按需折叠保留', () => {
    render(<XiaohongshuDatasetPanel datasetId="delivery.campaign" />);

    expect(screen.getByText('计划标识（ID）')).toBeTruthy();
    expect(screen.getByText('官方汇总')).toBeTruthy();
    expect(screen.getByText('返回元数据')).toBeTruthy();
    expect(screen.getByText('不支持的指标字段')).toBeTruthy();
    expect(screen.getByText('["深度转化成本"]')).toBeTruthy();
    expect(
      screen.getAllByTestId('pagination').some((item) => item.textContent?.includes('61'))
    ).toBe(true);
    fireEvent.click(screen.getByText('campaign-1'));
    expect(screen.getByText('完整记录')).toBeTruthy();
    expect(screen.getByText('配置详情')).toBeTruthy();
    expect(screen.getByText('技术原始数据（JSON，供核对与排障）')).toBeTruthy();
    expect(screen.getByText(/"campaign_name": "品牌投放"/)).toBeTruthy();
  });

  it('条件参数未填时不查询，填写后立即启用受控读取', () => {
    datasets.useXiaohongshuDatasetCatalog.mockReturnValue({
      data: { ...catalogData, datasets: [catalogData.datasets[1]] },
      isLoading: false,
    });

    render(<XiaohongshuDatasetPanel datasetId="content.comment" />);

    expect(datasets.useXiaohongshuDatasetQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ datasetId: 'content.comment' }),
      false
    );
    expect(screen.getByText(/当前不能调用/)).toBeTruthy();
  });

  it('多页面路由直接进入投放结构，筛选条件不丢失', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xiaohongshu/delivery?advertiser=adv-1']}>
        <Routes>
          <Route path="/analytics/xiaohongshu/*" element={<XiaohongshuCenterPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getAllByText('投放结构').length).toBeGreaterThan(0);
    expect(screen.getByText(/计划、单元、创意与笔记/)).toBeTruthy();
  });
});
