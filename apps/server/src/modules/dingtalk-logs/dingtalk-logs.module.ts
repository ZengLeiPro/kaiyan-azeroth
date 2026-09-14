import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { DingtalkLogsController } from './dingtalk-logs.controller';
import { DINGTALK_LOG_FILTER_REGISTRY } from './dingtalk-logs.filter-registry';
import { DingtalkLogsService } from './dingtalk-logs.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [DingtalkLogsController],
  providers: [DingtalkLogsService],
})
export class DingtalkLogsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(DINGTALK_LOG_FILTER_REGISTRY);
  }
}
