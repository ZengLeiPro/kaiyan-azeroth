import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  assertLargePageSizeAllowed,
  DataScopeService,
} from '../../common/services/data-scope.service';
import { ApprovalInstanceResponseDto } from '../approvals/dto/approval-response.dto';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CustomersService } from './customers.service';
import { BatchCollaboratorsCustomerDto } from './dto/batch-collaborators-customer.dto';
import { BatchRemoveCustomerDto } from './dto/batch-remove-customer.dto';
import { BatchTransferCustomerDto } from './dto/batch-transfer-customer.dto';
import { BatchUpdateCustomerDto } from './dto/batch-update-customer.dto';
import { CheckCustomerDuplicateDto } from './dto/check-customer-duplicate.dto';
import { ClaimCustomerDto } from './dto/claim-customer.dto';
import { CorrectLeadStageDto } from './dto/correct-lead-stage.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import {
  CustomerDuplicateCheckResponseDto,
  CustomerListResponseDto,
  CustomerResponseDto,
} from './dto/customer-response.dto';
import { CustomerSelectionQueryDto } from './dto/customer-selection-query.dto';
import { PermanentRemoveCustomerDto } from './dto/permanent-remove-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { RemoveCustomerQueryDto } from './dto/remove-customer-query.dto';
import { RestoreCustomerDto } from './dto/restore-customer.dto';
import { SubmitLeadStageChangeDto } from './dto/submit-lead-stage-change.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateLeadProgressDto } from './dto/update-lead-progress.dto';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly dataScopeService: DataScopeService
  ) {}

  @Get()
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'view' })
  async findAll(
    @Query() query: QueryCustomerDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<CustomerListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    assertLargePageSizeAllowed(query.pageSize, scope);
    return this.customersService.findAll(query, scope, user.id, request.query);
  }

  @Get('trash')
  @ApiOperation({ summary: '查询回收站客户列表' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'view' })
  async findTrashed(
    @Query() query: QueryCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    assertLargePageSizeAllowed(query.pageSize, scope);
    return this.customersService.findTrashed(query, scope, user.id);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有客户（用于下拉框）' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'view' })
  async findAllForSelection(
    @Query() query: CustomerSelectionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ id: string; serialNumber: string; customerName: string }[]> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.findAllForSelection(query.keyword, scope, user.id);
  }

  @Post('duplicate-check')
  @ApiOperation({ summary: '客户查重' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'view' })
  async checkDuplicates(
    @Body() dto: CheckCustomerDuplicateDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerDuplicateCheckResponseDto> {
    // scope 仅用于标注每条命中的 accessible（能否穿透打开详情），查重本身仍是全量范围
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.checkDuplicates(dto, {
      chargerScope: scope,
      currentEmployeeId: user.id,
    });
  }

  // ========== 批量操作 ==========
  // 路由顺序约束：所有静态路径 /customers/batch-* 与 /customers/batch
  // 必须位于带 :id 参数的路由（GET/PUT/DELETE :id 等）之前注册，
  // 否则 NestJS 会把 "batch-transfer" 当成 :id 解析进同名单条路由。
  //
  // 数据范围：复用 DataScopeService.resolveChargerScope。请求开始时即越权/不存在的项保留
  // skipped 语义；原候选等待锁后发生 version/软删/scope 变化则整批 409 回滚。
  //
  // 返回结构：{ success: number; skipped: string[] }
  // success 字段非 undefined，与前端 batchDelete 的 happy-path 判断兼容。

  @Patch('batch-transfer')
  @ApiOperation({ summary: '批量转交客户负责人' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async batchTransfer(
    @Body() dto: BatchTransferCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.batchTransfer(dto, user, scope, user.id);
  }

  @Patch('batch-update')
  @ApiOperation({ summary: '批量编辑客户（白名单字段）' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async batchUpdate(
    @Body() dto: BatchUpdateCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.batchUpdate(dto, user, scope, user.id);
  }

  @Patch('batch-add-collaborators')
  @ApiOperation({ summary: '批量添加协作人' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async batchAddCollaborators(
    @Body() dto: BatchCollaboratorsCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.batchAddCollaborators(dto, user, scope, user.id);
  }

  @Patch('batch-remove-collaborators')
  @ApiOperation({ summary: '批量移除协作人' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async batchRemoveCollaborators(
    @Body() dto: BatchCollaboratorsCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.batchRemoveCollaborators(dto, user, scope, user.id);
  }

  @Delete('batch')
  @ApiOperation({ summary: '批量软删除客户' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'delete' })
  async batchRemove(
    @Body() dto: BatchRemoveCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.batchRemove(dto, user, scope, user.id);
  }

  @Get(':id')
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.findOne(id, scope, user.id, { includePublicPool: true });
  }

  @Post()
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'create' })
  async create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    // scope 用于 409 重复预警时标注 duplicates 的 accessible，与 duplicate-check 同口径
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.create(dto, user, {
      chargerScope: scope,
      currentEmployeeId: user.id,
    });
  }

  @Post(':id/restore')
  @ApiOperation({ summary: '恢复已删除客户' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async restore(
    @Param('id') id: string,
    @Body() dto: RestoreCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.restore(id, dto, user, scope, user.id);
  }

  @Post(':id/claim')
  @ApiOperation({ summary: '认领公海客户' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async claim(
    @Param('id') id: string,
    @Body() dto: ClaimCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    return this.customersService.claim(id, dto, user);
  }

  @Post(':id/lead-stage-change-request')
  @ApiOperation({
    summary: '提交线索阶段（MQL/SQL）变更审批（所有角色统一入口；申请人=审批人时引擎自动通过）',
  })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async submitLeadStageChangeRequest(
    @Param('id') id: string,
    @Body() dto: SubmitLeadStageChangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.submitLeadStageChangeRequest(id, dto, user, scope, user.id);
  }

  @Patch(':id/lead-stage-correction')
  @ApiOperation({ summary: '管理员修正历史线索阶段与原始打标时间' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async correctLeadStage(
    @Param('id') id: string,
    @Body() dto: CorrectLeadStageDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    return this.customersService.correctLeadStage(id, dto, user);
  }

  @Patch(':id/lead-progress')
  @ApiOperation({ summary: '更新 Leads 推进状态（预约/毁约/流失/重新激活）' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async updateLeadProgress(
    @Param('id') id: string,
    @Body() dto: UpdateLeadProgressDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.updateLeadProgress(id, dto, user, scope, user.id);
  }

  @Put(':id')
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<CustomerResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    return this.customersService.update(id, dto, user, scope, user.id, user.roles);
  }

  @Delete(':id/permanent')
  @ApiOperation({ summary: '永久删除客户' })
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'delete' })
  @RequireFreshJwt()
  async permanentRemove(
    @Param('id') id: string,
    @Body() dto: PermanentRemoveCustomerDto,
    @CurrentUser() _user: CurrentUserType
  ): Promise<{ success: boolean }> {
    await this.customersService.permanentRemove(id, dto);
    return { success: true };
  }

  @Delete(':id')
  @RequirePermission({ module: 'crm', menu: 'customers', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Query() query: RemoveCustomerQueryDto
  ): Promise<{ success: boolean }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'customers',
      { employeeId: user.employeeId }
    );
    await this.customersService.remove(id, user, scope, user.id, query.version);
    return { success: true };
  }
}
