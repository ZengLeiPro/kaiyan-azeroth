import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { extractClientIp } from '../../common/utils/client-ip.helper';
import { AuthService } from './auth.service';
import { AllowAnyAuthenticatedUser } from './decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginResponseDto, MeResponseDto, RefreshTokenResponseDto } from './dto/auth-response.dto';
import { DingtalkLoginDto } from './dto/dingtalk-login.dto';
import { LoginDto } from './dto/login.dto';
import { ReauthenticateDto } from './dto/reauthenticate.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('认证')
@Controller('auth')
@SkipAudit() // 登录/登出/刷新令牌已通过 LoginLog 单独记录，跳过 OperationLog 避免双写
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @Throttle({
    // P0 fix §2.4: 默认提到 10/min。原值 5 与 LOGIN_FAIL_LOCK_THRESHOLD=5 相等，
    // 第 5 次错误密码请求会被 Throttler 先短路掉，业务层 loginFailCount→5 触发锁定
    // 的代码永远跑不到。10 仍是严密限流（单 IP/分钟），又让锁定路径可达。
    default: { limit: parseInt(process.env.THROTTLE_LOGIN_LIMIT || '10', 10), ttl: 60000 },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户登录' })
  @ApiResponse({ status: 200, description: '登录成功' })
  @ApiResponse({ status: 401, description: '认证失败' })
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string
  ): Promise<LoginResponseDto> {
    return this.authService.login(loginDto, extractClientIp(req) ?? '', userAgent);
  }

  @Post('dingtalk-login')
  @Public()
  @Throttle({
    default: { limit: parseInt(process.env.THROTTLE_DINGTALK_LOGIN_LIMIT || '20', 10), ttl: 60000 },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '钉钉免登/扫码登录' })
  @ApiResponse({ status: 200, description: '登录成功' })
  @ApiResponse({ status: 401, description: '认证失败' })
  async dingtalkLogin(
    @Body() loginDto: DingtalkLoginDto,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string
  ): Promise<LoginResponseDto> {
    return this.authService.dingtalkLogin(loginDto, extractClientIp(req) ?? '', userAgent);
  }

  @Post('refresh')
  @Public()
  @Throttle({
    default: { limit: parseInt(process.env.THROTTLE_REFRESH_LIMIT || '10', 10), ttl: 60000 },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新令牌' })
  @ApiResponse({ status: 200, description: '刷新成功' })
  @ApiResponse({ status: 401, description: '无效的刷新令牌' })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @Post('reauthenticate')
  @Throttle({
    default: { limit: parseInt(process.env.THROTTLE_REAUTH_LIMIT || '10', 10), ttl: 60000 },
  })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '高风险操作前重新认证当前会话' })
  @ApiResponse({ status: 200, description: '重新认证成功' })
  @ApiResponse({ status: 401, description: '当前会话无效' })
  @ApiResponse({ status: 403, description: '当前密码错误' })
  @AllowAnyAuthenticatedUser()
  async reauthenticate(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: ReauthenticateDto,
    @Req() req: Request,
    @Headers('user-agent') userAgent?: string
  ): Promise<RefreshTokenResponseDto> {
    return this.authService.reauthenticate(
      user.id,
      user.sessionId,
      dto.password,
      extractClientIp(req) ?? '',
      userAgent
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '用户登出' })
  @ApiResponse({ status: 200, description: '登出成功' })
  // self-scoped 自助：通过 @CurrentUser 获取当前用户，无需 RBAC 权限项
  @AllowAnyAuthenticatedUser()
  async logout(
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request,
    @Headers('x-refresh-token') refreshToken?: string
  ): Promise<{ message: string }> {
    // push 6: user.id 即 employee.id
    return this.authService.logout(
      user.id,
      extractClientIp(req) ?? '',
      refreshToken,
      user.sessionId
    );
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户最新信息（用于前端启动时刷新缓存）' })
  @ApiResponse({ status: 200, description: '获取成功' })
  // self-scoped 自助：返回当前用户自己的资料，无需 RBAC 权限项
  @AllowAnyAuthenticatedUser()
  async getMe(@CurrentUser() user: CurrentUserType): Promise<MeResponseDto> {
    // push 6: user.id 即 employee.id
    return this.authService.getMe(user.id);
  }
}
