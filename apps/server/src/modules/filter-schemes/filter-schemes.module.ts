import { Module } from '@nestjs/common';

import { FilterApplierService, FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesController } from './filter-schemes.controller';
import { FilterSchemesService } from './filter-schemes.service';
import { PersonalFilterSchemesService } from './personal-filter-schemes.service';

@Module({
  controllers: [FilterSchemesController],
  providers: [
    FilterSchemeRegistry,
    FilterApplierService,
    FilterSchemesService,
    PersonalFilterSchemesService,
  ],
  exports: [
    FilterSchemeRegistry,
    FilterApplierService,
    FilterSchemesService,
    PersonalFilterSchemesService,
  ],
})
export class FilterSchemesModule {}
