import { XIAOHONGSHU_SCOPES } from '@ky-azeroth/shared/constants';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { XiaohongshuApiClient, XiaohongshuTokenCryptoService } from '../xiaohongshu-core';
import { parseXiaohongshuScopes } from './xiaohongshu-scope.utils';

const AUTHORIZE_URL = 'https://ad-market.xiaohongshu.com/auth';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface XiaohongshuAuthorizationUrlResult {
  authorizationUrl: string;
  expiresAt: string;
}

export interface XiaohongshuConnectedResult {
  status: 'connected';
  message: string;
  connectionId: string;
  advertiserCount: number;
}

@Injectable()
export class XiaohongshuOauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly api: XiaohongshuApiClient,
    private readonly crypto: XiaohongshuTokenCryptoService
  ) {}

  async createAuthorizationUrl(createdBy: string): Promise<XiaohongshuAuthorizationUrlResult> {
    const { appId, publicBaseUrl } = this.requireConfig();
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + STATE_TTL_MS);
    await this.prisma.xiaohongshuOauthState.create({
      data: { stateHash: this.hashState(state), expiresAt, createdBy },
    });

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      appId,
      scope: JSON.stringify(XIAOHONGSHU_SCOPES),
      redirectUri: `${publicBaseUrl.replace(/\/$/, '')}/api/v1/xiaohongshu-oauth/callback`,
      state,
    }).toString();
    return { authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  }

  async handleCallback(authCode: string, state: string): Promise<XiaohongshuConnectedResult> {
    const now = new Date();
    const consumed = await this.prisma.xiaohongshuOauthState.updateMany({
      where: {
        stateHash: this.hashState(state),
        consumedAt: null,
        deletedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException('OAuth state 无效、已过期或已被使用');
    }

    const { appId, appSecret } = this.requireConfig();
    const token = await this.api.exchangeAuthCode(appId, appSecret, authCode);
    const accessTokenExpiresAt = new Date(now.getTime() + token.access_token_expires_in * 1000);
    const refreshTokenExpiresAt = new Date(now.getTime() + token.refresh_token_expires_in * 1000);
    const scopes = parseXiaohongshuScopes(token.scope) ?? [...XIAOHONGSHU_SCOPES];

    const advertisers = token.approval_advertisers ?? [];
    const connection = await this.prisma.$transaction(async (tx) => {
      const savedConnection = await tx.xiaohongshuConnection.upsert({
        where: {
          uniq_xiaohongshu_connection: { appId: String(token.app_id), userId: token.user_id },
        },
        create: {
          appId: String(token.app_id),
          userId: token.user_id,
          roleType: token.role_type,
          approvalRoleType: token.approval_role_type,
          platformType: token.platform_type,
          scopes: toJsonValue(scopes),
          accessTokenCiphertext: this.crypto.encrypt(token.access_token),
          refreshTokenCiphertext: this.crypto.encrypt(token.refresh_token),
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          status: 'active',
          lastError: null,
        },
        update: {
          roleType: token.role_type,
          approvalRoleType: token.approval_role_type,
          platformType: token.platform_type,
          scopes: toJsonValue(scopes),
          accessTokenCiphertext: this.crypto.encrypt(token.access_token),
          refreshTokenCiphertext: this.crypto.encrypt(token.refresh_token),
          accessTokenExpiresAt,
          refreshTokenExpiresAt,
          status: 'active',
          lastRefreshedAt: now,
          lastError: null,
          deletedAt: null,
        },
      });

      const activeAdvertiserIds = advertisers.map((advertiser) => String(advertiser.advertiser_id));
      await tx.xiaohongshuAdvertiser.updateMany({
        where: {
          connectionId: savedConnection.id,
          status: 'active',
          ...(activeAdvertiserIds.length > 0
            ? { advertiserId: { notIn: activeAdvertiserIds } }
            : {}),
        },
        data: { status: 'inactive' },
      });

      await Promise.all(
        advertisers.map((advertiser) =>
          tx.xiaohongshuAdvertiser.upsert({
            where: {
              uniq_xiaohongshu_advertiser: {
                connectionId: savedConnection.id,
                advertiserId: String(advertiser.advertiser_id),
              },
            },
            create: {
              connectionId: savedConnection.id,
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
      return savedConnection;
    });

    return {
      status: 'connected',
      message: '小红书聚光账号授权成功',
      connectionId: connection.id,
      advertiserCount: advertisers.length,
    };
  }

  private requireConfig(): { appId: string; appSecret: string; publicBaseUrl: string } {
    const appId = this.config.get<string>('XIAOHONGSHU_APP_ID');
    const appSecret = this.config.get<string>('XIAOHONGSHU_APP_SECRET');
    const publicBaseUrl = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!appId || !appSecret || !publicBaseUrl || !this.crypto.isConfigured()) {
      throw new ServiceUnavailableException('小红书 OAuth 配置不完整');
    }
    return { appId, appSecret, publicBaseUrl };
  }

  private hashState(state: string): string {
    return createHash('sha256').update(state).digest('hex');
  }
}
