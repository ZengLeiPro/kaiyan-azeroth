import { Global, Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { CrmChangeLogService } from './crm-change-log.service';
import { LoginLogsController, OperationLogsController } from './operation-logs.controller';
import {
  LOGIN_LOG_FILTER_REGISTRY,
  OPERATION_LOG_FILTER_REGISTRY,
} from './operation-logs.filter-registry';
import { OperationLogsService } from './operation-logs.service';

@Global()
@Module({
  imports: [PrismaModule, FilterSchemesModule],
  controllers: [OperationLogsController, LoginLogsController],
  providers: [OperationLogsService, CrmChangeLogService],
  exports: [OperationLogsService, CrmChangeLogService],
})
export class OperationLogsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(OPERATION_LOG_FILTER_REGISTRY);
    this.filterSchemeRegistry.register(LOGIN_LOG_FILTER_REGISTRY);
  }
}
