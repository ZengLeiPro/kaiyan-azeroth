import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import type { SaleOrderForSelection } from '@ky-azeroth/shared/types/sale-order';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import { BatchIdsDto } from '../../common/dto/batch-ids.dto';
import { DataScopeService } from '../../common/services/data-scope.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { ApprovalInstanceResponseDto } from '../approvals/dto/approval-response.dto';
import { BatchApproveDto } from '../approvals/dto/batch-approve.dto';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { BatchTransferSaleOrderDto } from './dto/batch-transfer-sale-order.dto';
import { BatchUpdateSaleOrderDto } from './dto/batch-update-sale-order.dto';
import { CreateSaleOrderDto } from './dto/create-sale-order.dto';
import { QuerySaleOrderDto } from './dto/query-sale-order.dto';
import { SaleOrderListResponseDto, SaleOrderResponseDto } from './dto/sale-order-response.dto';
import { SaleOrderSelectionQueryDto } from './dto/sale-order-selection-query.dto';
import { SaleOrderVoidPreviewResponseDto } from './dto/sale-order-void-preview-response.dto';
import { SaleOrderVoidRequestDto } from './dto/sale-order-void-request.dto';
import { UpdateSaleOrderDto } from './dto/update-sale-order.dto';
import { SaleOrdersService } from './sale-orders.service';

@Controller('sale-orders')
export class SaleOrdersController {
  constructor(
    private readonly saleOrdersService: SaleOrdersService,
    private readonly dataScopeService: DataScopeService,
    private readonly businessApprovalService: BusinessApprovalService
  ) {}

  @Get()
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'view' })
  async findAll(
    @Query() query: QuerySaleOrderDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<SaleOrderListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.findAll(query, scope, user.id, request.query);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有合同订单（用于下拉框）' })
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'view' })
  async findAllForSelection(
    @Query() query: SaleOrderSelectionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SaleOrderForSelection[]> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.findAllForSelection(query, scope, user.id);
  }

  // ========== 批量操作 ==========
  // 路由顺序约束：所有静态路径 /sale-orders/batch-* 与 /sale-orders/batch
  // 必须位于带 :id 参数的路由（GET/PUT/DELETE :id 等）之前注册，
  // 否则 NestJS 会把 "batch-transfer" 当成 :id 解析进同名单条路由。
  //
  // 数据范围：复用 DataScopeService.resolveChargerScope + applyCustomerCollabViaCustomerScope。
  // ids 中越权 / 不存在 / 已软删除的项被 service 层静默归入 skipped，不抛错。
  //
  // 返回结构：
  //   batch-transfer/update/remove → { success, skipped: string[] }
  //   batch-approve → { success, skipped: Array<{ id, reason }> }（额外含跳过原因）

  @Patch('batch-transfer')
  @ApiOperation({ summary: '批量更换订单负责人' })
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'edit' })
  @RequireFreshJwt()
  async batchTransfer(
    @Body() dto: BatchTransferSaleOrderDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.batchTransfer(dto, user, scope, user.employeeId ?? null);
  }

  @Patch('batch-update')
  @ApiOperation({ summary: '批量编辑订单（白名单字段）' })
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'edit' })
  async batchUpdate(
    @Body() dto: BatchUpdateSaleOrderDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.batchUpdate(dto, user, scope, user.employeeId ?? null);
  }

  @Post('batch-approve')
  @ApiOperation({ summary: '批量审批人决策（仅"我是审批人"的实例）' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'approve' })
  async batchApprove(
    @Body() dto: BatchApproveDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: Array<{ id: string; reason: string }> }> {
    return this.saleOrdersService.batchApprove(dto, user);
  }

  @Delete('batch')
  @ApiOperation({ summary: '批量软删除订单' })
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'delete' })
  async batchRemove(
    @Body() dto: BatchIdsDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{
    success: number;
    skipped: string[];
    errors: Array<{ id: string; error: string }>;
  }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.batchRemove(dto.ids, user, scope, user.employeeId ?? null);
  }

  @Get(':id')
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<SaleOrderResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.findOne(id, scope, user.id);
  }

  @Post()
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'create' })
  async create(
    @Body() dto: CreateSaleOrderDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SaleOrderResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.create(dto, user, scope, user.employeeId ?? user.id);
  }

  @Post(':id/submit-approval')
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'edit' })
  async submitApproval(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.businessApprovalService.submitBusinessApproval(
      APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
      id,
      user,
      scope
    );
  }

  @Post(':id/change-request')
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'edit' })
  async submitChangeRequest(
    @Param('id') id: string,
    @Body() dto: UpdateSaleOrderDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.submitChangeRequest(id, dto, user, scope, user.id);
  }

  @Post(':id/void-request')
  @ApiOperation({ summary: '提交已审批合同订单纠错作废申请' })
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'delete' })
  async submitVoidRequest(
    @Param('id') id: string,
    @Body() dto: SaleOrderVoidRequestDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.submitVoidRequest(id, dto, user, scope, user.id);
  }

  @Get(':id/void-preview')
  @ApiOperation({ summary: '预检合同订单纠错作废依赖' })
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'delete' })
  async getVoidPreview(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<SaleOrderVoidPreviewResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.getVoidPreview(id, scope, user.id);
  }

  @Put(':id')
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSaleOrderDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<SaleOrderResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    return this.saleOrdersService.update(id, dto, user, scope, user.id);
  }

  @Delete(':id')
  @RequirePermission({ module: 'crm', menu: 'sale_orders', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Query('version') versionQuery?: string
  ): Promise<{ success: boolean }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'sale_orders',
      { employeeId: user.employeeId }
    );
    const requestVersion = parseVersionParam(versionQuery);
    await this.saleOrdersService.remove(id, user, scope, user.id, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const num = Number(raw);
  if (raw == null || raw === '' || !Number.isInteger(num) || num < 1) {
    throw new BadRequestException('删除合同订单必须携带有效的 version');
  }
  return num;
}
