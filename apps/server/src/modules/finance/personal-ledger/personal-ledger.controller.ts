import type { FinancePersonalLedgerResponseOutput } from '@ky-azeroth/shared/schemas';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CreateFinancePersonalLedgerDto } from './dto/create-personal-ledger.dto';
import { QueryFinancePersonalLedgerDto } from './dto/query-personal-ledger.dto';
import { UpdateFinancePersonalLedgerDto } from './dto/update-personal-ledger.dto';
import { FinancePersonalLedgerService } from './personal-ledger.service';

@Controller('finance-personal-ledger')
export class FinancePersonalLedgerController {
  constructor(private readonly service: FinancePersonalLedgerService) {}

  @Get()
  @RequirePermission({ module: 'finance', menu: 'personal_ledger', action: 'view' })
  findAll(
    @Query() query: QueryFinancePersonalLedgerDto
  ): Promise<PaginatedResponse<FinancePersonalLedgerResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'finance', menu: 'personal_ledger', action: 'view' })
  findOne(@Param('id') id: string): Promise<FinancePersonalLedgerResponseOutput> {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'finance', menu: 'personal_ledger', action: 'create' })
  create(
    @Body() dto: CreateFinancePersonalLedgerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinancePersonalLedgerResponseOutput> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermission({ module: 'finance', menu: 'personal_ledger', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFinancePersonalLedgerDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinancePersonalLedgerResponseOutput> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission({ module: 'finance', menu: 'personal_ledger', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: true }> {
    await this.service.remove(id, user);
    return { success: true };
  }
}
