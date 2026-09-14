import { forwardRef, Module, OnModuleInit } from '@nestjs/common';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { FilterSchemesModule } from '../filter-schemes/filter-schemes.module';
import { KeepRecordsModule } from '../keep-records/keep-records.module';
import { SalesActionItemsController } from './sales-action-items.controller';
import { SALES_ACTION_ITEMS_FILTER_REGISTRY } from './sales-action-items.filter-registry';
import { SalesActionItemsService } from './sales-action-items.service';

/**
 * 销售数据待办/作战项模块（销售数据闭环系统）。
 * 导入 KeepRecordsModule 以在 adopt/undo 复用 KeepRecordsService（同套校验、不绕业务规则）。
 * DataScopeService / PrismaService 来自 @Global 模块，无需显式 import。
 * exports SalesActionItemsService 便于夜间 cron（经 CLI/服务令牌）复用 upsertCandidate。
 */
@Module({
  imports: [forwardRef(() => KeepRecordsModule), FilterSchemesModule],
  controllers: [SalesActionItemsController],
  providers: [SalesActionItemsService],
  exports: [SalesActionItemsService],
})
export class SalesActionItemsModule implements OnModuleInit {
  constructor(private readonly filterSchemeRegistry: FilterSchemeRegistry) {}

  onModuleInit(): void {
    this.filterSchemeRegistry.register(SALES_ACTION_ITEMS_FILTER_REGISTRY);
  }
}
