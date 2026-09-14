import type { ContactForSelection } from '@ky-azeroth/shared/types';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';

import { DataScopeService } from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ContactsService } from './contacts.service';
import { ContactListResponseDto, ContactResponseDto } from './dto/contact-response.dto';
import { ContactSelectionQueryDto } from './dto/contact-selection-query.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { QueryContactDto } from './dto/query-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Controller('contacts')
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly dataScopeService: DataScopeService
  ) {}

  @Get()
  @RequirePermission({ module: 'crm', menu: 'contacts', action: 'view' })
  async findAll(
    @Query() query: QueryContactDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<ContactListResponseDto> {
    const chargerScope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'contacts',
      { employeeId: user.employeeId }
    );
    return this.contactsService.findAll(query, chargerScope, user.id, request.query);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有联系人（用于下拉框）' })
  @RequirePermission({ module: 'crm', menu: 'contacts', action: 'view' })
  async findAllForSelection(
    @Query() query: ContactSelectionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ContactForSelection[]> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'contacts',
      { employeeId: user.employeeId }
    );
    return this.contactsService.findAllForSelection(query, scope, user.id);
  }

  @Get(':id')
  @RequirePermission({ module: 'crm', menu: 'contacts', action: 'view' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ContactResponseDto> {
    const chargerScope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'contacts',
      { employeeId: user.employeeId }
    );
    return this.contactsService.findOne(id, chargerScope, user.id);
  }

  @Post()
  @RequirePermission({ module: 'crm', menu: 'contacts', action: 'create' })
  async create(
    @Body() dto: CreateContactDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ContactResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'contacts',
      { employeeId: user.employeeId }
    );
    return this.contactsService.create(dto, user, scope, user.id);
  }

  @Put(':id')
  @RequirePermission({ module: 'crm', menu: 'contacts', action: 'edit' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ContactResponseDto> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'contacts',
      { employeeId: user.employeeId }
    );
    return this.contactsService.update(id, dto, user, scope, user.id);
  }

  @Delete(':id')
  @RequirePermission({ module: 'crm', menu: 'contacts', action: 'delete' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    const scope = await this.dataScopeService.resolveChargerScope(
      user.id,
      user.roles,
      'crm',
      'contacts',
      { employeeId: user.employeeId }
    );
    await this.contactsService.remove(id, user, scope, user.id);
    return { success: true };
  }
}
