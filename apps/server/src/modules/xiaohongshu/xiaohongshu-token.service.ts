import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { XiaohongshuApiClient, XiaohongshuTokenCryptoService } from '../xiaohongshu-core';
import { parseXiaohongshuScopes } from './xiaohongshu-scope.utils';

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const LEASE_MS = 60 * 1000;
const POLL_TIMEOUT_MS = 35 * 1000;
const POLL_INTERVAL_MS = 250;

@Injectable()
export class XiaohongshuTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly api: XiaohongshuApiClient,
    private readonly crypto: XiaohongshuTokenCryptoService
  ) {}

  async getAccessToken(connectionId: string): Promise<string> {
    const connection = await this.prisma.xiaohongshuConnection.findFirst({
      where: { id: connectionId, deletedAt: null },
    });
    if (!connection || connection.status === 'disabled') {
      throw new UnauthorizedException('小红书连接不可用');
    }

    const now = Date.now();
    if (connection.refreshTokenExpiresAt.getTime() <= now) {
      await this.prisma.xiaohongshuConnection.updateMany({
        where: { id: connectionId, deletedAt: null },
        data: { status: 'expired', lastError: 'refresh token 已过期' },
      });
      throw new UnauthorizedException('小红书授权已过期，请重新授权');
    }
    if (connection.accessTokenExpiresAt.getTime() > now + REFRESH_EARLY_MS) {
      return this.crypto.decrypt(connection.accessTokenCiphertext);
    }
    return this.refreshWithLease(connectionId);
  }

  private async refreshWithLease(connectionId: string): Promise<string> {
    const leaseId = randomUUID();
    const now = new Date();
    const acquired = await this.prisma.xiaohongshuConnection.updateMany({
      where: {
        id: connectionId,
        deletedAt: null,
        OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lt: now } }],
      },
      data: { refreshLeaseId: leaseId, refreshLeaseUntil: new Date(now.getTime() + LEASE_MS) },
    });
    if (acquired.count !== 1) return this.waitForRefresh(connectionId);

    try {
      const current = await this.prisma.xiaohongshuConnection.findFirst({
        where: { id: connectionId, deletedAt: null },
      });
      if (!current) throw new UnauthorizedException('小红书连接不存在');
      if (current.refreshTokenExpiresAt.getTime() <= Date.now()) {
        await this.prisma.xiaohongshuConnection.updateMany({
          where: { id: connectionId, refreshLeaseId: leaseId },
          data: { status: 'expired', lastError: 'refresh token 已过期' },
        });
        throw new UnauthorizedException('小红书授权已过期，请重新授权');
      }

      const appId = this.config.get<string>('XIAOHONGSHU_APP_ID');
      const appSecret = this.config.get<string>('XIAOHONGSHU_APP_SECRET');
      if (!appId || !appSecret) throw new ServiceUnavailableException('小红书 OAuth 配置不完整');

      const token = await this.api.refreshToken(
        appId,
        appSecret,
        this.crypto.decrypt(current.refreshTokenCiphertext)
      );
      const refreshedAt = new Date();
      const updated = await this.prisma.xiaohongshuConnection.updateMany({
        where: { id: connectionId, refreshLeaseId: leaseId, deletedAt: null },
        data: {
          accessTokenCiphertext: this.crypto.encrypt(token.access_token),
          refreshTokenCiphertext: this.crypto.encrypt(token.refresh_token),
          accessTokenExpiresAt: new Date(
            refreshedAt.getTime() + token.access_token_expires_in * 1000
          ),
          refreshTokenExpiresAt: new Date(
            refreshedAt.getTime() + token.refresh_token_expires_in * 1000
          ),
          scopes: toJsonValue(
            parseXiaohongshuScopes(token.scope) ??
              (Array.isArray(current.scopes) ? current.scopes : [])
          ),
          roleType: token.role_type,
          approvalRoleType: token.approval_role_type,
          platformType: token.platform_type,
          status: 'active',
          lastRefreshedAt: refreshedAt,
          lastError: null,
        },
      });
      if (updated.count !== 1) throw new ServiceUnavailableException('小红书 token 刷新租约已失效');

      await this.upsertAdvertisers(connectionId, token.approval_advertisers ?? []);
      return token.access_token;
    } catch (error: unknown) {
      if (!(error instanceof UnauthorizedException)) {
        await this.prisma.xiaohongshuConnection.updateMany({
          where: { id: connectionId, refreshLeaseId: leaseId },
          data: { status: 'error', lastError: this.sanitizeError(error) },
        });
      }
      throw error;
    } finally {
      await this.prisma.xiaohongshuConnection.updateMany({
        where: { id: connectionId, refreshLeaseId: leaseId },
        data: { refreshLeaseId: null, refreshLeaseUntil: null },
      });
    }
  }

  private async waitForRefresh(connectionId: string): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const current = await this.prisma.xiaohongshuConnection.findFirst({
        where: { id: connectionId, deletedAt: null },
      });
      if (!current) throw new UnauthorizedException('小红书连接不存在');
      if (current.status === 'expired') throw new UnauthorizedException('小红书授权已过期');
      if (current.status === 'error' && !current.refreshLeaseId) {
        throw new ServiceUnavailableException('小红书 token 刷新失败，请稍后重试');
      }
      if (
        !current.refreshLeaseId &&
        current.accessTokenExpiresAt.getTime() > Date.now() + REFRESH_EARLY_MS
      ) {
        return this.crypto.decrypt(current.accessTokenCiphertext);
      }
    }
    throw new ServiceUnavailableException('等待小红书 token 刷新超时，请稍后重试');
  }

  private async upsertAdvertisers(
    connectionId: string,
    advertisers: Array<{
      advertiser_id: string | number;
      advertiser_name?: string;
      corporation_name?: string;
      virtual_seller_id?: string;
    }>
  ): Promise<void> {
    await Promise.all(
      advertisers.map((advertiser) =>
        this.prisma.xiaohongshuAdvertiser.upsert({
          where: {
            uniq_xiaohongshu_advertiser: {
              connectionId,
              advertiserId: String(advertiser.advertiser_id),
            },
          },
          create: {
            connectionId,
            advertiserId: String(advertiser.advertiser_id),
            advertiserName:
              advertiser.advertiser_name ??
              advertiser.corporation_name ??
              String(advertiser.advertiser_id),
            corporationName: advertiser.corporation_name,
            virtualSellerId: advertiser.virtual_seller_id,
          },
          update: {
            advertiserName:
              advertiser.advertiser_name ??
              advertiser.corporation_name ??
              String(advertiser.advertiser_id),
            corporationName: advertiser.corporation_name,
            virtualSellerId: advertiser.virtual_seller_id,
            status: 'active',
            deletedAt: null,
          },
        })
      )
    );
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : '小红书 token 刷新失败';
    return message
      .replace(/(?:access|refresh)[_-]?token\s*[:=]\s*\S+/gi, '[credential redacted]')
      .slice(0, 500);
  }
}
