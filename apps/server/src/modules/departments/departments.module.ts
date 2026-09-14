import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { DepartmentsController } from './departments.controller';
import { DEPARTMENT_FILTER_REGISTRY } from './departments.filter-registry';
import { DepartmentsService } from './departments.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
  exports: [DepartmentsService],
})
export class DepartmentsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(DEPARTMENT_FILTER_REGISTRY);
  }
}
