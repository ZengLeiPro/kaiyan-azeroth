import { forwardRef, Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { CustomersModule } from '../customers/customers.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { OpportunitiesController } from './opportunities.controller';
import { OPPORTUNITY_FILTER_REGISTRY } from './opportunities.filter-registry';
import { OpportunitiesService } from './opportunities.service';

@Module({
  imports: [forwardRef(() => CustomersModule), FilterSchemesModule],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(OPPORTUNITY_FILTER_REGISTRY);
  }
}
