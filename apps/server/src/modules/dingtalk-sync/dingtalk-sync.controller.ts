import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { DingtalkSyncService, ManualSyncResult } from './dingtalk-sync.service';

/**
 * 钉钉手动增量同步接口
 *
 * 给报表页的「同步」按钮调用，走 system.system_config.edit。
 */
@ApiTags('钉钉手动同步')
@ApiBearerAuth()
@Controller('dingtalk-sync')
export class DingtalkSyncController {
  constructor(private readonly service: DingtalkSyncService) {}

  @Post('logs')
  @RequirePermission({ module: 'system', menu: 'system_config', action: 'edit' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '增量同步工作日志' })
  async syncLogs(): Promise<ManualSyncResult> {
    return this.service.runLogsSync();
  }

  @Post('calendar')
  @RequirePermission({ module: 'system', menu: 'system_config', action: 'edit' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '增量同步日历事件' })
  async syncCalendar(): Promise<ManualSyncResult> {
    return this.service.runCalendarSync();
  }
}
