import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectTicketsController } from './project-tickets.controller';
import { PROJECT_TICKET_FILTER_REGISTRY } from './project-tickets.filter-registry';
import { ProjectTicketsService } from './project-tickets.service';

@Module({
  imports: [NotificationsModule, FilterSchemesModule],
  controllers: [ProjectTicketsController],
  providers: [ProjectTicketsService],
  exports: [ProjectTicketsService],
})
export class ProjectTicketsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(PROJECT_TICKET_FILTER_REGISTRY);
  }
}
