import type { CloudAlertResponseOutput } from '@ky-azeroth/shared/schemas/cloud-alert';
import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CloudAlertsService } from './cloud-alerts.service';
import { QueryCloudAlertDto } from './dto/query-cloud-alert.dto';
import { UpdateCloudAlertDto } from './dto/update-cloud-alert.dto';

@ApiTags('云成本预警')
@ApiBearerAuth()
@Controller('cloud-alerts')
export class CloudAlertsController {
  constructor(private readonly service: CloudAlertsService) {}

  @Get()
  @ApiOperation({ summary: '查询云预警列表' })
  @RequirePermission({ module: 'ops', menu: 'cloud_alerts', action: 'view' })
  findAll(
    @Query() query: QueryCloudAlertDto
  ): Promise<PaginatedResponse<CloudAlertResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询云预警详情' })
  @RequirePermission({ module: 'ops', menu: 'cloud_alerts', action: 'view' })
  findOne(@Param('id') id: string): Promise<CloudAlertResponseOutput> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '处理云预警（resolve / dismiss，含乐观锁）' })
  @RequirePermission({ module: 'ops', menu: 'cloud_alerts', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCloudAlertDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CloudAlertResponseOutput> {
    return this.service.update(id, dto, user);
  }
}
