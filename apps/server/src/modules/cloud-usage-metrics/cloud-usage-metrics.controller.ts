import type {
  CloudUsageMetricResponseOutput,
  CloudUsageSeriesResponseOutput,
} from '@ky-azeroth/shared/schemas/cloud-usage-metric';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CloudUsageMetricsService } from './cloud-usage-metrics.service';
import { QueryCloudUsageMetricDto } from './dto/query-cloud-usage-metric.dto';
import { QueryCloudUsageSeriesDto } from './dto/query-cloud-usage-series.dto';

@ApiTags('云资源用量')
@ApiBearerAuth()
@Controller('cloud-usage-metrics')
export class CloudUsageMetricsController {
  constructor(private readonly service: CloudUsageMetricsService) {}

  @Get()
  @ApiOperation({ summary: '查询用量指标列表' })
  @RequirePermission({ module: 'ops', menu: 'cloud_usage', action: 'view' })
  findAll(
    @Query() query: QueryCloudUsageMetricDto
  ): Promise<PaginatedResponse<CloudUsageMetricResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get('series')
  @ApiOperation({ summary: '查询用量时序序列（图表用）' })
  @RequirePermission({ module: 'ops', menu: 'cloud_usage', action: 'view' })
  getSeries(@Query() query: QueryCloudUsageSeriesDto): Promise<CloudUsageSeriesResponseOutput> {
    return this.service.getSeries(query);
  }
}
