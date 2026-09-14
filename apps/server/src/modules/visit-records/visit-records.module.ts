import { forwardRef, Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { ApprovalsModule } from '../approvals/approvals.module';
import { CustomersModule } from '../customers/customers.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { UploadModule } from '../upload/upload.module';
import { VisitRecordsController } from './visit-records.controller';
import { VISIT_RECORD_FILTER_REGISTRY } from './visit-records.filter-registry';
import { VisitRecordsService } from './visit-records.service';

@Module({
  imports: [forwardRef(() => CustomersModule), ApprovalsModule, FilterSchemesModule, UploadModule],
  controllers: [VisitRecordsController],
  providers: [VisitRecordsService],
  exports: [VisitRecordsService],
})
export class VisitRecordsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(VISIT_RECORD_FILTER_REGISTRY);
  }
}
