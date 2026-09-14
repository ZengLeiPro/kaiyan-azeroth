import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { ProjectsController } from './projects.controller';
import { PROJECT_FILTER_REGISTRY } from './projects.filter-registry';
import { ProjectsService } from './projects.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(PROJECT_FILTER_REGISTRY);
  }
}
