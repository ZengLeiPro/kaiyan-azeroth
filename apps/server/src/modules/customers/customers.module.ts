import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { KeepRecordsModule } from '../keep-records/keep-records.module';
import { CustomerAccountsReceivableWatchdog } from './customer-accounts-receivable.watchdog';
import { CustomerLifecycleModule } from './customer-lifecycle.module';
import { CustomersController } from './customers.controller';
import { CUSTOMER_FILTER_REGISTRY } from './customers.filter-registry';
import { CustomersService } from './customers.service';

@Module({
  imports: [FilterSchemesModule, CustomerLifecycleModule, KeepRecordsModule, ApprovalsModule],
  controllers: [CustomersController],
  providers: [CustomersService, PermissionGuard, CustomerAccountsReceivableWatchdog],
  exports: [CustomersService],
})
export class CustomersModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CUSTOMER_FILTER_REGISTRY);
  }
}
