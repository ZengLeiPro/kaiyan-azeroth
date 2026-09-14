import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { SessionsModule } from '../sessions/sessions.module';
import { EmployeesController } from './employees.controller';
import { EMPLOYEE_FILTER_REGISTRY } from './employees.filter-registry';
import { EmployeesService } from './employees.service';

@Module({
  imports: [FilterSchemesModule, SessionsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(EMPLOYEE_FILTER_REGISTRY);
  }
}
