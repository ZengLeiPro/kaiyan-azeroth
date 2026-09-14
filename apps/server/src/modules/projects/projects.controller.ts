import type { ProjectMemberOutput } from '@ky-azeroth/shared/schemas';
import type { IProjectSelectionOption } from '@ky-azeroth/shared/types/project';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { MutationVersionQueryDto } from '../../common/dto/mutation-version-query.dto';
import { serializeEntity } from '../../common/utils/response-helpers';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { LinkSaleOrderDto } from './dto/link-sale-order.dto';
import {
  ProjectListResponseDto,
  ProjectMemberResponseDto,
  ProjectResponseDto,
} from './dto/project-response.dto';
import { ProjectSelectionQueryDto } from './dto/project-selection-query.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('项目管理')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: '创建项目' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'create' })
  create(
    @Body() createProjectDto: CreateProjectDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectResponseDto> {
    return this.projectsService.create(createProjectDto, user);
  }

  @Get()
  @ApiOperation({ summary: '查询项目列表' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'view' })
  findAll(
    @Query() query: QueryProjectDto,
    @Req() request: Request
  ): Promise<ProjectListResponseDto> {
    return this.projectsService.findAll(query, request.query);
  }

  @Get('all')
  @ApiOperation({ summary: '查询所有项目（用于下拉框）' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'view' })
  findAllForSelection(
    @Query() query: ProjectSelectionQueryDto
  ): Promise<IProjectSelectionOption[]> {
    return this.projectsService.findAllForSelection(query.keyword, query.status, query.category);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询项目详情' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'view' })
  findOne(@Param('id') id: string): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新项目' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectResponseDto> {
    return this.projectsService.update(id, updateProjectDto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除项目' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'delete' })
  remove(
    @Param('id') id: string,
    @Query() query: MutationVersionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.projectsService.remove(id, query.version, user);
  }

  // ========== 项目-订单关联管理 ==========

  @Post(':id/sale-orders')
  @ApiOperation({ summary: '关联销售订单到项目' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'edit' })
  linkSaleOrder(
    @Param('id') id: string,
    @Body() dto: LinkSaleOrderDto,
    @CurrentUser() user: CurrentUserType
  ) {
    return this.projectsService.linkSaleOrder(id, dto.saleOrderId, dto.version, user);
  }

  @Delete(':id/sale-orders/:saleOrderId')
  @ApiOperation({ summary: '解除项目与销售订单的关联' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'edit' })
  unlinkSaleOrder(
    @Param('id') id: string,
    @Param('saleOrderId') saleOrderId: string,
    @Query() query: MutationVersionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.projectsService.unlinkSaleOrder(id, saleOrderId, query.version, user);
  }

  // ========== 项目成员管理 ==========

  @Post(':id/members')
  @ApiOperation({ summary: '添加项目成员' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'edit' })
  async addMember(
    @Param('id') id: string,
    @Body() body: AddProjectMemberDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectMemberResponseDto> {
    const member = await this.projectsService.addMember(id, body, user);
    return serializeEntity<ProjectMemberOutput>(member);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({ summary: '移除项目成员' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'edit' })
  removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Query() query: MutationVersionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.projectsService.removeMember(id, memberId, query.version, user);
  }

  @Get(':id/members')
  @ApiOperation({ summary: '获取项目成员列表' })
  @RequirePermission({ module: 'projects', menu: 'project_list', action: 'view' })
  async getMembers(@Param('id') id: string): Promise<ProjectMemberResponseDto[]> {
    const members = await this.projectsService.getMembers(id);
    return members.map((m) => serializeEntity<ProjectMemberOutput>(m));
  }
}
