import type { FinanceSubjectResponseOutput } from '@ky-azeroth/shared/schemas';
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import type { PaginatedResponse } from '../../../common/interfaces/pagination.interface';
import { CurrentUser, CurrentUserType } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CreateFinanceSubjectDto } from './dto/create-subject.dto';
import { QueryFinanceSubjectDto } from './dto/query-subject.dto';
import { UpdateFinanceSubjectDto } from './dto/update-subject.dto';
import { FinanceSubjectsService } from './subjects.service';

@Controller('finance-subjects')
export class FinanceSubjectsController {
  constructor(private readonly service: FinanceSubjectsService) {}

  @Get()
  @RequirePermission({ module: 'finance', menu: 'subjects', action: 'view' })
  findAll(
    @Query() query: QueryFinanceSubjectDto
  ): Promise<PaginatedResponse<FinanceSubjectResponseOutput>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'finance', menu: 'subjects', action: 'view' })
  findOne(@Param('id') id: string): Promise<FinanceSubjectResponseOutput> {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermission({ module: 'finance', menu: 'subjects', action: 'create' })
  create(
    @Body() dto: CreateFinanceSubjectDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceSubjectResponseOutput> {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermission({ module: 'finance', menu: 'subjects', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFinanceSubjectDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<FinanceSubjectResponseOutput> {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermission({ module: 'finance', menu: 'subjects', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: true }> {
    await this.service.remove(id, user);
    return { success: true };
  }
}
