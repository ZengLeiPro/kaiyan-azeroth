import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';

/**
 * 限流冒烟测试 controller
 *
 * 在生产实例上保留，用于运维线上排查限流行为是否正常（如某 IP 是否被错误纳入限流名单）。
 */
@ApiTags('限流测试')
@ApiBearerAuth()
@Controller('rate-limit-test')
@SkipAudit()
@RequirePermission({ module: 'system', menu: 'system_config', action: 'edit' })
@RequireFreshJwt()
export class RateLimitTestController {
  @Get()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: '限流测试端点（每分钟限 5 次）' })
  test(): { message: string; timestamp: string } {
    return {
      message: '请求成功',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('reset')
  @ApiOperation({ summary: '重置限流状态' })
  reset(): { message: string } {
    return {
      message: '限流状态已重置',
    };
  }
}
