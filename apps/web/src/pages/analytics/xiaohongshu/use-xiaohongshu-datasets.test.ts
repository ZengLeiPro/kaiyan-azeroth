import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useXiaohongshuDatasetCatalog,
  useXiaohongshuDatasetQuery,
} from './use-xiaohongshu-datasets';

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn((options) => options),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('@/lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }));

describe('小红书全量数据 hooks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('目录使用稳定缓存键并读取统一目录接口', async () => {
    mocks.get.mockResolvedValue({ data: { datasets: [] } });
    useXiaohongshuDatasetCatalog('adv-1');
    const options = mocks.useQuery.mock.calls[0]?.[0];

    expect(options.queryKey).toEqual(['analytics', 'xiaohongshu', 'datasets', 'adv-1']);
    expect(options.enabled).toBe(true);
    await expect(options.queryFn()).resolves.toEqual({ datasets: [] });
    expect(mocks.get).toHaveBeenCalledWith('/xiaohongshu/datasets', {
      params: { advertiserId: 'adv-1' },
    });

    useXiaohongshuDatasetCatalog('');
    expect(mocks.useQuery.mock.calls[1]?.[0].enabled).toBe(false);
  });

  it('数据查询编码数据集 ID、发送分页筛选，并在缺广告主时禁用', async () => {
    mocks.post.mockResolvedValue({ data: { items: [] } });
    const input = {
      datasetId: 'report/account',
      advertiserId: 'adv-1',
      startDate: '2026-08-01',
      endDate: '2026-08-28',
      dataCaliber: 1 as const,
      page: 3,
      pageSize: 20,
      params: { keyword: 'AI' },
    };
    useXiaohongshuDatasetQuery(input);
    const options = mocks.useQuery.mock.calls[0]?.[0];

    expect(options.enabled).toBe(true);
    expect(options.retry).toBe(false);
    await expect(options.queryFn()).resolves.toEqual({ items: [] });
    expect(mocks.post).toHaveBeenCalledWith('/xiaohongshu/datasets/report%2Faccount/query', {
      advertiserId: 'adv-1',
      startDate: '2026-08-01',
      endDate: '2026-08-28',
      dataCaliber: 1,
      page: 3,
      pageSize: 20,
      params: { keyword: 'AI' },
    });

    useXiaohongshuDatasetQuery({ ...input, advertiserId: '' });
    expect(mocks.useQuery.mock.calls[1]?.[0].enabled).toBe(false);
  });
});
