import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { assertFreshJwtAuthentication } from '../auth/guards/fresh-jwt-authentication';
import {
  BindEmployeeDingtalkDto,
  CreateEmployeeDto,
  EmployeeListResponseDto,
  EmployeeResponseDto,
  EmployeesSelectionQueryDto,
  QueryEmployeesDto,
  UnbindEmployeeDingtalkDto,
  UpdateEmployeeDto,
} from './dto';
import { EmployeesService } from './employees.service';

@ApiTags('员工档案')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  private readonly logger = new Logger(EmployeesController.name);

  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @ApiOperation({ summary: '创建员工' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'create' })
  create(
    @Body() createEmployeeDto: CreateEmployeeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.create(createEmployeeDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询员工列表' })
  @ApiOkResponse({ type: EmployeeListResponseDto })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'view' })
  async findAll(
    @Query() query: QueryEmployeesDto,
    @Req() request: Request
  ): Promise<EmployeeListResponseDto> {
    // controller 只负责转发 query，日志细节建议下沉到 service
    this.logger.log('查询员工列表');
    try {
      return await this.employeesService.findAll(query, request.query);
    } catch (error) {
      this.logger.error('查询员工列表失败', error);
      throw error;
    }
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有员工（用于下拉框）' })
  // 工具型接口：仅返回 id/name/serialNumber 通讯录字段，所有登录员工均可调用，
  // 用于跨业务模块（CRM 选负责人、工单选接单人、项目选成员等）的"选人"下拉。
  // 不应被 organization:employees:view 限制——业务角色（如 DEVELOPER）没该权限会全场景失效。
  @AllowAnyAuthenticatedUser()
  findAllForSelection(
    @Query() query: EmployeesSelectionQueryDto
  ): Promise<{ id: string; name: string; serialNumber: string }[]> {
    return this.employeesService.findAllForSelection(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询员工详情' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'view' })
  findOne(@Param('id') id: string): Promise<EmployeeResponseDto> {
    return this.employeesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新员工' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<EmployeeResponseDto> {
    assertFreshJwtAuthentication(user);
    return this.employeesService.update(id, updateEmployeeDto, user);
  }

  @Put(':id/dingtalk-binding')
  @ApiOperation({ summary: '绑定或完整替换员工钉钉身份' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'edit' })
  @RequireFreshJwt()
  bindDingtalk(
    @Param('id') id: string,
    @Body() body: BindEmployeeDingtalkDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.bindDingtalk(id, body, user);
  }

  @Delete(':id/dingtalk-binding')
  @ApiOperation({ summary: '解绑员工钉钉身份' })
  @ApiOkResponse({ type: EmployeeResponseDto })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'edit' })
  @RequireFreshJwt()
  unbindDingtalk(
    @Param('id') id: string,
    @Body() body: UnbindEmployeeDingtalkDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<EmployeeResponseDto> {
    return this.employeesService.unbindDingtalk(id, body, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除员工' })
  @RequirePermission({ module: 'organization', menu: 'employees', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ message: string }> {
    assertFreshJwtAuthentication(user);
    return this.employeesService.remove(id, user);
  }

  // push 6: user 表已删，linkUser/unlinkUser 已无意义；登录绑定改为直接在 employee 上设置 username/password/canLogin
}
