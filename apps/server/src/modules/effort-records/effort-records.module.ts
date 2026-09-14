import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { EffortRecordsController } from './effort-records.controller';
import { EFFORT_RECORD_FILTER_REGISTRY } from './effort-records.filter-registry';
import { EffortRecordsService } from './effort-records.service';
import { EFFORT_STATS_FILTER_REGISTRY } from './effort-stats.filter-registry';
import { EffortStatsService } from './effort-stats.service';

@Module({
  imports: [FilterSchemesModule, HolidaysModule],
  controllers: [EffortRecordsController],
  providers: [EffortRecordsService, EffortStatsService],
  exports: [EffortRecordsService],
})
export class EffortRecordsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(EFFORT_RECORD_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(EFFORT_STATS_FILTER_REGISTRY);
  }
}
