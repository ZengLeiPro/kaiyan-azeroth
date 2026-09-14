/**
 * SEO 监测实体 CLI 别名 controller（4 个 thin standalone）
 *
 * 为什么需要：
 * - 主 controller `SeoMonitorController` 用 `@Controller('seo')` 共用前缀，所有
 *   端点挂在 `/seo/search-queries` / `/seo/page-insights` / ... 下。
 * - 但 azeroth CLI 自动派生用 PascalName 直接拼路径（`SeoSearchQuery` →
 *   `/seo-search-queries`），与 `/seo/search-queries` 不匹配。ROUTE_OVERRIDES
 *   只能改命令名不能拆路径段，无法解决。
 *
 * 解法：4 个 thin standalone controller，路径完全匹配 CLI 派生的命令名，
 * 内部 inject `SeoMonitorService` 复用 findXxx + findXxxById 方法。
 * 前端 `/seo/*` 路由完全不动；CLI 走 `/seo-*` 命令路径不变。
 *
 * 权限：与主 controller 一致（analytics.seo view）。
 */

import type {
  ISeoPageInsightResponse,
  ISeoSearchQueryResponse,
  ISeoSyncRunResponse,
  ISeoTrafficSnapshotResponse,
} from '@ky-azeroth/shared/types';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  QuerySeoPageInsightDto,
  QuerySeoSearchQueryDto,
  QuerySeoSyncRunDto,
  QuerySeoTrafficSnapshotDto,
} from './dto';
import { SeoMonitorService } from './seo-monitor.service';

@ApiTags('SEO 监测 · 实体别名 (CLI)')
@ApiBearerAuth()
@Controller('seo-search-queries')
@RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
export class SeoSearchQueriesAliasController {
  constructor(private readonly service: SeoMonitorService) {}

  @Get()
  @ApiOperation({ summary: 'SEO 关键词列表（CLI 别名 = /seo/search-queries）' })
  findAll(
    @Query() query: QuerySeoSearchQueryDto
  ): Promise<PaginatedResponse<ISeoSearchQueryResponse>> {
    return this.service.findSearchQueries(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'SEO 关键词单条' })
  findOne(@Param('id') id: string): Promise<ISeoSearchQueryResponse> {
    return this.service.findSearchQueryById(id);
  }
}

@ApiTags('SEO 监测 · 实体别名 (CLI)')
@ApiBearerAuth()
@Controller('seo-page-insights')
@RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
export class SeoPageInsightsAliasController {
  constructor(private readonly service: SeoMonitorService) {}

  @Get()
  @ApiOperation({ summary: 'Clarity 页面级洞察列表（CLI 别名 = /seo/page-insights）' })
  findAll(
    @Query() query: QuerySeoPageInsightDto
  ): Promise<PaginatedResponse<ISeoPageInsightResponse>> {
    return this.service.findPageInsights(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Clarity 页面级洞察单条' })
  findOne(@Param('id') id: string): Promise<ISeoPageInsightResponse> {
    return this.service.findPageInsightById(id);
  }
}

@ApiTags('SEO 监测 · 实体别名 (CLI)')
@ApiBearerAuth()
@Controller('seo-traffic-snapshots')
@RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
export class SeoTrafficSnapshotsAliasController {
  constructor(private readonly service: SeoMonitorService) {}

  @Get()
  @ApiOperation({ summary: '整站流量快照列表（CLI 别名 = /seo/traffic-snapshots）' })
  findAll(
    @Query() query: QuerySeoTrafficSnapshotDto
  ): Promise<PaginatedResponse<ISeoTrafficSnapshotResponse>> {
    return this.service.findTrafficSnapshots(query);
  }

  @Get(':id')
  @ApiOperation({ summary: '整站流量快照单条' })
  findOne(@Param('id') id: string): Promise<ISeoTrafficSnapshotResponse> {
    return this.service.findTrafficSnapshotById(id);
  }
}

@ApiTags('SEO 监测 · 实体别名 (CLI)')
@ApiBearerAuth()
@Controller('seo-sync-runs')
@RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
export class SeoSyncRunsAliasController {
  constructor(private readonly service: SeoMonitorService) {}

  @Get()
  @ApiOperation({ summary: 'SEO 同步任务列表（CLI 别名 = /seo/sync-runs）' })
  findAll(@Query() query: QuerySeoSyncRunDto): Promise<PaginatedResponse<ISeoSyncRunResponse>> {
    return this.service.findSyncRuns(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'SEO 同步任务单条详情' })
  findOne(@Param('id') id: string): Promise<ISeoSyncRunResponse> {
    return this.service.findSyncRunById(id);
  }
}
