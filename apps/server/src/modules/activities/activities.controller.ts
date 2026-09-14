import type { ActivityListResponse } from '@ky-azeroth/shared/schemas/activity';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DataScopeService } from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ActivitiesService } from './activities.service';
import { QueryActivityDto } from './dto/query-activity.dto';

/**
 * 客户活动时间线（2026-06-16 投影派改造）。
 *
 * 扁平路由约定（项目仓库统一规则）：URL = /activities?customerId=xxx
 * 与 keep-records / visit-records 同风格——customerId 作为必填 query 参数。
 * 权限沿用 crm.customers.view（活动是客户子视图，不单建权限项）。
 */
@ApiTags('客户活动时间线')
@ApiBearerAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(
    private readonly activitiesService: ActivitiesService,
    private readonly dataScopeService: DataScopeService
  ) {}

  @Get()
  @ApiOperation({
    summary: '查询客户活动时间线（union: keep + visit + operation_logs）',
  })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'view' })
  async findByCustomer(
    @Query() query: QueryActivityDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ActivityListResponse> {
    if (!query.customerId) {
      throw new BadRequestException('customerId 是必填参数');
    }
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.activitiesService.findByCustomer(
      query.customerId,
      {
        since: query.since,
        until: query.until,
        importance: query.importance,
        category: query.category,
        limit: query.limit,
        cursor: query.cursor,
      },
      scope
    );
  }
}
