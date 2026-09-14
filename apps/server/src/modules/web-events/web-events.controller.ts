import type { WebEventResponseOutput } from '@ky-azeroth/shared/schemas';
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { RequireFreshJwt } from '../auth/decorators/fresh-jwt.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ArchiveWebEventsDto, QueryWebEventDto } from './dto';
import { WebEventsService } from './web-events.service';

/**
 * 官网埋点事件 controller（标准实体 CRUD 风格，给 CLI 自动派生用）。
 *
 * - GET /web-events       list（分页 + 过滤）
 * - GET /web-events/:id   get（单条）
 * - POST /web-events/archive  归档（admin-only，双闸门 dryRun=false + yes=true 才真删）
 *
 * 权限：
 * - list / get → @RequirePermission analytics.web view（system/roles 配置）
 * - archive    → analytics.web.delete + fresh JWT
 *
 * 注：聚合分析（KPI / 漏斗 / 归因 / 看板）仍走 /web-analytics/*（既有 controller，
 * 给前端「SEO 数据看板」用）；本 controller 只暴露事件流原始数据 + 归档。
 */
@ApiTags('官网埋点事件')
@ApiBearerAuth()
@Controller('web-events')
export class WebEventsController {
  constructor(private readonly service: WebEventsService) {}

  @Get()
  @ApiOperation({ summary: '官网埋点事件分页查询' })
  @RequirePermission({ module: 'analytics', menu: 'web', action: 'view' })
  findAll(@Query() query: QueryWebEventDto): Promise<PaginatedResponse<WebEventResponseOutput>> {
    return this.service.findEvents(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '官网埋点事件单条详情' })
  @RequirePermission({ module: 'analytics', menu: 'web', action: 'view' })
  findOne(@Param('id') id: string): Promise<WebEventResponseOutput> {
    return this.service.getEvent(id);
  }

  @Post('archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '官网埋点事件归档',
    description:
      '清测试数据 / 按 PIPL retention 归档。默认 dryRun=true 只返影响行数；' +
      '真删必须显式传 dryRun=false + yes=true。取代了原 wa_admin 直连 PG 的归档脚本。',
  })
  @RequirePermission({ module: 'analytics', menu: 'web', action: 'delete' })
  @RequireFreshJwt()
  archive(@Body() body: ArchiveWebEventsDto): Promise<{
    matched: number;
    deleted: number;
    dryRun: boolean;
  }> {
    return this.service.archiveEvents(body);
  }
}
