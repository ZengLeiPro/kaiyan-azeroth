import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { InvoicesController } from './invoices.controller';
import { INVOICE_FILTER_REGISTRY } from './invoices.filter-registry';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [ApprovalsModule, FilterSchemesModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(INVOICE_FILTER_REGISTRY);
  }
}
