import { Controller, Delete, Get, Headers, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { SessionResponseDto } from './dto/session.dto';
import { SessionsService } from './sessions.service';

@ApiTags('会话管理')
@ApiBearerAuth()
@Controller('sessions')
@AllowAnyAuthenticatedUser()
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: '获取当前用户的所有会话' })
  @ApiResponse({ status: 200, description: '获取成功' })
  async findAll(
    @CurrentUser() user: CurrentUserType,
    @Headers('x-refresh-token') refreshToken?: string
  ): Promise<SessionResponseDto[]> {
    return this.sessionsService.findAllByUserId(user.id, refreshToken);
  }

  @Delete(':id')
  @ApiOperation({ summary: '注销指定会话' })
  @ApiResponse({ status: 200, description: '注销成功' })
  @ApiResponse({ status: 403, description: '不能注销当前会话' })
  @ApiResponse({ status: 404, description: '会话不存在' })
  async deleteOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Headers('x-refresh-token') refreshToken?: string
  ): Promise<{ success: boolean }> {
    return this.sessionsService.deleteSession(id, user.id, refreshToken);
  }

  @Delete()
  @ApiOperation({ summary: '注销所有其他会话' })
  @ApiResponse({ status: 200, description: '注销成功' })
  async deleteOthers(
    @CurrentUser() user: CurrentUserType,
    @Headers('x-refresh-token') refreshToken: string
  ): Promise<{ deletedCount: number }> {
    if (!refreshToken) {
      return { deletedCount: 0 };
    }
    return this.sessionsService.deleteOtherSessions(user.id, refreshToken);
  }
}
