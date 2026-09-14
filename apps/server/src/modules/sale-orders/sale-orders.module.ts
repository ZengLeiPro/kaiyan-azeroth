import { forwardRef, Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CustomersModule } from '../customers/customers.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { SaleOrdersController } from './sale-orders.controller';
import { SALE_ORDER_FILTER_REGISTRY } from './sale-orders.filter-registry';
import { SaleOrdersService } from './sale-orders.service';

@Module({
  imports: [ApprovalsModule, FilterSchemesModule, forwardRef(() => CustomersModule)],
  controllers: [SaleOrdersController],
  providers: [SaleOrdersService],
  exports: [SaleOrdersService],
})
export class SaleOrdersModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(SALE_ORDER_FILTER_REGISTRY);
  }
}
