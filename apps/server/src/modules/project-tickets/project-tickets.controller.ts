import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { MutationVersionQueryDto } from '../../common/dto/mutation-version-query.dto';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateProjectTicketDto } from './dto/create-project-ticket.dto';
import {
  ProjectTicketListResponseDto,
  ProjectTicketResponseDto,
} from './dto/project-ticket-response.dto';
import { ProjectTicketStatsResponseDto } from './dto/project-ticket-stats-response.dto';
import { QueryProjectTicketDto } from './dto/query-project-ticket.dto';
import { ReassignProjectTicketDto } from './dto/reassign-project-ticket.dto';
import { TransitionProjectTicketDto } from './dto/transition-project-ticket.dto';
import { UpdateProjectTicketDto } from './dto/update-project-ticket.dto';
import { ProjectTicketsService } from './project-tickets.service';

@ApiTags('项目工单')
@ApiBearerAuth()
@Controller('project-tickets')
export class ProjectTicketsController {
  constructor(private readonly projectTicketsService: ProjectTicketsService) {}

  // ========== 统计（放在 :id 之前避免路由冲突） ==========

  @Get('stats')
  @ApiOperation({ summary: '项目工单统计' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'view' })
  getStats(@CurrentUser() user: CurrentUserType): Promise<ProjectTicketStatsResponseDto> {
    return this.projectTicketsService.getStats(user);
  }

  // ========== 标准 CRUD ==========

  @Get()
  @ApiOperation({ summary: '查询项目工单列表' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'view' })
  findAll(
    @Query() query: QueryProjectTicketDto,
    @CurrentUser() user: CurrentUserType,
    @Req() request: Request
  ): Promise<ProjectTicketListResponseDto> {
    return this.projectTicketsService.findAll(query, user, request.query);
  }

  @Get(':id')
  @ApiOperation({ summary: '查询项目工单详情' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'view' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectTicketResponseDto> {
    return this.projectTicketsService.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: '创建项目工单' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'create' })
  create(
    @Body() dto: CreateProjectTicketDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectTicketResponseDto> {
    return this.projectTicketsService.create(dto, user);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新项目工单（业务字段）' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'edit' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectTicketDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectTicketResponseDto> {
    return this.projectTicketsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '项目工单状态流转' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'edit' })
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionProjectTicketDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectTicketResponseDto> {
    return this.projectTicketsService.transition(id, dto, user);
  }

  @Patch(':id/assignee')
  @ApiOperation({ summary: '项目工单改派' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'edit' })
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignProjectTicketDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ProjectTicketResponseDto> {
    return this.projectTicketsService.reassign(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除项目工单' })
  @RequirePermission({ module: 'projects', menu: 'project_tickets', action: 'delete' })
  remove(
    @Param('id') id: string,
    @Query() query: MutationVersionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<{ success: boolean }> {
    return this.projectTicketsService.remove(id, query.version, user);
  }
}
