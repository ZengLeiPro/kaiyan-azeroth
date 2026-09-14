import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { RoleListResponseDto, RoleResponseDto } from './dto/role-response.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@ApiTags('角色管理')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @ApiOperation({ summary: '创建角色' })
  @RequirePermission({ module: 'system', menu: 'user_role', action: 'create' })
  @RequireFreshJwt()
  create(
    @Body() createRoleDto: CreateRoleDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<RoleResponseDto> {
    return this.rolesService.create(createRoleDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询角色列表' })
  @RequirePermission({ module: 'system', menu: 'user_role', action: 'view' })
  findAll(@Query() query: QueryRoleDto, @Req() request: Request): Promise<RoleListResponseDto> {
    return this.rolesService.findAll(query, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询角色详情' })
  @RequirePermission({ module: 'system', menu: 'user_role', action: 'view' })
  findOne(@Param('id') id: string): Promise<RoleResponseDto> {
    return this.rolesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新角色' })
  @RequirePermission({ module: 'system', menu: 'user_role', action: 'edit' })
  @RequireFreshJwt()
  update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<RoleResponseDto> {
    return this.rolesService.update(id, updateRoleDto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  @RequirePermission({ module: 'system', menu: 'user_role', action: 'delete' })
  @RequireFreshJwt()
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.rolesService.remove(id, user);
  }
}
