import type { OpportunityForSelection } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  assertLargePageSizeAllowed,
  DataScopeService,
} from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { OpportunityListResponseDto, OpportunityResponseDto } from './dto/opportunity-response.dto';
import { OpportunitySelectionQueryDto } from './dto/opportunity-selection-query.dto';
import { QueryOpportunityDto } from './dto/query-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OpportunitiesService } from './opportunities.service';

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly opportunitiesService: OpportunitiesService,
    private readonly dataScopeService: DataScopeService
  ) {}

  @Get()
  @RequirePermission({ module: 'crm', menu: 'opportunities', action: 'view' })
  async findAll(
    @Query() query: QueryOpportunityDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<OpportunityListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'opportunities',
      { employeeId: user.employeeId }
    );
    assertLargePageSizeAllowed(query.pageSize, scope);
    return this.opportunitiesService.findAll(query, scope, user.id, request.query);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有商机（用于下拉框）' })
  @RequirePermission({ module: 'crm', menu: 'opportunities', action: 'view' })
  async findAllForSelection(
    @Query() query: OpportunitySelectionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<OpportunityForSelection[]> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'opportunities',
      { employeeId: user.employeeId }
    );
    return this.opportunitiesService.findAllForSelection(query, scope, user.id);
  }

  @Get(':id')
  @RequirePermission({ module: 'crm', menu: 'opportunities', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<OpportunityResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'opportunities',
      { employeeId: user.employeeId }
    );
    return this.opportunitiesService.findOne(id, scope, user.id);
  }

  @Post()
  @RequirePermission({ module: 'crm', menu: 'opportunities', action: 'create' })
  async create(
    @Body() dto: CreateOpportunityDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<OpportunityResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'opportunities',
      { employeeId: user.employeeId }
    );
    return this.opportunitiesService.create(dto, user, scope, user.employeeId ?? user.id);
  }

  @Put(':id')
  @RequirePermission({ module: 'crm', menu: 'opportunities', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<OpportunityResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'opportunities',
      { employeeId: user.employeeId }
    );
    return this.opportunitiesService.update(id, dto, user, scope, user.id);
  }

  @Delete(':id')
  @RequirePermission({ module: 'crm', menu: 'opportunities', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Query('version') versionQuery?: string
  ): Promise<{ success: boolean }> {
    const requestVersion = parseVersionParam(versionQuery);
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'opportunities',
      { employeeId: user.employeeId }
    );
    await this.opportunitiesService.remove(id, user, scope, user.id, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const version = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException('删除商机必须携带有效的 version');
  }
  return version;
}
