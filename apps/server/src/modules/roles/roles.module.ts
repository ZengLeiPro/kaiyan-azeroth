import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { RolesController } from './roles.controller';
import { ROLE_FILTER_REGISTRY } from './roles.filter-registry';
import { RolesService } from './roles.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(ROLE_FILTER_REGISTRY);
  }
}
