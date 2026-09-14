import type { FinanceLedgerResponseOutput } from '@ky-azeroth/shared/schemas';
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { BatchUpdateSubjectDto } from './dto/batch-update-subject.dto';
import { CreateFinanceLedgerDto } from './dto/create-ledger.dto';
import { LinkPaymentDto } from './dto/link-payment.dto';
import { QueryFinanceLedgerDto } from './dto/query-ledger.dto';
import { UnlinkPaymentDto } from './dto/unlink-payment.dto';
import { UpdateFinanceLedgerDto } from './dto/update-ledger.dto';
import { FinanceLedgerService } from './ledger.service';

@Controller('finance-ledger')
export class FinanceLedgerController {
  constructor(private readonly service: FinanceLedgerService) {}

  @Get()
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'view' })
  findAll(
    @Query() query: QueryFinanceLedgerDto
  ): Promise<PaginatedResponse<FinanceLedgerResponseOutput>> {
    return this.service.findAll(query);
  }

  // 静态路径必须早于 `:id` 注册（NestJS 路由顺序），下面三个 管理员 端点：
  // - batch-update-subject：批量改科目（绑定方案 v2.1 Phase 4.5）
  // - :id/unlink-payment：派生 ledger 解绑（保留独立流水）
  // - :id/link-payment：把独立 ledger 绑定到 Payment（供历史回填脚本调用）

  @Patch('batch-update-subject')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'edit' })
  @RequireFreshJwt()
  async batchUpdateSubject(
    @Body() dto: BatchUpdateSubjectDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ updated: number }> {
    return this.service.batchUpdateSubject(dto.ledgerIds, dto.subjectId, user);
  }

  @Get(':id')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'view' })
  findOne(@Param('id') id: string): Promise<FinanceLedgerResponseOutput> {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'create' })
  create(
    @Body() dto: CreateFinanceLedgerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceLedgerResponseOutput> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceLedgerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceLedgerResponseOutput> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: true }> {
    await this.service.remove(id, user);
    return { success: true };
  }

  @Post(':id/unlink-payment')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'edit' })
  @RequireFreshJwt()
  async unlinkPayment(
    @Param('id') id: string,
    @Body() dto: UnlinkPaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceLedgerResponseOutput> {
    return this.service.unlinkPayment(id, dto.reason, user);
  }

  @Post(':id/link-payment')
  @RequirePermission({ module: 'finance', menu: 'ledger', action: 'edit' })
  @RequireFreshJwt()
  async linkPayment(
    @Param('id') id: string,
    @Body() dto: LinkPaymentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceLedgerResponseOutput> {
    return this.service.linkPayment(id, dto.paymentId, dto.reason, user);
  }
}
