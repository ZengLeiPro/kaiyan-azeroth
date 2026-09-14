import { BadRequestException, Controller, Get, Header, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  XiaohongshuAuthorizationUrlResult,
  XiaohongshuConnectedResult,
  XiaohongshuOauthService,
} from '../xiaohongshu/xiaohongshu-oauth.service';
import { XiaohongshuOauthCallbackDto } from './dto/xiaohongshu-oauth-callback.dto';

export interface XiaohongshuOauthReadyResponse {
  status: 'ready';
  message: string;
}

@ApiTags('小红书 OAuth')
@Controller('xiaohongshu-oauth')
export class XiaohongshuOauthController {
  constructor(private readonly oauth: XiaohongshuOauthService) {}

  @Post('authorization-url')
  @ApiBearerAuth()
  @RequirePermission({ module: 'analytics', menu: 'xiaohongshu', action: 'edit' })
  @RequireFreshJwt()
  @ApiOperation({ summary: '生成小红书聚光 OAuth 授权地址' })
  createAuthorizationUrl(
    @CurrentUser() user: CurrentUserType
  ): Promise<XiaohongshuAuthorizationUrlResult> {
    return this.oauth.createAuthorizationUrl(user.id);
  }

  @Get('callback')
  @Public()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: '接收小红书聚光 OAuth 授权回调' })
  @ApiResponse({ status: 200, description: '回调地址可用或账号连接成功' })
  callback(
    @Query() query: XiaohongshuOauthCallbackDto
  ): XiaohongshuOauthReadyResponse | Promise<XiaohongshuConnectedResult> {
    if (!query.auth_code && !query.state) {
      return { status: 'ready', message: '小红书 OAuth 回调地址已就绪' };
    }
    if (!query.auth_code || !query.state) {
      throw new BadRequestException('auth_code 与 state 必须同时提供');
    }
    return this.oauth.handleCallback(query.auth_code, query.state);
  }
}
