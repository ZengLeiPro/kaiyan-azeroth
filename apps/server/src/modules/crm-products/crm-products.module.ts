import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { CrmProductsController } from './crm-products.controller';
import { CRM_PRODUCT_FILTER_REGISTRY } from './crm-products.filter-registry';
import { CrmProductsService } from './crm-products.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [CrmProductsController],
  providers: [CrmProductsService],
  exports: [CrmProductsService],
})
export class CrmProductsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CRM_PRODUCT_FILTER_REGISTRY);
  }
}
