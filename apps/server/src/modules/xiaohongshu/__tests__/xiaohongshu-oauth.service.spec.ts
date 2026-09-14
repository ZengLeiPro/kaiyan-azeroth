import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { XiaohongshuApiClient, XiaohongshuTokenCryptoService } from '../../xiaohongshu-core';
import { XiaohongshuOauthService } from '../xiaohongshu-oauth.service';

function createSubject(stateCount = 1) {
  const prisma = {
    xiaohongshuOauthState: {
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: stateCount }),
    },
    xiaohongshuConnection: {
      upsert: vi.fn().mockResolvedValue({ id: 'connection-1' }),
    },
    xiaohongshuAdvertiser: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)
  );
  const config = {
    get: vi.fn(
      (key: string) =>
        ({
          XIAOHONGSHU_APP_ID: '123',
          XIAOHONGSHU_APP_SECRET: 'secret-value',
          PUBLIC_API_BASE_URL: 'https://api.example.com/base',
        })[key]
    ),
  };
  const api = {
    exchangeAuthCode: vi.fn().mockResolvedValue({
      access_token: 'access-secret',
      access_token_expires_in: 3600,
      refresh_token: 'refresh-secret',
      refresh_token_expires_in: 7200,
      user_id: 'user-1',
      app_id: '123',
      role_type: 1,
      platform_type: 2,
      scope: '["report_service","ad_query","ad_manage","account_manage"]',
      approval_advertisers: [{ advertiser_id: 'adv-1', advertiser_name: '广告主' }],
    }),
  };
  const crypto = {
    isConfigured: vi.fn().mockReturnValue(true),
    encrypt: vi.fn((value: string) => `encrypted:${value}`),
  };
  const subject = new XiaohongshuOauthService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    api as unknown as XiaohongshuApiClient,
    crypto as unknown as XiaohongshuTokenCryptoService
  );
  return { subject, prisma, api };
}

describe('XiaohongshuOauthService', () => {
  it('生成正确编码 URL 且数据库只存 state hash', async () => {
    const { subject, prisma } = createSubject();
    const result = await subject.createAuthorizationUrl('employee-1');
    const url = new URL(result.authorizationUrl);
    const state = url.searchParams.get('state');

    expect(url.origin + url.pathname).toBe('https://ad-market.xiaohongshu.com/auth');
    expect(url.searchParams.get('appId')).toBe('123');
    expect(url.searchParams.get('redirectUri')).toBe(
      'https://api.example.com/base/api/v1/xiaohongshu-oauth/callback'
    );
    expect(JSON.parse(url.searchParams.get('scope') ?? '[]')).toEqual([
      'report_service',
      'ad_query',
      'ad_manage',
      'account_manage',
    ]);
    expect(state).toHaveLength(43);
    expect(prisma.xiaohongshuOauthState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        stateHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        createdBy: 'employee-1',
      }),
    });
    expect(JSON.stringify(prisma.xiaohongshuOauthState.create.mock.calls)).not.toContain(
      `"${state}"`
    );
  });

  it('原子消费 state 并完成连接', async () => {
    const { subject, prisma, api } = createSubject();
    const result = await subject.handleCallback('auth-code', 'state-value');
    expect(prisma.xiaohongshuOauthState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ consumedAt: null, deletedAt: null }),
      })
    );
    expect(api.exchangeAuthCode).toHaveBeenCalledWith('123', 'secret-value', 'auth-code');
    expect(prisma.xiaohongshuConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          scopes: ['report_service', 'ad_query', 'ad_manage', 'account_manage'],
        }),
        update: expect.objectContaining({
          scopes: ['report_service', 'ad_query', 'ad_manage', 'account_manage'],
        }),
      })
    );
    expect(result).toEqual({
      status: 'connected',
      message: '小红书聚光账号授权成功',
      connectionId: 'connection-1',
      advertiserCount: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/access-secret|refresh-secret|auth-code/);
  });

  it('拒绝重放 state', async () => {
    const { subject, api } = createSubject(0);
    await expect(subject.handleCallback('auth-code', 'state-value')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(api.exchangeAuthCode).not.toHaveBeenCalled();
  });
});
