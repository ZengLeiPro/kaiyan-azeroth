import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { DataScopeService } from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-permission.decorator';
import { CrmWorkDailiesService } from './crm-work-dailies.service';
import { CreateCrmWorkDailyDto } from './dto/create-crm-work-daily.dto';
import {
  CrmWorkDailyListResponseDto,
  CrmWorkDailyResponseDto,
} from './dto/crm-work-daily-response.dto';
import { QueryCrmWorkDailyDto } from './dto/query-crm-work-daily.dto';
import { UpdateCrmWorkDailyDto } from './dto/update-crm-work-daily.dto';

const CRM_WORK_DAILY_SCOPE_PERMISSIONS = [
  { module: 'reports', menu: 'work_dailies' },
  { module: 'reports', menu: 'telesales_dailies' },
];

@ApiTags('工作日报')
@ApiBearerAuth()
@Controller('crm-work-dailies')
export class CrmWorkDailiesController {
  constructor(
    private readonly crmWorkDailiesService: CrmWorkDailiesService,
    private readonly dataScopeService: DataScopeService
  ) {}

  @Post()
  @ApiOperation({ summary: '创建工作日报' })
  @RequireAnyPermission([
    { module: 'reports', menu: 'work_dailies', action: 'create' },
    { module: 'reports', menu: 'telesales_dailies', action: 'create' },
  ])
  create(
    @Body() createCrmWorkDailyDto: CreateCrmWorkDailyDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CrmWorkDailyResponseDto> {
    return this.crmWorkDailiesService.create(createCrmWorkDailyDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询工作日报列表' })
  @RequireAnyPermission([
    { module: 'reports', menu: 'work_dailies', action: 'view' },
    { module: 'reports', menu: 'telesales_dailies', action: 'view' },
  ])
  async findAll(
    @Query() query: QueryCrmWorkDailyDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<CrmWorkDailyListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScopeAny(
      user.id,
      CRM_WORK_DAILY_SCOPE_PERMISSIONS,
      { employeeId: user.employeeId }
    );
    return this.crmWorkDailiesService.findAll(query, scope, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询工作日报详情' })
  @RequireAnyPermission([
    { module: 'reports', menu: 'work_dailies', action: 'view' },
    { module: 'reports', menu: 'telesales_dailies', action: 'view' },
  ])
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<CrmWorkDailyResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScopeAny(
      user.id,
      CRM_WORK_DAILY_SCOPE_PERMISSIONS,
      { employeeId: user.employeeId }
    );
    return this.crmWorkDailiesService.findOne(id, scope);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新工作日报' })
  @RequireAnyPermission([
    { module: 'reports', menu: 'work_dailies', action: 'edit' },
    { module: 'reports', menu: 'telesales_dailies', action: 'edit' },
  ])
  async update(
    @Param('id') id: string,
    @Body() updateCrmWorkDailyDto: UpdateCrmWorkDailyDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CrmWorkDailyResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScopeAny(
      user.id,
      CRM_WORK_DAILY_SCOPE_PERMISSIONS,
      { employeeId: user.employeeId }
    );
    return this.crmWorkDailiesService.update(id, updateCrmWorkDailyDto, user, scope);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除工作日报' })
  @RequireAnyPermission([
    { module: 'reports', menu: 'work_dailies', action: 'delete' },
    { module: 'reports', menu: 'telesales_dailies', action: 'delete' },
  ])
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    const scope = await this.dataScopeService.resolveChargerScopeAny(
      user.id,
      CRM_WORK_DAILY_SCOPE_PERMISSIONS,
      { employeeId: user.employeeId }
    );
    await this.crmWorkDailiesService.remove(id, user, scope);
    return { success: true };
  }
}
