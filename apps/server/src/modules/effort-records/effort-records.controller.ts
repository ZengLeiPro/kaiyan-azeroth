import type {
  IBatchCreateEffortRecordResponse,
  IEffortRecordResponse,
} from '@ky-azeroth/shared/types/effort-record';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { MutationVersionQueryDto } from '../../common/dto/mutation-version-query.dto';
import { DataScopeService } from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { BatchCreateEffortRecordDto } from './dto/batch-create-effort-record.dto';
import { CreateEffortRecordDto } from './dto/create-effort-record.dto';
import {
  EffortRecordListResponseDto,
  EffortRecordResponseDto,
} from './dto/effort-record-response.dto';
import { EffortStatsQueryDto } from './dto/effort-stats-query.dto';
import { QueryEffortRecordDto } from './dto/query-effort-record.dto';
import { UpdateEffortRecordDto } from './dto/update-effort-record.dto';
import { EffortRecordsService } from './effort-records.service';
import { EffortStatsService } from './effort-stats.service';

@ApiTags('工时记录')
@ApiBearerAuth()
@Controller('effort-records')
export class EffortRecordsController {
  constructor(
    private readonly effortRecordsService: EffortRecordsService,
    private readonly effortStatsService: EffortStatsService,
    private readonly dataScope: DataScopeService
  ) {}

  /**
   * scope 与 client 传入的 ownerId 取交集:
   * - scope=null(ALL) → 原样使用 client 的 ownerId
   * - client 没传 ownerId → 直接用 scope(SELF 档下退化为 [自己])
   * - 两者都有 → 取交集(防止用户绕过 scope 查别人)
   */
  private intersectScope(
    ownerId: string | string[] | undefined,
    scope: string[] | null
  ): string[] | undefined {
    const ownerIds =
      ownerId === undefined ? undefined : Array.isArray(ownerId) ? ownerId : [ownerId];
    if (scope === null) return ownerIds;
    if (!ownerIds || ownerIds.length === 0) return scope;
    return ownerIds.filter((id) => scope.includes(id));
  }

  @Post('batch')
  @ApiOperation({ summary: '批量创建工时记录' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'create' })
  batchCreate(
    @Body() dto: BatchCreateEffortRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IBatchCreateEffortRecordResponse> {
    return this.effortRecordsService.batchCreate(dto, user);
  }

  @Post()
  @ApiOperation({ summary: '创建工时记录' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'create' })
  create(
    @Body() createEffortRecordDto: CreateEffortRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<EffortRecordResponseDto> {
    return this.effortRecordsService.create(createEffortRecordDto, user);
  }

  // ========== 我的工时（放在 :id 之前避免路由冲突） ==========

  @Get('my/timesheet')
  @ApiOperation({ summary: '获取我的工时表' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'view' })
  getMyTimesheet(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('recordType') recordType: string | undefined,
    @CurrentUser() user: CurrentUserType
  ): Promise<Record<string, IEffortRecordResponse[]>> {
    if (
      !startDate ||
      !endDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      throw new BadRequestException('startDate 和 endDate 为必填项，格式应为 YYYY-MM-DD');
    }
    const ownerId = user?.employeeId ?? user?.id;
    return this.effortRecordsService.getMyTimesheet(ownerId, startDate, endDate, recordType);
  }

  @Get('my/recent-projects')
  @ApiOperation({ summary: '获取最近使用的项目' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'view' })
  getMyRecentProjects(
    @CurrentUser() user: CurrentUserType
  ): Promise<Array<{ id: string; name: string; customerName: string | null }>> {
    const ownerId = user?.employeeId ?? user?.id;
    return this.effortRecordsService.getMyRecentProjects(ownerId);
  }

  // ========== 工时统计（放在 :id 之前避免路由冲突） ==========

  @Get('stats')
  @ApiOperation({ summary: '工时统计' })
  @RequirePermission({ module: 'projects', menu: 'effort_stats', action: 'view' })
  async getStats(@Query() query: EffortStatsQueryDto, @CurrentUser() user: CurrentUserType) {
    const { groupBy, startDate, endDate, projectId, customerId, ownerId } = query;

    // 数据范围: 按 (projects, effort_stats) 菜单的 viewScope 解析。
    // ALL → null(无限制),SELF → [自己] → 与 client 传入的 ownerId 取交集
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'projects',
      'effort_stats',
      { employeeId: user.employeeId }
    );

    const effectiveOwnerId = this.intersectScope(ownerId, scope);
    const filters = { projectId, customerId, ownerId: effectiveOwnerId };

    if (groupBy === 'project') {
      return this.effortStatsService.statsByProject(startDate, endDate, filters);
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('除按项目统计外，startDate 和 endDate 为必填项');
    }

    switch (groupBy) {
      case 'person':
        return this.effortStatsService.statsByPerson(startDate, endDate, filters);
      case 'customer':
        return this.effortStatsService.statsByCustomer(startDate, endDate, filters);
      case 'workType':
        return this.effortStatsService.statsByWorkType(startDate, endDate, filters);
      case 'completion':
        return this.effortStatsService.statsCompletion(startDate, endDate, filters);
      default:
        return this.effortStatsService.statsByPerson(startDate, endDate, filters);
    }
  }

  // ========== 标准 CRUD ==========

  @Get()
  @ApiOperation({ summary: '查询工时记录列表' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'view' })
  async findAll(
    @Query() query: QueryEffortRecordDto,
    @Req() request: Request,
    @CurrentUser() user: CurrentUserType
  ): Promise<EffortRecordListResponseDto> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'projects',
      'effort_records',
      { employeeId: user.employeeId }
    );
    return this.effortRecordsService.findAll(query, request.query, scope);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询工时记录详情' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<EffortRecordResponseDto> {
    await this.assertOwnerOrAdmin(id, user);
    return this.effortRecordsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新工时记录' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() updateEffortRecordDto: UpdateEffortRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<EffortRecordResponseDto> {
    await this.assertOwnerOrAdmin(id, user);
    return this.effortRecordsService.update(id, updateEffortRecordDto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除工时记录' })
  @RequirePermission({ module: 'projects', menu: 'effort_records', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @Query() query: MutationVersionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    await this.assertOwnerOrAdmin(id, user);
    return this.effortRecordsService.remove(id, query.version, user);
  }

  // ========== 行级权限校验 ==========

  /**
   * viewScope=SELF 只能操作自己的工时记录；ALL 不限制。
   */
  private async assertOwnerOrAdmin(recordId: string, user: CurrentUserType): Promise<void> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'projects',
      'effort_records',
      { employeeId: user.employeeId }
    );
    if (scope === null) return;

    const record = await this.effortRecordsService.findOne(recordId);
    const userOwnerId = user?.employeeId ?? user?.id;
    if (record.ownerId && record.ownerId !== userOwnerId) {
      throw new ForbiddenException('只能修改自己的工时记录');
    }
  }
}
