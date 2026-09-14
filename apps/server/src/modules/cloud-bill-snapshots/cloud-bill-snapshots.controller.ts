import type {
  CloudBillSnapshotResponseOutput,
  CloudCostOverviewResponseOutput,
  CloudPackageProjectionOutput,
} from '@ky-azeroth/shared/schemas/cloud-bill-snapshot';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CloudBillSnapshotsService } from './cloud-bill-snapshots.service';
import { QueryCloudBillSnapshotDto } from './dto/query-cloud-bill-snapshot.dto';
import { QueryCloudCostOverviewDto } from './dto/query-cloud-cost-overview.dto';
import { QueryCloudPackageProjectionDto } from './dto/query-cloud-package-projection.dto';

@ApiTags('云账单快照')
@ApiBearerAuth()
@Controller('cloud-bill-snapshots')
export class CloudBillSnapshotsController {
  constructor(private readonly service: CloudBillSnapshotsService) {}

  @Get()
  @ApiOperation({ summary: '查询云账单快照列表' })
  @RequirePermission({ module: 'ops', menu: 'cloud_bills', action: 'view' })
  findAll(
    @Query() query: QueryCloudBillSnapshotDto
  ): Promise<PaginatedResponse<CloudBillSnapshotResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get('latest')
  @ApiOperation({ summary: '查询最新一条云账单快照' })
  @RequirePermission({ module: 'ops', menu: 'cloud_cost_dashboard', action: 'view' })
  findLatest(): Promise<CloudBillSnapshotResponseOutput> {
    return this.service.findLatest();
  }

  @Get('overview')
  @ApiOperation({ summary: '云成本仪表盘聚合数据' })
  @RequirePermission({ module: 'ops', menu: 'cloud_cost_dashboard', action: 'view' })
  getOverview(@Query() query: QueryCloudCostOverviewDto): Promise<CloudCostOverviewResponseOutput> {
    return this.service.getOverview(query);
  }

  @Get('package-projection')
  @ApiOperation({ summary: '资源包预测耗尽日' })
  @RequirePermission({ module: 'ops', menu: 'cloud_packages', action: 'view' })
  getPackageProjection(
    @Query() query: QueryCloudPackageProjectionDto
  ): Promise<CloudPackageProjectionOutput[]> {
    return this.service.getPackageProjection(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询云账单快照详情' })
  @RequirePermission({ module: 'ops', menu: 'cloud_bills', action: 'view' })
  findOne(@Param('id') id: string): Promise<CloudBillSnapshotResponseOutput> {
    return this.service.findOne(id);
  }
}
