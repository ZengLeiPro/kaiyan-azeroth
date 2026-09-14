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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { DataScopeService } from '../../common/services/data-scope.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { ApprovalInstanceResponseDto } from '../approvals/dto/approval-response.dto';
import { BatchApproveDto } from '../approvals/dto/batch-approve.dto';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { BatchRemoveInvoiceDto } from './dto/batch-remove-invoice.dto';
import { BatchTransferInvoiceDto } from './dto/batch-transfer-invoice.dto';
import { BatchUpdateInvoiceDto } from './dto/batch-update-invoice.dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceListResponseDto, InvoiceResponseDto } from './dto/invoice-response.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { RedVoidInvoiceDto } from './dto/red-void-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('发票管理')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly dataScopeService: DataScopeService,
    private readonly businessApprovalService: BusinessApprovalService
  ) {}

  @Post()
  @ApiOperation({ summary: '创建发票' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'create' })
  async create(
    @Body() createInvoiceDto: CreateInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<InvoiceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.create(createInvoiceDto, user, scope, user.employeeId ?? null);
  }

  @Get()
  @ApiOperation({ summary: '查询发票列表' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'view' })
  async findAll(
    @Query() query: QueryInvoiceDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<InvoiceListResponseDto> {
    const chargerScope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.findAll(
      query,
      chargerScope,
      user.employeeId ?? null,
      request.query
    );
  }

  // ========== 批量操作 ==========
  // 路由顺序约束：所有静态路径 /invoices/batch-* 与 /invoices/batch
  // 必须位于带 :id 参数的路由（GET/PUT/DELETE :id 等）之前注册。

  @Patch('batch-transfer')
  @ApiOperation({ summary: '批量更换发票负责人' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'edit' })
  @RequireFreshJwt()
  async batchTransfer(
    @Body() dto: BatchTransferInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.batchTransfer(dto, user, scope, user.employeeId ?? null);
  }

  @Patch('batch-update')
  @ApiOperation({ summary: '批量编辑发票（白名单字段）' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'edit' })
  async batchUpdate(
    @Body() dto: BatchUpdateInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.batchUpdate(dto, user, scope, user.employeeId ?? null);
  }

  @Post('batch-approve')
  @ApiOperation({ summary: '批量审批人决策（仅"我是审批人"的发票实例）' })
  @RequirePermission({ module: 'approval', menu: 'approval_list', action: 'approve' })
  async batchApprove(
    @Body() dto: BatchApproveDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: Array<{ id: string; reason: string }> }> {
    return this.invoicesService.batchApprove(dto, user);
  }

  @Delete('batch')
  @ApiOperation({ summary: '批量软删除发票' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'delete' })
  async batchRemove(
    @Body() dto: BatchRemoveInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: number; skipped: string[] }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.batchRemove(dto, user, scope, user.employeeId ?? null);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询发票详情' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<InvoiceResponseDto> {
    const chargerScope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.findOne(id, chargerScope, user.employeeId ?? null);
  }

  @Post(':id/submit-approval')
  @ApiOperation({ summary: '提交开票审批' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'edit' })
  async submitApproval(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.businessApprovalService.submitBusinessApproval(
      APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
      id,
      user,
      scope
    );
  }

  /**
   * 全额冲红原票（仅 NORMAL + approved 发票可触发）
   */
  @Post(':id/red-void')
  @ApiOperation({ summary: '红字冲销发票' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'edit' })
  async redVoid(
    @Param('id') id: string,
    @Body() dto: RedVoidInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<InvoiceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.voidRed(
      id,
      dto.version,
      dto.reason,
      user,
      scope,
      user.employeeId ?? null
    );
  }

  @Post(':id/change-request')
  @ApiOperation({ summary: '提交开票变更审批' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'edit' })
  async submitChangeRequest(
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ApprovalInstanceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.submitChangeRequest(id, dto, user, scope, user.employeeId ?? null);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新发票' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() updateInvoiceDto: UpdateInvoiceDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<InvoiceResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'invoices',
      { employeeId: user.employeeId }
    );
    return this.invoicesService.update(id, updateInvoiceDto, user, scope, user.employeeId ?? null);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除发票' })
  @RequirePermission({ module: 'crm', menu: 'invoices', action: 'delete' })
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
      'invoices',
      { employeeId: user.employeeId }
    );
    await this.invoicesService.remove(id, user, scope, user.employeeId ?? null, requestVersion);
    return { success: true };
  }
}

function parseVersionParam(raw: string | undefined): number {
  const num = Number(raw);
  if (typeof raw !== 'string' || raw === '' || !Number.isInteger(num) || num < 1) {
    throw new BadRequestException('删除发票必须携带有效的 version');
  }
  return num;
}
