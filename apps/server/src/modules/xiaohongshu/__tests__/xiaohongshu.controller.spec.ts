import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMISSION_KEY } from '../../auth/decorators/require-permission.decorator';
import { XiaohongshuController } from '../xiaohongshu.controller';

describe('XiaohongshuController', () => {
  const service = {
    getConnection: vi.fn(),
    getAdvertisers: vi.fn(),
    getReports: vi.fn(),
    getSummary: vi.fn(),
    getTrend: vi.fn(),
    getRanking: vi.fn(),
    getSyncRuns: vi.fn(),
    getLatestSyncRun: vi.fn(),
    getSyncRun: vi.fn(),
    triggerSync: vi.fn(),
  };
  const datasets = {
    getCatalog: vi.fn(),
    getDefinition: vi.fn(),
    query: vi.fn(),
  };
  const controller = new XiaohongshuController(service as never, datasets as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('通过角色权限控制小红书聚光页面访问', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, XiaohongshuController)).toEqual({
      module: 'analytics',
      menu: 'xiaohongshu',
      action: 'view',
    });
  });

  it('返回连接状态服务的结果', async () => {
    const result = { connected: true };
    service.getConnection.mockResolvedValue(result);

    await expect(controller.getConnection()).resolves.toBe(result);
    expect(service.getConnection).toHaveBeenCalledOnce();
  });

  it('返回广告主服务的结果', async () => {
    const result = [{ advertiserId: 'advertiser-1' }];
    service.getAdvertisers.mockResolvedValue(result);

    await expect(controller.getAdvertisers()).resolves.toBe(result);
    expect(service.getAdvertisers).toHaveBeenCalledOnce();
  });

  it('返回数据能力目录、单项契约并转发受控数据集查询', async () => {
    const catalog = { datasets: [], scopes: [], connected: true };
    const catalogQuery = { advertiserId: 'advertiser-1' };
    const definition = { id: 'account.budget', parameters: [] };
    const query = { advertiserId: 'advertiser-1', page: 1, pageSize: 50 };
    const result = { dataset: definition, items: [] };
    datasets.getCatalog.mockResolvedValue(catalog);
    datasets.getDefinition.mockResolvedValue(definition);
    datasets.query.mockResolvedValue(result);

    await expect(controller.getDatasets(catalogQuery as never)).resolves.toBe(catalog);
    await expect(controller.getDataset('account.budget', catalogQuery as never)).resolves.toBe(
      definition
    );
    await expect(controller.queryDataset('account.budget', query as never)).resolves.toBe(result);
    expect(datasets.getCatalog).toHaveBeenCalledWith(catalogQuery);
    expect(datasets.getDefinition).toHaveBeenCalledWith('account.budget', catalogQuery);
    expect(datasets.query).toHaveBeenCalledWith('account.budget', query);
  });

  it('把日报查询参数转发给服务并返回原结果', async () => {
    const query = { page: 2, pageSize: 20 };
    const result = { items: [], total: 0, page: 2, pageSize: 20 };
    service.getReports.mockResolvedValue(result);

    await expect(controller.getReports(query as never)).resolves.toBe(result);
    expect(service.getReports).toHaveBeenCalledWith(query);
  });

  it('把汇总查询参数转发给服务并返回原结果', async () => {
    const query = { advertiserId: 'advertiser-1', startDate: '2026-08-01' };
    const result = { spend: 100 };
    service.getSummary.mockResolvedValue(result);

    await expect(controller.getSummary(query as never)).resolves.toBe(result);
    expect(service.getSummary).toHaveBeenCalledWith(query);
  });

  it('把趋势查询参数转发给服务并返回原结果', async () => {
    const query = { advertiserId: 'advertiser-1', granularity: 'day' };
    const result = { points: [] };
    service.getTrend.mockResolvedValue(result);

    await expect(controller.getTrend(query as never)).resolves.toBe(result);
    expect(service.getTrend).toHaveBeenCalledWith(query);
  });

  it('把排名查询参数转发给服务并返回原结果', async () => {
    const query = { advertiserId: 'advertiser-1', metric: 'spend' };
    const result = { items: [] };
    service.getRanking.mockResolvedValue(result);

    await expect(controller.getRanking(query as never)).resolves.toBe(result);
    expect(service.getRanking).toHaveBeenCalledWith(query);
  });

  it('把同步运行查询参数转发给服务并返回原结果', async () => {
    const query = { page: 1, pageSize: 10, status: 'success' };
    const result = { items: [], total: 0, page: 1, pageSize: 10 };
    service.getSyncRuns.mockResolvedValue(result);

    await expect(controller.getSyncRuns(query as never)).resolves.toBe(result);
    expect(service.getSyncRuns).toHaveBeenCalledWith(query);
  });

  it('返回最新同步运行服务的结果', async () => {
    const result = { id: 'sync-run-latest' };
    const query = { advertiserId: 'adv-1' };
    service.getLatestSyncRun.mockResolvedValue(result);

    await expect(controller.getLatestSyncRun(query as never)).resolves.toBe(result);
    expect(service.getLatestSyncRun).toHaveBeenCalledWith('adv-1');
  });

  it('把同步运行 ID 转发给服务并返回原结果', async () => {
    const result = { id: 'sync-run-1', details: [] };
    service.getSyncRun.mockResolvedValue(result);

    await expect(controller.getSyncRun('sync-run-1')).resolves.toBe(result);
    expect(service.getSyncRun).toHaveBeenCalledWith('sync-run-1');
  });

  it('手动触发同步时转发输入、触发来源和当前用户 ID，并返回原结果', async () => {
    const input = { advertiserIds: ['advertiser-1'] };
    const user = { id: 'user-1', roles: ['SUPER_ADMIN'] };
    const result = { runId: 'sync-run-1', status: 'queued' };
    service.triggerSync.mockResolvedValue(result);

    await expect(controller.triggerSync(input as never, user as never)).resolves.toBe(result);
    expect(service.triggerSync).toHaveBeenCalledWith(input, 'manual', 'user-1');
  });
});
