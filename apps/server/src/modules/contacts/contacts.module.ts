import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { ContactsController } from './contacts.controller';
import { CONTACT_FILTER_REGISTRY } from './contacts.filter-registry';
import { ContactsService } from './contacts.service';

@Module({
  imports: [FilterSchemesModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(CONTACT_FILTER_REGISTRY);
  }
}
