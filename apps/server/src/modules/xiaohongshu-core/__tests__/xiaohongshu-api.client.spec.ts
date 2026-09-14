import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { XiaohongshuApiClient, XiaohongshuApiError } from '../xiaohongshu-api.client';

function createClient(
  post: ReturnType<typeof vi.fn>,
  request: ReturnType<typeof vi.fn> = vi.fn()
): XiaohongshuApiClient {
  vi.spyOn(axios, 'create').mockReturnValue({ post, request } as never);
  return new XiaohongshuApiClient({ get: () => undefined } as unknown as ConfigService);
}

const oauthData = {
  access_token: 'access-secret',
  access_token_expires_in: 86_399,
  refresh_token: 'refresh-secret',
  refresh_token_expires_in: 2_591_999,
  user_id: 'user-1',
  app_id: 12_597,
  role_type: 1,
  platform_type: 1,
  approval_advertisers: [{ advertiser_id: 123, advertiser_name: '测试账户' }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('XiaohongshuApiClient', () => {
  it('交换授权码并返回 OAuth 数据', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { code: 0, success: true, msg: '成功', data: oauthData },
    });
    const client = createClient(post);

    await expect(client.exchangeAuthCode('12597', 'app-secret', 'auth-code')).resolves.toEqual(
      oauthData
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('token 业务错误不重试且错误不暴露敏感入参', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { code: 410014, success: false, msg: '授权码错误', data: null, request_id: 'req-1' },
    });
    const client = createClient(post);

    await expect(client.exchangeAuthCode('12597', 'app-secret', 'auth-code')).rejects.toMatchObject(
      {
        name: 'XiaohongshuApiError',
        code: 410014,
        requestId: 'req-1',
      }
    );
    expect(post).toHaveBeenCalledTimes(1);

    try {
      await client.exchangeAuthCode('12597', 'app-secret', 'auth-code');
    } catch (error: unknown) {
      expect(String(error)).not.toContain('app-secret');
      expect(String(error)).not.toContain('auth-code');
    }
  });

  it('报表业务限流后重试并成功', async () => {
    vi.useFakeTimers();
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: { code: 410029, success: false, msg: '频控', data: null, request_id: 'req-rate' },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          success: true,
          msg: '成功',
          data: { data_list: [{ time: '2026-08-20', fee: '1.00' }], total_count: 1 },
        },
      });
    const client = createClient(post);
    const pending = client.fetchOfflineReport('access-secret', 'account', {
      advertiser_id: '123',
      start_date: '2026-08-20',
      end_date: '2026-08-20',
      time_unit: 'DAY',
    });

    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ total_count: 1 });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('笔记离线报表使用官方 note 路径', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { code: 0, success: true, msg: '成功', data: { data_list: [], total_count: 0 } },
    });
    const client = createClient(post);

    await client.fetchOfflineReport('access-secret', 'note', {
      advertiser_id: '123',
      start_date: '2026-08-20',
      end_date: '2026-08-20',
    });

    expect(post).toHaveBeenCalledWith(
      '/api/open/jg/data/report/offline/note',
      expect.objectContaining({ advertiser_id: '123' }),
      { headers: { 'Access-Token': 'access-secret' } }
    );
  });

  it('note list 使用官方路径、完整请求与报表同款重试', async () => {
    vi.useFakeTimers();
    const post = vi
      .fn()
      .mockResolvedValueOnce({
        data: { code: 410029, success: false, msg: '频控', data: null, request_id: 'req-note' },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          success: true,
          msg: '成功',
          data: { total: 1, notes: [{ note_id: 'note-1', title: '新品' }] },
        },
      });
    const client = createClient(post);
    const request = {
      advertiser_id: '123',
      note_type: 1 as const,
      keyword: 'note-1,note-2',
      page: 1,
      page_size: 100,
      base_only: false,
    };

    const pending = client.fetchNoteList('access-secret', request);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({
      total: 1,
      notes: [{ note_id: 'note-1', title: '新品' }],
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, '/api/open/jg/note/list', request, {
      headers: { 'Access-Token': 'access-secret' },
    });
  });

  it('通用只读查询支持 POST、GET 与根级成功载荷，并保留 request_id', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          code: 0,
          success: true,
          msg: '成功',
          request_id: 'req-post',
          data: { campaigns: [{ campaign_id: 'campaign-1' }] },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          success: true,
          msg: '成功',
          request_id: 'req-get',
          page: 1,
          total_data: { fee: 12 },
        },
      });
    const client = createClient(vi.fn(), request);

    await expect(
      client.fetchReadData('access-secret', '/api/open/jg/campaign/list', 'POST', {
        advertiser_id: '123',
      })
    ).resolves.toEqual({
      data: { campaigns: [{ campaign_id: 'campaign-1' }] },
      requestId: 'req-post',
    });
    await expect(
      client.fetchReadData('access-secret', '/api/open/jg/direct-link/list', 'GET', {
        advertiser_id: '123',
      })
    ).resolves.toEqual({
      data: { page: 1, total_data: { fee: 12 } },
      requestId: 'req-get',
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      url: '/api/open/jg/campaign/list',
      method: 'POST',
      data: { advertiser_id: '123' },
      headers: { 'Access-Token': 'access-secret' },
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      url: '/api/open/jg/direct-link/list',
      method: 'GET',
      params: { advertiser_id: '123' },
      headers: { 'Access-Token': 'access-secret' },
    });
  });

  it('HTTP 错误转换为脱敏 typed error', async () => {
    const axiosError = Object.assign(new Error('request body contains access-secret'), {
      isAxiosError: true,
      response: { status: 503, data: { code: 500001, request_id: 'req-http' } },
    });
    vi.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    const post = vi.fn().mockRejectedValue(axiosError);
    const client = createClient(post);

    await expect(client.refreshToken('12597', 'app-secret', 'refresh-secret')).rejects.toEqual(
      expect.objectContaining<XiaohongshuApiError>({
        name: 'XiaohongshuApiError',
        message: 'Xiaohongshu API request failed',
        code: 500001,
        requestId: 'req-http',
        httpStatus: 503,
      })
    );
  });
});
