import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { assertFreshJwtAuthentication } from '../auth/guards/fresh-jwt-authentication';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserListResponseDto, UserResponseDto } from './dto/user-response.dto';
import { UserSelectionQueryDto } from './dto/user-selection-query.dto';
import { UsersService } from './users.service';

@ApiTags('用户管理')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: '创建用户' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'create' })
  create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<UserResponseDto> {
    assertFreshJwtAuthentication(user);
    return this.usersService.create(createUserDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询用户列表' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'view' })
  findAll(@Query() query: QueryUsersDto): Promise<UserListResponseDto> {
    return this.usersService.findAll(query);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有用户（用于选择器）' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'view' })
  findAllForSelection(
    @Query() query: UserSelectionQueryDto
  ): Promise<
    { id: string; username: string; phone: string | null; employeeName: string | null }[]
  > {
    return this.usersService.findAllForSelection(query);
  }

  @Get('me')
  @AllowAnyAuthenticatedUser()
  @ApiOperation({ summary: '获取当前用户信息' })
  getMe(@CurrentUser() currentUser: CurrentUserType): Promise<UserResponseDto> {
    // push 6: currentUser.id 即 employee.id，user 表已删
    return this.usersService.findOne(currentUser.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询用户详情' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'view' })
  findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新用户' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<UserResponseDto> {
    assertFreshJwtAuthentication(user);
    return this.usersService.update(id, updateUserDto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除用户' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    assertFreshJwtAuthentication(user);
    return this.usersService.remove(id, user);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新用户状态' })
  @RequirePermission({ module: 'system', menu: 'user_account', action: 'edit' })
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateUserStatusDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    assertFreshJwtAuthentication(user);
    return this.usersService.updateStatus(id, body.status, user);
  }

  @Patch('me/password')
  @AllowAnyAuthenticatedUser()
  @ApiOperation({ summary: '修改当前用户密码' })
  changePassword(
    @CurrentUser() user: CurrentUserType,
    @Body() dto: ChangePasswordDto
  ): Promise<{ success: boolean }> {
    // push 6: user.id 即 employee.id
    return this.usersService.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
