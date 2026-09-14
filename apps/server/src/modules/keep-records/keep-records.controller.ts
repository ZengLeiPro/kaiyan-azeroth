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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  assertLargePageSizeAllowed,
  DataScopeService,
} from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateKeepRecordDto } from './dto/create-keep-record.dto';
import { KeepRecordListResponseDto, KeepRecordResponseDto } from './dto/keep-record-response.dto';
import { QueryKeepRecordDto } from './dto/query-keep-record.dto';
import { UpdateKeepRecordDto } from './dto/update-keep-record.dto';
import { KeepRecordsService } from './keep-records.service';

@ApiTags('跟进记录')
@ApiBearerAuth()
@Controller('keep-records')
export class KeepRecordsController {
  constructor(
    private readonly keepRecordsService: KeepRecordsService,
    private readonly dataScopeService: DataScopeService
  ) {}

  @Post()
  @ApiOperation({ summary: '创建跟进记录' })
  @RequirePermission({ module: 'crm', menu: 'keep_records', action: 'create' })
  create(
    @Body() createKeepRecordDto: CreateKeepRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<KeepRecordResponseDto> {
    return this.keepRecordsService.create(createKeepRecordDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询跟进记录列表' })
  @RequirePermission({ module: 'crm', menu: 'keep_records', action: 'view' })
  async findAll(
    @Query() query: QueryKeepRecordDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<KeepRecordListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'keep_records',
      { employeeId: user.employeeId }
    );
    assertLargePageSizeAllowed(query.pageSize, scope);
    return this.keepRecordsService.findAll(query, scope, user.id, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询跟进记录详情' })
  @RequirePermission({ module: 'crm', menu: 'keep_records', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<KeepRecordResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'keep_records',
      { employeeId: user.employeeId }
    );
    return this.keepRecordsService.findOne(id, scope, user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新跟进记录' })
  @RequirePermission({ module: 'crm', menu: 'keep_records', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() updateKeepRecordDto: UpdateKeepRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<KeepRecordResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'keep_records',
      { employeeId: user.employeeId }
    );
    return this.keepRecordsService.update(id, updateKeepRecordDto, user, scope, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除跟进记录' })
  @RequirePermission({ module: 'crm', menu: 'keep_records', action: 'delete' })
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
      'keep_records',
      { employeeId: user.employeeId }
    );
    await this.keepRecordsService.remove(id, user, scope, user.id, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const version = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException('删除跟进记录必须携带有效的 version');
  }
  return version;
}
