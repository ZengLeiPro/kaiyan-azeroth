import { Module } from '@nestjs/common';

import { WebAnalyticsController } from './web-analytics.controller';
import { WebAnalyticsService } from './web-analytics.service';

@Module({
  controllers: [WebAnalyticsController],
  providers: [WebAnalyticsService],
  exports: [WebAnalyticsService],
})
export class WebAnalyticsModule {}
