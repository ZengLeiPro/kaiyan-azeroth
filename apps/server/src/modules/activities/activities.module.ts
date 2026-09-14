import { Module } from '@nestjs/common';

import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

/**
 * 客户活动时间线模块（2026-06-16 投影派）。
 *
 * 只读 union 视图，不引入新表：
 *  - keep_records / visit_records 作为原始活动事件
 *  - operation_logs(kind='change', targetCustomerId=...) 作为字段级变更事件
 *
 * 依赖：PrismaModule（全局）+ AuthModule.DataScopeService（在 controller 注入）。
 */
@Module({
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
