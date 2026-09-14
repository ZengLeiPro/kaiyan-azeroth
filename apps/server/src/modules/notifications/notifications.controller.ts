import { Controller, Get, Param, Post, Query } from '@nestjs/common';

import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { NotificationListResponseDto } from './dto/notification-response.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@AllowAnyAuthenticatedUser()
@SkipAudit() // 通知已读/未读是高频低价值操作，跳过操作日志记录
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * 获取当前用户的通知列表
   * GET /api/v1/notifications
   */
  @Get()
  findAll(
    @CurrentUser() user: CurrentUserType,
    @Query() query: QueryNotificationDto
  ): Promise<NotificationListResponseDto> {
    return this.notificationsService.findAll({ ...query, employeeId: user.id });
  }

  /**
   * 获取未读通知数量
   * GET /api/v1/notifications/unread-count
   */
  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: CurrentUserType): Promise<{ count: number }> {
    return this.notificationsService.getUnreadCount(user.id);
  }

  /**
   * 标记单条通知为已读
   * POST /api/v1/notifications/:id/read
   */
  @Post(':id/read')
  markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ count: number }> {
    return this.notificationsService.markAsRead(id, user.id);
  }

  /**
   * 标记全部通知为已读
   * POST /api/v1/notifications/read-all
   */
  @Post('read-all')
  markAllAsRead(@CurrentUser() user: CurrentUserType): Promise<{ message: string; count: number }> {
    return this.notificationsService.markAllAsRead(user.id);
  }
}
