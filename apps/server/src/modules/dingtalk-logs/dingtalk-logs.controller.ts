import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { DingtalkLogsService } from './dingtalk-logs.service';
import { CreateDingtalkLogDto } from './dto/create-dingtalk-log.dto';
import {
  DingtalkLogListResponseDto,
  DingtalkLogResponseDto,
} from './dto/dingtalk-log-response.dto';
import { QueryDingtalkLogDto } from './dto/query-dingtalk-log.dto';
import { UpdateDingtalkLogDto } from './dto/update-dingtalk-log.dto';

@ApiTags('钉钉日志')
@ApiBearerAuth()
@Controller('dingtalk-logs')
export class DingtalkLogsController {
  constructor(private readonly dingtalkLogsService: DingtalkLogsService) {}

  @Get()
  @ApiOperation({ summary: '查询钉钉日志列表' })
  @RequirePermission({ module: 'reports', menu: 'dingtalk_logs', action: 'view' })
  findAll(
    @Query() query: QueryDingtalkLogDto,
    @Req() request: Request
  ): Promise<DingtalkLogListResponseDto> {
    return this.dingtalkLogsService.findAll(query, request.query);
  }

  @Get(':reportId')
  @ApiOperation({ summary: '查询钉钉日志详情' })
  @RequirePermission({ module: 'reports', menu: 'dingtalk_logs', action: 'view' })
  findOne(@Param('reportId') reportId: string): Promise<DingtalkLogResponseDto> {
    return this.dingtalkLogsService.findOne(reportId);
  }

  @Post()
  @ApiOperation({ summary: '本地新增钉钉日志' })
  @RequirePermission({ module: 'reports', menu: 'dingtalk_logs', action: 'create' })
  create(@Body() dto: CreateDingtalkLogDto): Promise<DingtalkLogResponseDto> {
    return this.dingtalkLogsService.create(dto);
  }

  @Patch(':reportId')
  @ApiOperation({ summary: '编辑钉钉日志（本地）' })
  @RequirePermission({ module: 'reports', menu: 'dingtalk_logs', action: 'edit' })
  update(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateDingtalkLogDto
  ): Promise<DingtalkLogResponseDto> {
    return this.dingtalkLogsService.update(reportId, dto);
  }

  @Put(':reportId')
  @ApiOperation({ summary: '编辑钉钉日志（兼容通用 CRUD 保存）' })
  @RequirePermission({ module: 'reports', menu: 'dingtalk_logs', action: 'edit' })
  updateByPut(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateDingtalkLogDto
  ): Promise<DingtalkLogResponseDto> {
    return this.dingtalkLogsService.update(reportId, dto);
  }

  @Delete(':reportId')
  @ApiOperation({ summary: '删除钉钉日志' })
  @RequirePermission({ module: 'reports', menu: 'dingtalk_logs', action: 'delete' })
  remove(@Param('reportId') reportId: string): Promise<{ success: true }> {
    return this.dingtalkLogsService.remove(reportId);
  }
}
