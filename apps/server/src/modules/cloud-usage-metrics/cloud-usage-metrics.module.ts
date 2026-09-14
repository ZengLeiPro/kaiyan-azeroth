import { Module } from '@nestjs/common';

import { CloudUsageMetricsController } from './cloud-usage-metrics.controller';
import { CloudUsageMetricsService } from './cloud-usage-metrics.service';

@Module({
  controllers: [CloudUsageMetricsController],
  providers: [CloudUsageMetricsService],
  exports: [CloudUsageMetricsService],
})
export class CloudUsageMetricsModule {}
