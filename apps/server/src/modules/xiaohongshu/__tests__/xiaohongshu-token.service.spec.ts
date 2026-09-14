import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { XiaohongshuApiClient, XiaohongshuTokenCryptoService } from '../../xiaohongshu-core';
import { XiaohongshuTokenService } from '../xiaohongshu-token.service';

const future = (milliseconds: number) => new Date(Date.now() + milliseconds);

const createConnection = (overrides: Record<string, unknown> = {}) => ({
  id: 'connection-1',
  status: 'active',
  deletedAt: null,
  accessTokenCiphertext: 'cipher-old-access',
  refreshTokenCiphertext: 'cipher-old-refresh',
  accessTokenExpiresAt: future(60_000),
  refreshTokenExpiresAt: future(86_400_000),
  refreshLeaseId: null,
  refreshLeaseUntil: null,
  scopes: [],
  ...overrides,
});

const createSubject = (
  options: {
    findFirst?: ReturnType<typeof vi.fn>;
    updateMany?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
    refreshToken?: ReturnType<typeof vi.fn>;
    configGet?: ReturnType<typeof vi.fn>;
    decrypt?: ReturnType<typeof vi.fn>;
    encrypt?: ReturnType<typeof vi.fn>;
  } = {}
) => {
  const prisma = {
    xiaohongshuConnection: {
      findFirst: options.findFirst ?? vi.fn().mockResolvedValue(createConnection()),
      updateMany: options.updateMany ?? vi.fn().mockResolvedValue({ count: 1 }),
    },
    xiaohongshuAdvertiser: {
      upsert: options.upsert ?? vi.fn().mockResolvedValue({}),
    },
  };
  const api = {
    refreshToken:
      options.refreshToken ??
      vi.fn().mockResolvedValue({
        access_token: 'new-access',
        access_token_expires_in: 3600,
        refresh_token: 'new-refresh',
        refresh_token_expires_in: 7200,
        scope: 'user_info,advertiser.read advertiser.write',
        role_type: 1,
        approval_role_type: 3,
        platform_type: 2,
        approval_advertisers: [],
      }),
  };
  const crypto = {
    decrypt:
      options.decrypt ??
      vi.fn((value: string) => (value === 'cipher-old-refresh' ? 'old-refresh' : 'old-access')),
    encrypt: options.encrypt ?? vi.fn((value: string) => `cipher-${value}`),
  };
  const config = {
    get: options.configGet ?? vi.fn((key: string) => (key.endsWith('APP_ID') ? '123' : 'secret')),
  };
  const subject = new XiaohongshuTokenService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    api as unknown as XiaohongshuApiClient,
    crypto as unknown as XiaohongshuTokenCryptoService
  );

  return { subject, prisma, api, crypto, config };
};

describe('XiaohongshuTokenService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['不存在', null],
    ['已禁用', createConnection({ status: 'disabled' })],
  ])('拒绝使用%s的连接', async (_label, connection) => {
    const { subject, prisma } = createSubject({
      findFirst: vi.fn().mockResolvedValue(connection),
    });

    await expect(subject.getAccessToken('connection-1')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(prisma.xiaohongshuConnection.updateMany).not.toHaveBeenCalled();
  });

  it('直接解密并返回仍在有效期内的 access token', async () => {
    const connection = createConnection({ accessTokenExpiresAt: future(10 * 60_000) });
    const { subject, api, crypto, prisma } = createSubject({
      findFirst: vi.fn().mockResolvedValue(connection),
    });

    await expect(subject.getAccessToken('connection-1')).resolves.toBe('old-access');
    expect(crypto.decrypt).toHaveBeenCalledWith('cipher-old-access');
    expect(api.refreshToken).not.toHaveBeenCalled();
    expect(prisma.xiaohongshuConnection.updateMany).not.toHaveBeenCalled();
  });

  it('将 refresh token 已过期的连接标记为 expired', async () => {
    const { subject, prisma } = createSubject({
      findFirst: vi
        .fn()
        .mockResolvedValue(createConnection({ refreshTokenExpiresAt: future(-1_000) })),
    });

    await expect(subject.getAccessToken('connection-1')).rejects.toThrow(
      '小红书授权已过期，请重新授权'
    );
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledWith({
      where: { id: 'connection-1', deletedAt: null },
      data: { status: 'expired', lastError: 'refresh token 已过期' },
    });
  });

  it('提前刷新、轮换 token 并同步授权广告主', async () => {
    const connection = createConnection();
    const refreshToken = vi.fn().mockResolvedValue({
      access_token: 'new-access',
      access_token_expires_in: 3600,
      refresh_token: 'new-refresh',
      refresh_token_expires_in: 7200,
      scope: '["report_service","ad_query","ad_manage","account_manage"]',
      role_type: 1,
      approval_role_type: 3,
      platform_type: 2,
      approval_advertisers: [
        {
          advertiser_id: 42,
          corporation_name: '示例科技',
          virtual_seller_id: 'seller-1',
        },
      ],
    });
    const { subject, prisma, api } = createSubject({
      findFirst: vi.fn().mockResolvedValue(connection),
      refreshToken,
    });

    await expect(subject.getAccessToken('connection-1')).resolves.toBe('new-access');
    expect(api.refreshToken).toHaveBeenCalledWith('123', 'secret', 'old-refresh');
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'connection-1', refreshLeaseId: expect.any(String) }),
        data: expect.objectContaining({
          accessTokenCiphertext: 'cipher-new-access',
          refreshTokenCiphertext: 'cipher-new-refresh',
          scopes: ['report_service', 'ad_query', 'ad_manage', 'account_manage'],
          roleType: 1,
          approvalRoleType: 3,
          platformType: 2,
          status: 'active',
          lastError: null,
        }),
      })
    );
    expect(prisma.xiaohongshuAdvertiser.upsert).toHaveBeenCalledWith({
      where: {
        uniq_xiaohongshu_advertiser: {
          connectionId: 'connection-1',
          advertiserId: '42',
        },
      },
      create: expect.objectContaining({
        connectionId: 'connection-1',
        advertiserId: '42',
        advertiserName: '示例科技',
      }),
      update: expect.objectContaining({ advertiserName: '示例科技', status: 'active' }),
    });
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { refreshLeaseId: null, refreshLeaseUntil: null } })
    );
  });

  it('租约竞争失败时等待另一实例刷新完成并返回新 token', async () => {
    vi.useFakeTimers();
    const initial = createConnection({ refreshLeaseId: 'other-lease' });
    const refreshed = createConnection({
      refreshLeaseId: null,
      accessTokenCiphertext: 'cipher-refreshed-access',
      accessTokenExpiresAt: future(60 * 60_000),
    });
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);
    const { subject, prisma, api, crypto } = createSubject({
      findFirst,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      decrypt: vi.fn((value: string) =>
        value === 'cipher-refreshed-access' ? 'refreshed-access' : value
      ),
    });

    const result = subject.getAccessToken('connection-1');
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toBe('refreshed-access');
    expect(crypto.decrypt).toHaveBeenCalledWith('cipher-refreshed-access');
    expect(api.refreshToken).not.toHaveBeenCalled();
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledTimes(1);
  });

  it('等待竞争刷新时把 expired 状态映射为未授权', async () => {
    vi.useFakeTimers();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(createConnection({ refreshLeaseId: 'other-lease' }))
      .mockResolvedValueOnce(createConnection({ status: 'expired', refreshLeaseId: null }));
    const { subject } = createSubject({
      findFirst,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });

    const result = expect(subject.getAccessToken('connection-1')).rejects.toThrow(
      '小红书授权已过期'
    );
    await vi.advanceTimersByTimeAsync(250);

    await result;
  });

  it('等待竞争刷新时把无租约的 error 状态映射为服务不可用', async () => {
    vi.useFakeTimers();
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(createConnection({ refreshLeaseId: 'other-lease' }))
      .mockResolvedValueOnce(createConnection({ status: 'error', refreshLeaseId: null }));
    const { subject } = createSubject({
      findFirst,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    });

    const result = expect(subject.getAccessToken('connection-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
    await vi.advanceTimersByTimeAsync(250);

    await result;
  });

  it('获得租约后再次检查 refresh token 过期并释放租约', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(createConnection())
      .mockResolvedValueOnce(createConnection({ refreshTokenExpiresAt: future(-1_000) }));
    const { subject, prisma, api } = createSubject({ findFirst });

    await expect(subject.getAccessToken('connection-1')).rejects.toThrow(
      '小红书授权已过期，请重新授权'
    );
    expect(api.refreshToken).not.toHaveBeenCalled();
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'expired', lastError: 'refresh token 已过期' } })
    );
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { refreshLeaseId: null, refreshLeaseUntil: null } })
    );
  });

  it('OAuth 配置缺失时记录 error 并释放租约', async () => {
    const { subject, prisma, api } = createSubject({
      configGet: vi.fn().mockReturnValue(undefined),
    });

    await expect(subject.getAccessToken('connection-1')).rejects.toThrow('小红书 OAuth 配置不完整');
    expect(api.refreshToken).not.toHaveBeenCalled();
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'error', lastError: '小红书 OAuth 配置不完整' },
      })
    );
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { refreshLeaseId: null, refreshLeaseUntil: null } })
    );
  });

  it('API 刷新失败时脱敏凭证、记录 error 并原样抛出错误', async () => {
    const apiError = new Error('remote rejected access_token=super-secret');
    const { subject, prisma } = createSubject({
      refreshToken: vi.fn().mockRejectedValue(apiError),
    });

    await expect(subject.getAccessToken('connection-1')).rejects.toBe(apiError);
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'error',
          lastError: 'remote rejected [credential redacted]',
        },
      })
    );
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { refreshLeaseId: null, refreshLeaseUntil: null } })
    );
  });

  it('持久化时租约失效会记录 API 失败状态', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });
    const { subject, prisma } = createSubject({ updateMany });

    await expect(subject.getAccessToken('connection-1')).rejects.toThrow(
      '小红书 token 刷新租约已失效'
    );
    expect(prisma.xiaohongshuConnection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'error', lastError: '小红书 token 刷新租约已失效' },
      })
    );
  });
});
