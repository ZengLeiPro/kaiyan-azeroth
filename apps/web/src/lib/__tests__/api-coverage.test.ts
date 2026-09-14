import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  batchDelete,
  batchImport,
  buildEntityVersionMap,
  getBaseURL,
  getErrorMessage,
} from '../api';

const authMock = vi.hoisted(() => ({
  state: {
    accessToken: null as string | null,
    refreshToken: null as string | null,
    applyRefreshResponse: vi.fn(
      (expected: string, data: unknown): 'applied' | 'stale' | 'invalid' => {
        void expected;
        void data;
        return 'invalid';
      }
    ),
    setTokens: vi.fn(),
    logout: vi.fn(),
  },
  rehydrate: vi.fn(async () => undefined),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: {
    getState: () => authMock.state,
    persist: { rehydrate: authMock.rehydrate },
  },
}));

vi.mock('@/stores/network-error', () => ({
  clearNetworkError: vi.fn(),
  isNetworkError: vi.fn(() => false),
  setNetworkError: vi.fn(),
}));

vi.mock('@/stores/rate-limit', () => ({
  setRateLimitError: vi.fn(),
}));

describe('api helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authMock.state.accessToken = null;
    authMock.state.refreshToken = null;
    authMock.state.applyRefreshResponse.mockReset();
    authMock.state.applyRefreshResponse.mockReturnValue('invalid');
    authMock.state.logout.mockReset();
    authMock.rehydrate.mockReset();
    authMock.rehydrate.mockResolvedValue(undefined);
  });

  it('getBaseURL 会补齐 /api/v1 且保留已标准化地址', () => {
    expect(getBaseURL()).toBe('/api/v1');
  });

  it('getErrorMessage 优先读取 axios response message，其次使用 Error 和 fallback', () => {
    const axiosError = new axios.AxiosError('原始错误', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
      data: { message: '后端消息' },
    });

    expect(getErrorMessage(axiosError)).toBe('后端消息');

    const tracedAxiosError = new axios.AxiosError(
      '原始错误',
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {},
        config: {} as never,
        data: { message: '服务器内部错误', traceId: 'server-trace-500' },
      }
    );
    expect(getErrorMessage(tracedAxiosError)).toBe('服务器内部错误（追踪号：server-trace-500）');
    expect(getErrorMessage(new Error('普通错误'))).toBe('普通错误');
    expect(getErrorMessage('bad', '兜底')).toBe('兜底');
  });

  it('batchImport 优先使用批量接口并上报完整进度', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      data: { success: 2, failed: 0, errors: [] },
    });
    const onProgress = vi.fn();

    const result = await batchImport('/customers', [{ name: 'A' }, { name: 'B' }], { onProgress });

    expect(postSpy).toHaveBeenCalledWith('/customers/batch', {
      items: [{ name: 'A' }, { name: 'B' }],
    });
    expect(result).toEqual({ success: 2, failed: 0, errors: [] });
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it('buildEntityVersionMap 只提取实体真实的正整数 version', () => {
    expect(
      buildEntityVersionMap([
        { id: 'p1', version: 3 },
        { id: 'p2', version: 8 },
        { id: 'missing' },
        { id: 'zero', version: 0 },
      ])
    ).toEqual({ p1: 3, p2: 8 });
  });

  it('batchDelete 空列表直接返回零结果；批量接口成功时返回后端统计', async () => {
    await expect(batchDelete('/customers', [])).resolves.toEqual({
      success: 0,
      failed: 0,
      errors: [],
    });

    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValueOnce({
      data: { success: 1, failed: 1, errors: [{ id: 'c2', error: 'locked' }] },
    });
    const onProgress = vi.fn();

    await expect(batchDelete('/customers', ['c1', 'c2'], { onProgress })).resolves.toEqual({
      success: 1,
      failed: 1,
      errors: [{ id: 'c2', error: 'locked' }],
    });
    expect(deleteSpy).toHaveBeenCalledWith('/customers/batch', { data: { ids: ['c1', 'c2'] } });
    expect(onProgress).toHaveBeenCalledWith(2, 2);
  });

  it('payroll batchDelete 请求标准 DELETE /batch 并携带选中行真实 versions', async () => {
    const deleteSpy = vi.spyOn(api, 'delete').mockResolvedValueOnce({
      data: { success: 2, failed: 0, errors: [] },
    });

    await batchDelete('/payroll', ['payroll-1', 'payroll-2'], {
      versions: { 'payroll-1': 3, 'payroll-2': 8 },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/payroll/batch', {
      data: {
        ids: ['payroll-1', 'payroll-2'],
        versions: { 'payroll-1': 3, 'payroll-2': 8 },
      },
    });
  });

  it('batchDelete 将后端 skipped 计入失败统计', async () => {
    vi.spyOn(api, 'delete').mockResolvedValueOnce({
      data: { success: 1, skipped: ['c2'] },
    });

    await expect(batchDelete('/customers', ['c1', 'c2'])).resolves.toEqual({
      success: 1,
      failed: 1,
      errors: [{ id: 'c2', error: '该记录当前不可删除' }],
    });
  });

  it('401 刷新成功后只用 store 中提交的新代际重试原请求', async () => {
    authMock.state.accessToken = 'access-old';
    authMock.state.refreshToken = 'refresh-old';
    authMock.state.applyRefreshResponse.mockImplementation(() => {
      authMock.state.accessToken = 'access-new';
      authMock.state.refreshToken = 'refresh-new';
      return 'applied';
    });
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'ignored' } });
    const originalAdapter = api.defaults.adapter;
    let attempts = 0;
    const adapter = vi.fn(async (config) => {
      attempts++;
      if (attempts === 1) {
        throw new axios.AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: {},
        });
      }
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    });
    api.defaults.adapter = adapter;

    try {
      await expect(api.get('/protected')).resolves.toMatchObject({ data: { ok: true } });
      expect(refresh).toHaveBeenCalledWith('/api/v1/auth/refresh', {
        refreshToken: 'refresh-old',
      });
      expect(authMock.state.applyRefreshResponse).toHaveBeenCalledWith('refresh-old', {
        accessToken: 'ignored',
      });
      expect(adapter).toHaveBeenCalledTimes(2);
      expect(adapter.mock.calls[1]![0].headers.Authorization).toBe('Bearer access-new');
      expect(authMock.state.logout).not.toHaveBeenCalled();
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });

  it('取得轮换锁后若发现其他标签页已提交新代际则跳过旧 refresh', async () => {
    authMock.state.accessToken = 'access-old';
    authMock.state.refreshToken = 'refresh-old';
    authMock.rehydrate.mockImplementationOnce(async () => {
      authMock.state.accessToken = 'access-new';
      authMock.state.refreshToken = 'refresh-new';
    });
    const refresh = vi.spyOn(axios, 'post');
    const originalAdapter = api.defaults.adapter;
    let attempts = 0;
    const adapter = vi.fn(async (config) => {
      attempts++;
      if (attempts === 1) {
        throw new axios.AxiosError('unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config,
          data: {},
        });
      }
      return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
    });
    api.defaults.adapter = adapter;

    try {
      await expect(api.get('/protected')).resolves.toMatchObject({ data: { ok: true } });
      expect(refresh).not.toHaveBeenCalled();
      expect(adapter.mock.calls[1]![0].headers.Authorization).toBe('Bearer access-new');
      expect(authMock.state.logout).not.toHaveBeenCalled();
    } finally {
      api.defaults.adapter = originalAdapter;
    }
  });
});
