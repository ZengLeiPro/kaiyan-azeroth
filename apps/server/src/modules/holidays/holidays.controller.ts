import { Body, Controller, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';

import { CurrentUser, type CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  HolidayListResponseDto,
  HolidayYearResponseDto,
  PublishHolidaysDto,
  QueryHolidayDto,
  QueryWorkCalendarDto,
  WorkCalendarResponseDto,
} from './dto';
import { HolidaysService } from './holidays.service';

@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get()
  @RequirePermission({ module: 'system', menu: 'holidays', action: 'view' })
  findByYear(@Query() query: QueryHolidayDto): Promise<HolidayListResponseDto> {
    return this.holidaysService.findByYear(query.year, query.page, query.pageSize);
  }

  @Get('calendar')
  @RequirePermission({ module: 'system', menu: 'holidays', action: 'view' })
  getCalendar(@Query() query: QueryWorkCalendarDto): Promise<WorkCalendarResponseDto> {
    return this.holidaysService.getCalendar(query.startDate, query.endDate);
  }

  /**
   * 业务模块通用的工作日历查询。
   *
   * 与 `GET /holidays/calendar` 返回完全一致的结构，差别只在权限：
   * 此路由挂在 `projects/effort_records/view` 之下，所有需要填报工时的员工都可访问，
   * 避免为「明日计划顺延」等业务功能强行下发 `system/holidays/view` 这种管理员菜单权限。
   *
   * 命名为 `work-dates` 而非复用 `calendar`，避免日后 `calendar` 接口扩展管理员视角字段
   * 时把员工通道一起污染。
   */
  @Get('work-dates')
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'view' })
  getWorkDates(@Query() query: QueryWorkCalendarDto): Promise<WorkCalendarResponseDto> {
    return this.holidaysService.getCalendar(query.startDate, query.endDate);
  }

  @Put('year/:year')
  @RequirePermission({ module: 'system', menu: 'holidays', action: 'edit' })
  publish(
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: PublishHolidaysDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<HolidayYearResponseDto> {
    return this.holidaysService.publishYear(year, dto, user);
  }
}
