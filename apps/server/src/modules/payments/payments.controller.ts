import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
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

import { DataScopeService } from '../../common/services/data-scope.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { ApprovalInstanceResponseDto } from '../approvals/dto/approval-response.dto';
import { BatchApproveDto } from '../approvals/dto/batch-approve.dto';
import { VoidApprovalRequestDto } from '../approvals/dto/void-approval-request.dto';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { InvoiceResponseDto } from '../invoices/dto/invoice-response.dto';
import { BatchRemovePaymentDto } from './dto/batch-remove-payment.dto';
import { BatchTransferPaymentDto } from './dto/batch-transfer-payment.dto';
import { BatchUpdatePaymentDto } from './dto/batch-update-payment.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CreatePaymentRefundDto } from './dto/create-payment-refund.dto';
import { MergeInvoiceDto } from './dto/merge-invoice.dto';
import { PaymentListResponseDto, PaymentResponseDto } from './dto/payment-response.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly dataScopeService: DataScopeService,
    private readonly businessApprovalService: BusinessApprovalService
  ) {}

  @Get()
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'view' })
  async findAll(
    @Query() query: QueryPaymentDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<PaymentListResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.findAll(query, scope, user.employeeId ?? null, request.query);
  }

  // ========== 批量操作 ==========
  // 路由顺序约束：所有静态路径 /payments/batch-* 与 /payments/batch 与 /payments/merge-invoice
  // 必须位于带 :id 参数的路由（GET/PUT/DELETE :id 等）之前注册，
  // 否则 NestJS 会把 "batch-transfer" 当成 :id 解析进同名单条路由。

  @Patch('batch-transfer')
  @ApiOperation({ summary: '批量更换回款负责人' })
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'edit' })
  @RequireFreshJwt()
  async batchTransfer(
    @Body() dto: BatchTransferPaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.batchTransfer(dto, user, scope, user.employeeId ?? null);
  }

  @Patch('batch-update')
  @ApiOperation({ summary: '批量编辑回款（白名单字段）' })
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'edit' })
  async batchUpdate(
    @Body() dto: BatchUpdatePaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.batchUpdate(dto, user, scope, user.employeeId ?? null);
  }

  @Post('batch-approve')
  @ApiOperation({ summary: '批量审批人决策（仅"我是审批人"的回款实例）' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'approve' })
  async batchApprove(
    @Body() dto: BatchApproveDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: Array<{ id: string; reason: string }> }> {
    return this.paymentsService.batchApprove(dto, user);
  }

  @Post('merge-invoice')
  @ApiOperation({
    summary: '合并开票（v1）：选 N 条同客户同订单的 IN 回款合并开一张发票',
  })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'create' })
  async mergeInvoice(
    @Body() dto: MergeInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<InvoiceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.mergeInvoice(dto, user, scope, user.employeeId ?? null);
  }

  @Delete('batch')
  @ApiOperation({ summary: '批量软删除回款' })
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'delete' })
  async batchRemove(
    @Body() dto: BatchRemovePaymentDto,
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
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.batchRemove(dto, user, scope, user.employeeId ?? null);
  }

  @Get(':id')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<PaymentResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.findOne(id, scope, user.employeeId ?? null);
  }

  @Post()
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'create' })
  async create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PaymentResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.create(dto, user, scope, user.employeeId ?? null);
  }

  /**
   * 创建退款（独立入口，direction='OUT'）
   *
   * 与 POST /payments 的差异：
   * - relatedPaymentId / refundType 必填
   * - 编号走 REF- 前缀
   * - 审批事件 payment_refund_approve
   */
  @Post('refund')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'create' })
  async createRefund(
    @Body() dto: CreatePaymentRefundDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PaymentResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.createRefund(dto, user, scope, user.employeeId ?? null);
  }

  @Post(':id/submit-approval')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'edit' })
  async submitApproval(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.businessApprovalService.submitBusinessApproval(
      APPROVAL_EVENT_TYPE.PAYMENT_APPROVE,
      id,
      user,
      scope
    );
  }

  /**
   * 提交退款审批（OUT 专用）
   */
  @Post(':id/submit-refund-approval')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'edit' })
  async submitRefundApproval(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.businessApprovalService.submitBusinessApproval(
      APPROVAL_EVENT_TYPE.PAYMENT_REFUND_APPROVE,
      id,
      user,
      scope
    );
  }

  @Post(':id/change-request')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'edit' })
  async submitChangeRequest(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.submitChangeRequest(id, dto, user, scope, user.employeeId ?? null);
  }

  @Post(':id/void-request')
  @ApiOperation({ summary: '提交已审批回款或退款作废申请' })
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'delete' })
  async submitVoidRequest(
    @Param('id') id: string,
    @Body() dto: VoidApprovalRequestDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.submitVoidRequest(id, dto, user, scope, user.employeeId ?? null);
  }

  @Put(':id')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<PaymentResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'payments',
      { employeeId: user.employeeId }
    );
    return this.paymentsService.update(id, dto, user, scope, user.employeeId ?? null);
  }

  @Delete(':id')
  @RequirePermission({ module: 'crm', menu: 'payments', action: 'delete' })
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
      'payments',
      { employeeId: user.employeeId }
    );
    await this.paymentsService.remove(id, user, scope, user.employeeId ?? null, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const num = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isInteger(num) || num < 1) {
    throw new BadRequestException('删除回款必须携带有效的 version');
  }
  return num;
}
