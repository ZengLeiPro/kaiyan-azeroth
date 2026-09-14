import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersController } from './users.controller';
import { USER_FILTER_REGISTRY } from './users.filter-registry';
import { UsersService } from './users.service';

@Module({
  imports: [SessionsModule, FilterSchemesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(USER_FILTER_REGISTRY);
  }
}
