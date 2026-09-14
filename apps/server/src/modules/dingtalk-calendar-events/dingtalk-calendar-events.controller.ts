import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { DingtalkCalendarEventsService } from './dingtalk-calendar-events.service';
import {
  CalendarEventListResponseDto,
  CalendarEventResponseDto,
} from './dto/calendar-event-response.dto';
import { QueryCalendarEventDto } from './dto/query-calendar-event.dto';

@ApiTags('钉钉日程事件')
@ApiBearerAuth()
@Controller('dingtalk-calendar-events')
export class DingtalkCalendarEventsController {
  constructor(private readonly dingtalkCalendarEventsService: DingtalkCalendarEventsService) {}

  @Get()
  @ApiOperation({ summary: '查询日程事件列表' })
  @RequirePermission({ module: 'reports', menu: 'calendar_events', action: 'view' })
  findAll(@Query() query: QueryCalendarEventDto): Promise<CalendarEventListResponseDto> {
    return this.dingtalkCalendarEventsService.findAll(query);
  }

  @Get(':eventId')
  @ApiOperation({ summary: '查询日程事件详情' })
  @RequirePermission({ module: 'reports', menu: 'calendar_events', action: 'view' })
  findOne(@Param('eventId') eventId: string): Promise<CalendarEventResponseDto> {
    return this.dingtalkCalendarEventsService.findOne(eventId);
  }
}
