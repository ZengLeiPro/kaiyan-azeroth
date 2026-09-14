import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { ApprovalGuardService } from '../approvals/approval-guard.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApprovalFlowsService } from './approval-flows.service';
import {
  ApprovalFlowListResponseDto,
  ApprovalFlowResponseDto,
  ApprovalModuleStatusListDto,
} from './dto/approval-flow-response.dto';
import { CreateApprovalFlowDto } from './dto/create-approval-flow.dto';
import { QueryApprovalFlowDto } from './dto/query-approval-flow.dto';
import { UpdateApprovalFlowDto } from './dto/update-approval-flow.dto';

@ApiTags('审批流程配置')
@ApiBearerAuth()
@Controller('approval-flows')
export class ApprovalFlowsController {
  constructor(
    private readonly approvalFlowsService: ApprovalFlowsService,
    private readonly approvalGuardService: ApprovalGuardService
  ) {}

  @Post()
  @ApiOperation({ summary: '创建审批流程' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'create' })
  create(
    @Body() dto: CreateApprovalFlowDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalFlowResponseDto> {
    return this.approvalFlowsService.create(dto, user);
  }

  @Get('module-status')
  @ApiOperation({ summary: '获取所有模块的审批配置状态' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'view' })
  getModuleStatus(): Promise<ApprovalModuleStatusListDto> {
    return this.approvalGuardService.getAllModuleStatus();
  }

  @Get('check/:eventType')
  @ApiOperation({ summary: '检查某模块是否需要审批' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'view' })
  checkApprovalRequired(
    @Param('eventType') eventType: string
  ): Promise<{ eventType: string; required: boolean }> {
    return this.approvalGuardService.isRequired(eventType).then((required) => ({
      eventType,
      required,
    }));
  }

  @Get()
  @ApiOperation({ summary: '获取审批流程列表（默认只显示激活的流程）' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'view' })
  findAll(
    @Query() query: QueryApprovalFlowDto,
    @Req() request: Request
  ): Promise<ApprovalFlowListResponseDto> {
    return this.approvalFlowsService.findAll(query, request.query);
  }

  @Post('enable/:eventType')
  @ApiOperation({ summary: '启用模块审批（激活最新版本流程）' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'edit' })
  enableModule(
    @Param('eventType') eventType: string
  ): Promise<{ enabled: boolean; hasFlow: boolean; flow?: ApprovalFlowResponseDto }> {
    return this.approvalFlowsService.enableModule(eventType);
  }

  @Post('disable/:eventType')
  @ApiOperation({ summary: '停用模块审批（停用激活流程）' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'edit' })
  disableModule(
    @Param('eventType') eventType: string
  ): Promise<{ disabled: boolean; count: number }> {
    return this.approvalFlowsService.disableModule(eventType);
  }

  @Get('active/:eventType')
  @ApiOperation({ summary: '获取指定类型的激活流程' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'view' })
  findActiveByEventType(
    @Param('eventType') eventType: string
  ): Promise<ApprovalFlowResponseDto | null> {
    return this.approvalFlowsService.findActiveByEventType(eventType);
  }

  @Get('history/:groupId')
  @ApiOperation({ summary: '获取版本历史' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'view' })
  findVersionHistory(@Param('groupId') groupId: string): Promise<ApprovalFlowResponseDto[]> {
    return this.approvalFlowsService.findVersionHistory(groupId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取审批流程详情' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'view' })
  findOne(@Param('id') id: string): Promise<ApprovalFlowResponseDto> {
    return this.approvalFlowsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新审批流程（创建新版本）' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalFlowDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalFlowResponseDto> {
    return this.approvalFlowsService.update(id, dto, user);
  }

  @Post(':id/activate')
  @ApiOperation({ summary: '激活指定版本的流程' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'edit' })
  activateVersion(@Param('id') id: string): Promise<ApprovalFlowResponseDto> {
    return this.approvalFlowsService.activateVersion(id);
  }

  @Post(':id/deactivate')
  @ApiOperation({ summary: '停用指定流程（active → inactive）' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'edit' })
  deactivateFlow(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalFlowResponseDto> {
    return this.approvalFlowsService.deactivateFlow(id, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除审批流程（软删除）' })
  @RequirePermission({ module: 'approval', menu: 'approval_flows', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.approvalFlowsService.remove(id, user);
  }
}
