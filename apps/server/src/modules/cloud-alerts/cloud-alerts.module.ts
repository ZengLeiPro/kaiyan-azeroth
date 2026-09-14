import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { CloudAlertsController } from './cloud-alerts.controller';
import { CLOUD_ALERT_FILTER_REGISTRY } from './cloud-alerts.filter-registry';
import { CloudAlertsService } from './cloud-alerts.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [CloudAlertsController],
  providers: [CloudAlertsService],
  exports: [CloudAlertsService],
})
export class CloudAlertsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CLOUD_ALERT_FILTER_REGISTRY);
  }
}
