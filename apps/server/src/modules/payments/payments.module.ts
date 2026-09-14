import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { FinanceModule } from '../finance/finance.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PaymentsController } from './payments.controller';
import { PAYMENT_FILTER_REGISTRY } from './payments.filter-registry';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ApprovalsModule, FilterSchemesModule, InvoicesModule, FinanceModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(PAYMENT_FILTER_REGISTRY);
  }
}
