import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { DingtalkCalendarEventsController } from './dingtalk-calendar-events.controller';
import { DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY } from './dingtalk-calendar-events.filter-registry';
import { DingtalkCalendarEventsService } from './dingtalk-calendar-events.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [DingtalkCalendarEventsController],
  providers: [DingtalkCalendarEventsService],
})
export class DingtalkCalendarEventsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY);
  }
}
