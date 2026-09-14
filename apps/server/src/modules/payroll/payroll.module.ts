import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { UploadModule } from '../upload/upload.module';
import { PayrollController } from './payroll.controller';
import { PAYROLL_FILTER_REGISTRY } from './payroll.filter-registry';
import { PayrollService } from './payroll.service';
import { PayrollImportService } from './services/payroll-import.service';

@Module({
  imports: [FilterSchemesModule, UploadModule],
  controllers: [PayrollController],
  providers: [PayrollService, PayrollImportService],
  exports: [PayrollService, PayrollImportService],
})
export class PayrollModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(PAYROLL_FILTER_REGISTRY);
  }
}
