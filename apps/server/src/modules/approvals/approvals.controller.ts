import type { IApprovalChangeRequestResponse } from '@ky-azeroth/shared/types';
import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DataScopeService } from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ApprovalChangeRequestsService } from './approval-change-requests.service';
import { ApprovalsService } from './approvals.service';
import { ApprovalActionDto, WithdrawApprovalDto } from './dto/approval-action.dto';
import {
  ApprovalInstanceListResponseDto,
  ApprovalInstanceResponseDto,
  ApprovalTaskListResponseDto,
} from './dto/approval-response.dto';
import { QueryApprovalDto } from './dto/query-approval.dto';

@ApiTags('审批管理')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly approvalChangeRequests: ApprovalChangeRequestsService,
    private readonly dataScopeService: DataScopeService
  ) {}

  private async hasApprovalListAllScope(user: CurrentUserType): Promise<boolean> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'approval',
      'approval_list',
      { employeeId: user.employeeId ?? user.id }
    );
    return scope === null;
  }

  private async assertApprovalListAllScope(user: CurrentUserType): Promise<void> {
    if (!(await this.hasApprovalListAllScope(user))) {
      throw new ForbiddenException('需要审批列表全部数据范围权限');
    }
  }

  @Post(':id/approve')
  @ApiOperation({ summary: '审批通过/驳回' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'approve' })
  doApproval(
    @Param('id') id: string,
    @Body() dto: ApprovalActionDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean; status: string }> {
    return this.approvalsService.doApproval(id, dto, user);
  }

  @Post(':id/withdraw')
  @ApiOperation({ summary: '撤回审批' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'edit' })
  withdraw(
    @Param('id') id: string,
    @Body() dto: WithdrawApprovalDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.approvalsService.withdraw(id, user, dto.comment);
  }

  @Get('pending')
  @ApiOperation({ summary: '获取待我审批列表' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  getPendingList(
    @Query() query: QueryApprovalDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalTaskListResponseDto> {
    // 「待我审批」始终按 approverId 过滤（管理员看全部走 /approvals/all）。
    // 历史上此处对管理员放宽过滤，会导致或签节点的同一 instance 在列表中重复出现。
    return this.approvalsService.getPendingList(user.id, query);
  }

  @Get('pending/count')
  @ApiOperation({ summary: '获取待审批数量' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  getPendingCount(@CurrentUser() user: CurrentUserType): Promise<number> {
    return this.approvalsService.getPendingCount(user.id);
  }

  @Get('completed')
  @ApiOperation({ summary: '获取我已审批列表' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  getCompletedList(
    @Query() query: QueryApprovalDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalTaskListResponseDto> {
    // 同 getPendingList：按 approverId 过滤，管理员看全部走 /approvals/all
    return this.approvalsService.getCompletedList(user.id, query);
  }

  @Get('copy-to')
  @ApiOperation({ summary: '获取抄送给我的列表' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  getCopyToList(
    @Query() query: QueryApprovalDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceListResponseDto> {
    return this.approvalsService.getCopyToList(user.id, query);
  }

  @Get('initiated')
  @ApiOperation({ summary: '获取我发起的审批列表' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  getInitiatedList(
    @Query() query: QueryApprovalDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceListResponseDto> {
    return this.approvalsService.getInitiatedList(user.id, query);
  }

  @Get('all')
  @ApiOperation({ summary: '获取全部审批列表（仅管理员）' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  async getAllApprovals(
    @Query() query: QueryApprovalDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceListResponseDto> {
    await this.assertApprovalListAllScope(user);
    return this.approvalsService.getAllApprovals(query);
  }

  @Post(':id/admin-approve')
  @ApiOperation({ summary: '管理员审批（可审批任意审批单）' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'approve' })
  async doAdminApproval(
    @Param('id') id: string,
    @Body() dto: ApprovalActionDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean; status: string }> {
    await this.assertApprovalListAllScope(user);
    return this.approvalsService.doAdminApproval(id, dto, user);
  }

  @Get('form/:eventType/:formId')
  @ApiOperation({ summary: '根据表单查询审批' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  async getByForm(
    @Param('eventType') eventType: string,
    @Param('formId') formId: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const hasAllScope = await this.hasApprovalListAllScope(user);
    return this.approvalsService.getByForm(eventType, formId, user, hasAllScope);
  }

  @Get('change-requests/:id')
  @ApiOperation({ summary: '获取审批变更申请详情' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  async getChangeRequest(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<IApprovalChangeRequestResponse> {
    const hasAllScope = await this.hasApprovalListAllScope(user);
    return this.approvalChangeRequests.findOneById(id, user.id, hasAllScope);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取审批实例详情' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'view' })
  async getInstanceDetail(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const hasAllScope = await this.hasApprovalListAllScope(user);
    return this.approvalsService.getInstanceDetail(id, user, hasAllScope);
  }
}
