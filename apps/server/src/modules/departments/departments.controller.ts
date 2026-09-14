import { IDepartmentTreeNode } from '@ky-azeroth/shared/types';
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
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { DepartmentsService } from './departments.service';
import {
  AddEmployeeToDepartmentDto,
  CreateDepartmentDto,
  DepartmentEmployeeListResponseDto,
  DepartmentForSelectionDto,
  DepartmentListResponseDto,
  DepartmentResponseDto,
  DepartmentSelectionQueryDto,
  QueryDepartmentDto,
  QueryDepartmentEmployeesDto,
  SetDepartmentManagersDto,
  UpdateDepartmentDto,
} from './dto';

@ApiTags('部门管理')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  private readonly logger = new Logger(DepartmentsController.name);

  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @ApiOperation({ summary: '创建部门' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'create' })
  create(
    @Body() createDepartmentDto: CreateDepartmentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<DepartmentResponseDto> {
    return this.departmentsService.create(createDepartmentDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询部门列表（分页）' })
  @ApiOkResponse({ type: DepartmentListResponseDto })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'view' })
  async findAll(
    @Query() query: QueryDepartmentDto,
    @Req() request: Request
  ): Promise<DepartmentListResponseDto> {
    this.logger.log('查询部门列表');
    try {
      return await this.departmentsService.findAll(query, request.query);
    } catch (error) {
      this.logger.error('查询部门列表失败', error);
      throw error;
    }
  }

  @Get('tree')
  @ApiOperation({ summary: '获取部门树' })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'view' })
  getTree(): Promise<IDepartmentTreeNode[]> {
    return this.departmentsService.getTree();
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有部门（用于选择器）' })
  @ApiOkResponse({ type: [DepartmentForSelectionDto] })
  // 工具型接口：仅返回 id/name/parentId 通讯录字段。DepartmentSelect 在 CrudFilterBar 通用筛选条
  // 中被广泛复用，跨业务模块 + 不应被 organization:departments:view 锁住，否则 DEVELOPER 等
  // 没 organization 权限的角色一进任何带筛选条的页面都会失效。同 /employees/all。
  @AllowAnyAuthenticatedUser()
  findAllForSelection(
    @Query() query: DepartmentSelectionQueryDto
  ): Promise<{ id: string; name: string; parentId: string | null }[]> {
    return this.departmentsService.findAllForSelection(query.keyword, query.status);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取部门详情' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'view' })
  findOne(@Param('id') id: string): Promise<DepartmentResponseDto> {
    return this.departmentsService.findOne(id);
  }

  @Get(':id/children')
  @ApiOperation({ summary: '获取直接子部门' })
  @ApiOkResponse({ type: [DepartmentResponseDto] })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'view' })
  findChildren(@Param('id') id: string): Promise<DepartmentResponseDto[]> {
    return this.departmentsService.findChildren(id);
  }

  @Get(':id/employees')
  @ApiOperation({ summary: '获取部门员工列表（分页）' })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'view' })
  findEmployees(
    @Param('id') id: string,
    @Query() query: QueryDepartmentEmployeesDto
  ): Promise<DepartmentEmployeeListResponseDto> {
    return this.departmentsService.findEmployees(id, query.page ?? 1, query.pageSize ?? 10);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新部门' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() updateDepartmentDto: UpdateDepartmentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<DepartmentResponseDto> {
    return this.departmentsService.update(id, updateDepartmentDto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除部门' })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ message: string }> {
    return this.departmentsService.remove(id, user);
  }

  @Put(':id/managers')
  @ApiOperation({ summary: '设置部门负责人' })
  @ApiOkResponse({ type: DepartmentResponseDto })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'edit' })
  setManagers(
    @Param('id') id: string,
    @Body() dto: SetDepartmentManagersDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<DepartmentResponseDto> {
    return this.departmentsService.setManagers(id, dto, user);
  }

  @Post(':id/employees')
  @ApiOperation({ summary: '添加员工到部门' })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'edit' })
  addEmployee(
    @Param('id') id: string,
    @Body() dto: AddEmployeeToDepartmentDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ message: string }> {
    return this.departmentsService.addEmployee(id, dto.employeeId, dto.isPrimary, user);
  }

  @Delete(':id/employees/:employeeId')
  @ApiOperation({ summary: '从部门移除员工' })
  @RequirePermission({ module: 'organization', menu: 'departments', action: 'edit' })
  removeEmployee(
    @Param('id') id: string,
    @Param('employeeId') employeeId: string
  ): Promise<{ message: string }> {
    return this.departmentsService.removeEmployee(id, employeeId);
  }
}
