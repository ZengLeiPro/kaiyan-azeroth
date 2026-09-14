import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { CrmWorkDailiesController } from './crm-work-dailies.controller';
import { CRM_WORK_DAILY_FILTER_REGISTRY } from './crm-work-dailies.filter-registry';
import { CrmWorkDailiesService } from './crm-work-dailies.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [CrmWorkDailiesController],
  providers: [CrmWorkDailiesService],
  exports: [CrmWorkDailiesService],
})
export class CrmWorkDailiesModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CRM_WORK_DAILY_FILTER_REGISTRY);
  }
}
