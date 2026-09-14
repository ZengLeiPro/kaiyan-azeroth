import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
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

import { DataScopeService } from '../../common/services/data-scope.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { ApprovalInstanceResponseDto } from '../approvals/dto/approval-response.dto';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateVisitRecordDto } from './dto/create-visit-record.dto';
import { QueryVisitRecordDto } from './dto/query-visit-record.dto';
import { UpdateVisitRecordDto } from './dto/update-visit-record.dto';
import {
  VisitRecordListResponseDto,
  VisitRecordResponseDto,
} from './dto/visit-record-response.dto';
import { VisitRecordsService } from './visit-records.service';

@ApiTags('拜访记录')
@ApiBearerAuth()
@Controller('visit-records')
export class VisitRecordsController {
  constructor(
    private readonly visitRecordsService: VisitRecordsService,
    private readonly dataScopeService: DataScopeService,
    private readonly businessApprovalService: BusinessApprovalService
  ) {}

  @Post()
  @ApiOperation({ summary: '创建拜访记录' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'create' })
  create(
    @Body() createVisitRecordDto: CreateVisitRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<VisitRecordResponseDto> {
    return this.visitRecordsService.create(createVisitRecordDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询拜访记录列表' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'view' })
  async findAll(
    @Query() query: QueryVisitRecordDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<VisitRecordListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'visit_records',
      { employeeId: user.employeeId }
    );
    return this.visitRecordsService.findAll(query, scope, user.id, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询拜访记录详情' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<VisitRecordResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'visit_records',
      { employeeId: user.employeeId }
    );
    return this.visitRecordsService.findOne(id, scope, user.id);
  }

  @Post(':id/submit-approval')
  @ApiOperation({ summary: '提交拜访审批' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'edit' })
  async submitApproval(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'visit_records',
      { employeeId: user.employeeId }
    );
    return this.businessApprovalService.submitBusinessApproval(
      APPROVAL_EVENT_TYPE.VISIT_APPROVE,
      id,
      user,
      scope
    );
  }

  @Post(':id/change-request')
  @ApiOperation({ summary: '提交拜访变更审批' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'edit' })
  async submitChangeRequest(
    @Param('id') id: string,
    @Body() dto: UpdateVisitRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'visit_records',
      { employeeId: user.employeeId }
    );
    return this.visitRecordsService.submitChangeRequest(id, dto, user, scope, user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新拜访记录' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() updateVisitRecordDto: UpdateVisitRecordDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<VisitRecordResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'visit_records',
      { employeeId: user.employeeId }
    );
    return this.visitRecordsService.update(id, updateVisitRecordDto, user, scope, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除拜访记录' })
  @RequirePermission({ module: 'crm', menu: 'visit_records', action: 'delete' })
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
      'visit_records',
      { employeeId: user.employeeId }
    );
    await this.visitRecordsService.remove(id, user, scope, user.id, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const version = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException('删除拜访记录必须携带有效的 version');
  }
  return version;
}
