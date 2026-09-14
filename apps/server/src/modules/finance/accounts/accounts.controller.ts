import type { FinanceAccountResponseOutput } from '@ky-azeroth/shared/schemas';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { FinanceAccountsService } from './accounts.service';
import { CreateFinanceAccountDto } from './dto/create-account.dto';
import { QueryFinanceAccountDto } from './dto/query-account.dto';
import { UpdateFinanceAccountDto } from './dto/update-account.dto';

/**
 * 财务账户字典 controller
 *
 * 权限统一走 system/roles。
 */
@Controller('finance-accounts')
export class FinanceAccountsController {
  constructor(private readonly service: FinanceAccountsService) {}

  @Get()
  @RequirePermission({ module: 'finance', menu: 'accounts', action: 'view' })
  findAll(
    @Query() query: QueryFinanceAccountDto
  ): Promise<PaginatedResponse<FinanceAccountResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'finance', menu: 'accounts', action: 'view' })
  findOne(@Param('id') id: string): Promise<FinanceAccountResponseOutput> {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'finance', menu: 'accounts', action: 'create' })
  create(
    @Body() dto: CreateFinanceAccountDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceAccountResponseOutput> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermission({ module: 'finance', menu: 'accounts', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceAccountDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceAccountResponseOutput> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission({ module: 'finance', menu: 'accounts', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: true }> {
    await this.service.remove(id, user);
    return { success: true };
  }
}
