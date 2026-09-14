import { Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { NotificationsController } from './notifications.controller';
import { NOTIFICATION_FILTER_REGISTRY } from './notifications.filter-registry';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, FilterSchemesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(NOTIFICATION_FILTER_REGISTRY);
  }
}
