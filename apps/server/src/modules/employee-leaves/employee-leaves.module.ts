import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { EmployeeLeavesController } from './employee-leaves.controller';
import { EMPLOYEE_LEAVE_FILTER_REGISTRY } from './employee-leaves.filter-registry';
import { EmployeeLeavesService } from './employee-leaves.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [EmployeeLeavesController],
  providers: [EmployeeLeavesService],
})
export class EmployeeLeavesModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(EMPLOYEE_LEAVE_FILTER_REGISTRY);
  }
}
