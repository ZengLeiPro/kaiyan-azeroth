import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { CustomerLifecycleModule } from '../customers/customer-lifecycle.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { KeepRecordsController } from './keep-records.controller';
import { KEEP_RECORD_FILTER_REGISTRY } from './keep-records.filter-registry';
import { KeepRecordsService } from './keep-records.service';

@Module({
  imports: [CustomerLifecycleModule, FilterSchemesModule],
  controllers: [KeepRecordsController],
  providers: [KeepRecordsService],
  exports: [KeepRecordsService],
})
export class KeepRecordsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(KEEP_RECORD_FILTER_REGISTRY);
  }
}
